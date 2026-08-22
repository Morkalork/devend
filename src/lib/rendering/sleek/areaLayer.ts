/**
 * Colored Areas (var / let / const) as floor markings.
 *
 * These are painted ON the board, not objects sitting on it, so they take no
 * cast shadow - they take the ambient wash like the surface they belong to.
 * Getting that wrong (giving a floor decal a drop shadow) is the fastest way to
 * break a lighting model, because it tells the eye the marking is floating.
 *
 * The three states each element can be in are kept visually orthogonal:
 *   GATE vs BONUS   - border weight and fill density (must vs may)
 *   OCCUPIED        - a solid, brighter border once a ball is locked inside
 * so a bonus pocket in use never reads as a gate.
 *
 * OCCUPIED also PULSES. Reported from play: "I still can't tell if the colored
 * area is activated." A static brighter border is not a signal, because the
 * player never sees the before and after side by side - by the time they look,
 * bright-because-used and bright-because-that-is-how-it-looks are the same
 * picture. The pulse is drawn into its own Graphics so the static geometry
 * stays key-gated and is not rebuilt sixty times a second.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { areaStyle, isGateArea } from "@/lib/coloredAreas";
import { dashedLine } from "./dashedLine";
import { ambientAt, type LightScope } from "./light";
import { snapRect, hairline, type Pt } from "./pixelGrid";
import {
  worldRectQuad, quadLocal, expandQuad, cornersPoly,
  type ScreenQuad,
} from "./quad";
import { PALETTE } from "./palette";
import { wellIsLive, wellPullVector } from "@/lib/physics/gravityWells";
import { mix } from "./palette";

type W2S = (x: number, y: number) => Pt;

/**
 * How far a DORMANT zone is drained toward grey (0 = full chroma, 1 = grey).
 *
 * Brightness alone was not enough to tell activated from dormant: reported
 * twice, and the second time with the pulse already in. Dimming makes a zone
 * quieter, but a quiet pink box and a bright pink box are still the same box,
 * and a player judging one in isolation has nothing to compare against. Draining
 * the COLOUR out gives the two states different hues, so activation reads as the
 * zone coming to life rather than merely turning up.
 *
 * Gates drain less than bonus pockets: a gate is a required win condition, so it
 * has to stay legible even while dormant.
 */
const DORMANT_DRAIN_BONUS = 0.72;
const DORMANT_DRAIN_GATE = 0.4;
/** What a drained zone mixes toward: the board's dead slate, not pure grey. */
const DORMANT_GREY = 0x55605a;

/** The colour a zone is drawn in while dormant. Pure, so it can be tested. */
export function dormantColor(color: number, gate: boolean): number {
  return mix(color, DORMANT_GREY, gate ? DORMANT_DRAIN_GATE : DORMANT_DRAIN_BONUS);
}

/**
 * Per-state opacities, collected so "make the dormant state a bit more/less
 * visible" is one edit rather than a hunt through the draw calls.
 *
 * The dormant numbers were tuned by report: first far too close to the live
 * state to tell apart, then overshot into invisible, now nudged back up. The
 * COLOUR drain above is what carries the distinction, so these only need to be
 * low enough to read as quiet, not low enough to vanish.
 */
export const AREA_ALPHA = {
  dormant: { bonus: { fill: 0.045, border: 0.38, label: 0.54 },
             gate:  { fill: 0.085, border: 0.64, label: 0.80 } },
  live:    { fill: 0.12, border: 0.95, label: 1 },
} as const;

/** Activation flare length, and the steady breath's cycle, in ms. */
export const FLARE_MS = 1100;
export const BREATH_MS = 1900;

/** The shape of the activation pulse at a given age. */
export interface ZonePulse {
  /** 1 at the instant of activation, 0 once the flare has drained. */
  flare: number;
  /** How far the flare ring has expanded past the border, in screen px. */
  grow: number;
  /** Wash alpha over the zone: flare on top of the steady breath. */
  fillAlpha: number;
  /** Inner border alpha, before the ambient light level is applied. */
  strokeAlpha: number;
}

/** The falling ball in the gravity-well glyph, as fractions of the glyph unit. */
export const WELL_GLYPH_BALL = { radius: 0.15, offset: 0.14 } as const;
/** How far a motion line stops short of the ball's surface (glyph units). */
export const WELL_GLYPH_CLEARANCE = 0.03;

/** One motion line, in the well's PULL frame: `s` across it, `f` along it. */
export interface GlyphLine {
  /** Offset across the pull, from the glyph centre. */
  s: number;
  /** The end nearest the ball, and the far trailing end. */
  nearF: number;
  farF: number;
}

/**
 * The motion lines trailing the ball, split out so the one thing that matters
 * about them can be tested.
 *
 * The visual claim is "these come off the ball", and it is entirely a property
 * of where each line STARTS. An earlier version placed the near ends at
 * hand-picked heights, leaving a gap of about a quarter of the glyph between
 * the lines and the ball: enough that they read as an unrelated barcode hanging
 * above it rather than as speed. Solving each near end against the circle keeps
 * the clearance constant however the glyph is scaled, and fans them out for
 * free, since the outer lines meet the surface further forward than the inner.
 *
 * Lengths stay uneven. Equal ones read as a barcode again, whatever they happen
 * to be attached to.
 */
export function wellGlyphLines(unit: number): GlyphLine[] {
  const r = unit * WELL_GLYPH_BALL.radius;
  const centre = unit * WELL_GLYPH_BALL.offset;
  // Each near end is placed on a circle one clearance BIGGER than the ball, at
  // its own angle round the trailing pole. Positioning by angle rather than by
  // horizontal offset is what makes the clearance genuinely constant: offsetting
  // a line straight back along the fall axis leaves the off-centre ones nearer
  // the surface than the middle ones, since the circle curves away underneath
  // them, and unequal contact is what made these read as detached in the first
  // place.
  const ring = r + unit * WELL_GLYPH_CLEARANCE;
  return [
    [-48, 0.17], [-20, 0.29], [20, 0.24], [48, 0.15],
  ].map(([deg, len]) => {
    const t = (deg * Math.PI) / 180;
    const nearF = centre - Math.cos(t) * ring;
    return { s: Math.sin(t) * ring, nearF, farF: nearF - unit * len };
  });
}

/**
 * Pulse shape, split out so it can be tested. The visual claim being made is
 * "you can tell the zone fired, and you can still tell a minute later", and
 * that is entirely a property of these curves rather than of the Pixi calls
 * that consume them.
 */
export function zonePulse(sinceMs: number): ZonePulse {
  const age = Math.max(0, sinceMs);
  // Eased so it slams on and drains off, rather than fading linearly.
  const flare = Math.pow(Math.max(0, 1 - age / FLARE_MS), 1.7);
  // Never reaches 0, so an activated zone always reads as activated.
  const breath = 0.5 + 0.5 * Math.sin((age / BREATH_MS) * Math.PI * 2);
  return {
    flare,
    grow: (1 - flare) * 14,
    fillAlpha: 0.35 * flare + 0.10 + 0.14 * breath,
    strokeAlpha: 0.35 + 0.45 * breath,
  };
}

/**
 * The quad inset by `px` on every side (negative grows it), as four corners.
 *
 * Insets are authored in screen pixels and applied along the LOCAL basis, so a
 * border sits the same distance inside its marking however the board is turned.
 */
function insetCorners(q: ScreenQuad, px: number): [Pt, Pt, Pt, Pt] {
  return expandQuad(q, -px);
}

/**
 * Queue the quad, inset by `px`, as a shape on `g` ready to be filled/stroked.
 *
 * At rest it takes the pixel-snapped rect path, which is not an optimisation
 * but a fidelity requirement: an unsnapped rect edge lands between pixels and
 * renders as a soft two-pixel smear, and the board is at rest for almost the
 * whole game. Only a turned board pays for the general path.
 */
function shapeOf(g: Graphics, q: ScreenQuad, px: number): Graphics {
  if (q.axisAligned) {
    const r = snapRect(q.tl.x, q.tl.y, q.w, q.h);
    return g.rect(
      r.x + px, r.y + px,
      Math.max(1, r.width - px * 2), Math.max(1, r.height - px * 2),
    );
  }
  return g.poly(cornersPoly(insetCorners(q, px)));
}

export class AreaLayer {
  readonly container = new Container();

  private g = new Graphics();
  /** Redrawn per frame while any zone is pulsing; cleared once when none are. */
  private pulseG = new Graphics();
  private labels: Text[] = [];
  private key = "";
  private wasPulsing = false;

  constructor() {
    this.container.addChild(this.g, this.pulseG);
  }

  /**
   * `tilt` is the board angle. It is passed in rather than re-derived because
   * this layer is key-gated: without the angle in the key, a turning board
   * would leave every marking frozen at the orientation it had when the tilt
   * began while the walls and balls swung round without them.
   */
  sync(
    game: CanvasGameState, light: LightScope, w2s: W2S, scale: number, tilt = 0,
  ): void {
    const areas = game.coloredAreas ?? [];
    // Before the key check: the pulse is time-driven, so it must run on frames
    // where nothing about the areas themselves changed.
    this.drawPulse(areas, light, w2s);
    const key =
      areas
        .map(a => `${a.x},${a.y},${a.width},${a.height},${a.kind},${isGateArea(a) ? 1 : 0},${a.satisfied ? 1 : 0}`)
        .join("|")
      + "#" + (game.gravityWells ?? [])
        .map(w => `${w.x},${w.y},${w.width},${w.height},${w.pull ?? ""},`
          + `${wellIsLive(w, game.spaceRemainingPercent) ? 1 : 0}`)
        .join("|")
      + `|${Math.round(game.boardRect.left)},${Math.round(game.boardRect.top)},${Math.round(scale * 1000)}`
      + `|${Math.round(tilt * 2000)}`
      + "#s" + (game.slowAreas ?? [])
        .map(a => `${a.x},${a.y},${a.width},${a.height}`).join("|");
    if (key === this.key) return;
    this.key = key;

    this.g.clear();
    for (const t of this.labels) { t.parent?.removeChild(t); t.destroy(); }
    this.labels = [];

    this.drawGravityWells(game, w2s, scale);
    this.drawSlowAreas(game, w2s, scale);

    for (const a of areas) {
      const st = areaStyle(a.kind);
      const gate = isGateArea(a);
      const lit = !!a.satisfied;
      const color = Number.parseInt(st.color.replace("#", ""), 16);
      // A dormant zone is drawn drained and faint; a live one keeps full chroma
      // and gets the pulse on top. The gap between the two is the whole point.
      const inkColor = lit ? color : dormantColor(color, gate);

      const q = worldRectQuad(a.x, a.y, a.width, a.height, w2s);

      // Ambient only: the marking is part of the surface.
      const amb = ambientAt(light, q.cx, q.cy);
      // A lit zone deliberately paints LIGHTER than it used to: the breathing
      // wash from drawPulse sits on top of this every frame, and the two
      // stacked at the old weight read as a solid block. A dormant one paints
      // fainter still, so the contrast lives in the gap between them.
      const dormantAlpha = gate ? AREA_ALPHA.dormant.gate : AREA_ALPHA.dormant.bonus;
      const fill = (lit ? AREA_ALPHA.live.fill : dormantAlpha.fill) * (0.55 + amb * 0.45);
      shapeOf(this.g, q, 0).fill({ color: inkColor, alpha: fill });

      if (lit) {
        // Occupied: solid and bright, unmistakably "this one is done".
        shapeOf(this.g, q, 0.5)
          .stroke({ width: 2, color, alpha: AREA_ALPHA.live.border * light.level });
      } else {
        const dash = gate ? 9 * scale : 3 * scale;
        const gap = gate ? 6 * scale : 5 * scale;
        const c = insetCorners(q, 0.5);
        for (let i = 0; i < 4; i++) {
          const a0 = c[i], a1 = c[(i + 1) % 4];
          dashedLine(this.g, a0.x, a0.y, a1.x, a1.y, dash, gap);
        }
        this.g.stroke({
          width: hairline(),
          color: inkColor,
          alpha: dormantAlpha.border * light.level,
        });
      }

      // The label stays UPRIGHT rather than turning with the marking it sits
      // on. It is information, not decoration, and a floor decal rotated past
      // 90 degrees carries its text upside down.
      const cx = q.cx;
      const cy = q.cy;
      const labelPx = Math.max(13, Math.min(q.w, q.h) * 0.2);
      // The label carries the state too: a dormant bonus zone reads as a faded
      // stencil, a live one as a lit sign.
      const alpha = lit ? AREA_ALPHA.live.label : dormantAlpha.label;

      const kind = new Text({
        text: st.label,
        style: new TextStyle({
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: labelPx,
          fill: inkColor,
        }),
      });
      kind.anchor.set(0.5, 1);
      kind.position.set(Math.round(cx), Math.round(cy + labelPx * 0.25));
      kind.alpha = alpha;

      const mult = new Text({
        text: `×${st.multiplier}`,
        style: new TextStyle({
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: labelPx * 0.6,
          fill: inkColor,
        }),
      });
      mult.anchor.set(0.5, 0);
      mult.position.set(Math.round(cx), Math.round(cy + labelPx * 0.35));
      mult.alpha = alpha;

      this.container.addChild(kind, mult);
      this.labels.push(kind, mult);
    }
  }

  /**
   * The activation pulse: a hard flare the instant a lock is credited, decaying
   * into a slow steady breath that persists for the rest of the map.
   *
   * Both halves earn their place. The flare is what catches the eye at the
   * moment of the lock, when the player is looking at the board and not the
   * zone; the breath is what answers "did that count?" thirty seconds later,
   * when the flare is long gone and a static border would tell them nothing.
   */
  private drawPulse(areas: CanvasGameState["coloredAreas"], light: LightScope, w2s: W2S): void {
    const list = areas ?? [];
    const now = performance.now();
    let pulsing = false;

    this.pulseG.clear();
    for (const a of list) {
      if (!a.satisfied) continue;
      pulsing = true;

      const st = areaStyle(a.kind);
      const color = Number.parseInt(st.color.replace("#", ""), 16);
      const since = now - (a.satisfiedAt ?? now);

      const q = worldRectQuad(a.x, a.y, a.width, a.height, w2s);

      const p = zonePulse(since);

      // A ring that expands OUT of the border during the flare, which reads as
      // the zone firing rather than merely getting brighter.
      if (p.flare > 0.01) {
        shapeOf(this.pulseG, q, -p.grow)
          .stroke({ width: 2 + p.flare * 3, color, alpha: 0.85 * p.flare * light.level });
      }

      shapeOf(this.pulseG, q, 0).fill({ color, alpha: p.fillAlpha });
      shapeOf(this.pulseG, q, 2.5)
        .stroke({ width: 1.5, color, alpha: p.strokeAlpha * light.level });
    }

    // Leaving a stale pulse on screen would be worse than none at all.
    if (!pulsing && this.wasPulsing) this.pulseG.clear();
    this.wasPulsing = pulsing;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  /**
   * Gravity wells (issue #77): a patch that pulls anything inside it.
   *
   * Drawn as a dim striped box with a falling-object glyph, because a well has
   * to be readable at a glance and from the corner of the eye. A player who
   * does not notice one before committing a fence has been ambushed rather than
   * challenged.
   *
   * The glyph points the way the well pulls, and now that a well can pull any
   * of four ways that mark is load-bearing rather than decorative. It is
   * oriented in SCREEN space and never turns with the board, which is exactly
   * right and is the tilt mechanic showing through the art: after a quarter
   * turn the box is somewhere new and the arrow still points down, which is the
   * whole reason the turn matters.
   *
   * Deliberately quiet: coloured areas are the map's loud markings and the
   * accent belongs to the player's own fences. A well is terrain.
   */
  private drawGravityWells(game: CanvasGameState, w2s: W2S, scale: number): void {
    const wells = game.gravityWells ?? [];
    if (wells.length === 0) return;

    for (const well of wells) {
      const live = wellIsLive(well, game.spaceRemainingPercent);
      // A dormant well borrows the coloured areas' vocabulary for the same
      // state, deliberately: the player has already learned that drained and
      // dashed means "real, but not yet". Teaching a second dialect for the
      // identical idea would be the expensive way to say the same thing.
      const COLOR = live ? PALETTE.mover : dormantColor(PALETTE.mover, false);
      const a = live ? 1 : 0.55;

      const q = worldRectQuad(well.x, well.y, well.width, well.height, w2s);

      shapeOf(this.g, q, 0).fill({ color: COLOR, alpha: 0.07 * a });
      if (live) {
        shapeOf(this.g, q, 0)
          .stroke({ width: Math.max(1, 1.5 * scale), color: COLOR, alpha: 0.45 });
      } else {
        const c = insetCorners(q, 0.5);
        for (let i = 0; i < 4; i++) {
          const p0 = c[i], p1 = c[(i + 1) % 4];
          dashedLine(this.g, p0.x, p0.y, p1.x, p1.y, 7 * scale, 5 * scale);
        }
        this.g.stroke({ width: hairline(), color: COLOR, alpha: 0.5 });
      }

      // Diagonal stripes. A hazard marking reads as "this patch is different"
      // from the corner of the eye without ever competing with a ball or a
      // fence for attention, which a grid of arrows did start to do once the
      // well was any size at all.
      //
      // Laid out in the well's LOCAL frame and mapped through its basis, so
      // they stay parallel to its own edges on a turned board. Each stripe is a
      // 45 degree line a = (a0 + d) + t, b = t, kept inside the box by
      // intersecting the two ranges: t must satisfy both [-d, w - d] and
      // [0, h], so the overlap is the visible span. Computing the span beats
      // drawing long lines behind a mask, which would cost a texture per well.
      const spacing = Math.max(9, 16 * scale);
      for (let d = -q.h; d < q.w; d += spacing) {
        const t0 = Math.max(-d, 0);
        const t1 = Math.min(q.w - d, q.h);
        if (t1 <= t0) continue;
        const s0 = quadLocal(q, d + t0, t0);
        const s1 = quadLocal(q, d + t1, t1);
        this.g.moveTo(s0.x, s0.y).lineTo(s1.x, s1.y);
      }
      this.g.stroke({ width: Math.max(1, 1 * scale), color: COLOR, alpha: 0.16 * a });

      // ── The glyph, after the classic falling-apple gravity icon ───────────
      // A falling object, motion lines trailing behind it, two arrows flanking.
      //
      // The object is a BALL, not an apple. An apple is Newton's joke and this
      // game's is a different one, but the real reason is that a ball is what
      // actually falls here. An earlier version left the object out entirely on
      // the theory that a real ball crossing the well would supply it: true
      // only while one is inside, and the rest of the time the motion lines
      // hung over nothing and read as a barcode rather than as falling.
      //
      // Everything below is authored in the well's PULL frame - `f` runs the
      // way it pulls, `s` across - so the one description covers all four
      // bearings. Rotating a hand-placed set of screen coordinates would have
      // meant four of these.
      const pv = wellPullVector(well);
      const fwd = pv;                              // along the pull
      const side = { x: pv.y, y: -pv.x };          // across it, consistently handed
      const at = (sOff: number, fOff: number): Pt => ({
        x: q.cx + side.x * sOff + fwd.x * fOff,
        y: q.cy + side.y * sOff + fwd.y * fOff,
      });
      const line = (s0: number, f0: number, s1: number, f1: number) => {
        const p0 = at(s0, f0), p1 = at(s1, f1);
        this.g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
      };

      // A horizontal pull runs along the box's width, so what counts as
      // "across" swaps with it.
      const horizontal = pv.x !== 0;
      const across = horizontal ? q.h : q.w;
      const unit = Math.min(q.w, q.h);
      const armH = Math.min(unit * 0.3, 26 * scale);
      const head = armH * 0.44;

      // Flankers, held off the edges so they never touch the outline.
      for (const frac of [-0.35, 0.35]) {
        const sOff = frac * across;
        line(sOff, -armH, sOff, armH);
        line(sOff - head, armH - head, sOff, armH);
        line(sOff + head, armH - head, sOff, armH);
      }

      // Motion lines trailing the ball, each starting on the ball's own
      // surface so they read as speed coming off it. See wellGlyphLines.
      const ballR = unit * WELL_GLYPH_BALL.radius;
      const ballF = unit * WELL_GLYPH_BALL.offset;
      for (const l of wellGlyphLines(unit)) line(l.s, l.nearF, l.s, l.farF);

      this.g.stroke({
        width: Math.max(2, 2.4 * scale), color: COLOR, alpha: 0.8 * a,
        cap: "round", join: "round",
      });

      // The falling ball itself: outlined to match the line-art of the rest of
      // the glyph, and never filled, so a real ball crossing the well is always
      // the more solid thing on screen.
      const ballC = at(0, ballF);
      this.g.circle(ballC.x, ballC.y, ballR).stroke({
        width: Math.max(2, 2.6 * scale), color: COLOR, alpha: 0.85 * a,
      });
    }
  }

  /**
   * Slow Areas (ability): a placed patch where balls crawl for the rest of the
   * map.
   *
   * Drawn deliberately UNLIKE a gravity well, because the two are the same
   * shape doing opposite jobs: a well is terrain the map inflicted on you, a
   * slow area is something you chose and paid for. So this reads as a marked
   * zone rather than a hazard - a cool wash, a bracketed border, and ripples
   * across it instead of hazard stripes and a falling glyph.
   *
   * Goes through the same quad machinery as everything else on this layer, so
   * it stays correct on a turned board.
   */
  private drawSlowAreas(game: CanvasGameState, w2s: W2S, scale: number): void {
    const areas = game.slowAreas ?? [];
    if (areas.length === 0) return;
    const COLOR = 0x8fb8ff;

    for (const a of areas) {
      const q = worldRectQuad(a.x, a.y, a.width, a.height, w2s);

      shapeOf(this.g, q, 0).fill({ color: COLOR, alpha: 0.10 });

      // Corner brackets rather than a full border: a closed box reads as a
      // wall to fence along, which this is not. Brackets say "marked region"
      // without suggesting an edge the ball will bounce off.
      const arm = Math.min(q.w, q.h) * 0.22;
      for (const [ca, cb, sa, sb] of [
        [0, 0, 1, 1] as const, [q.w, 0, -1, 1] as const,
        [q.w, q.h, -1, -1] as const, [0, q.h, 1, -1] as const,
      ]) {
        const corner = quadLocal(q, ca, cb);
        const alongX = quadLocal(q, ca + sa * arm, cb);
        const alongY = quadLocal(q, ca, cb + sb * arm);
        this.g.moveTo(alongX.x, alongX.y).lineTo(corner.x, corner.y).lineTo(alongY.x, alongY.y);
      }
      this.g.stroke({
        width: Math.max(1.5, 2 * scale), color: COLOR, alpha: 0.75,
        cap: "round", join: "round",
      });

      // Ripples: evenly spaced lines across the zone, each shortened toward the
      // edges so the set reads as a pool rather than as a barcode. Authored in
      // the quad's local frame, so they stay parallel to its own edges when the
      // board turns.
      const rows = 4;
      for (let i = 1; i <= rows; i++) {
        const t = i / (rows + 1);
        const inset = q.w * (0.18 + 0.14 * Math.abs(0.5 - t) * 2);
        const p0 = quadLocal(q, inset, q.h * t);
        const p1 = quadLocal(q, q.w - inset, q.h * t);
        this.g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
      }
      this.g.stroke({ width: Math.max(1, 1.5 * scale), color: COLOR, alpha: 0.3, cap: "round" });
    }
  }
}

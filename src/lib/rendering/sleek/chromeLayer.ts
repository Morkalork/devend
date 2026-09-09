/**
 * Board chrome: the perimeter rim, the live outer walls, the speed-danger
 * frame, the gravity cue and the space bar.
 *
 * This is the frame AROUND the play surface, so it plays by different rules to
 * everything else. It is UI, not scenery: it does not sit in the scene, so it
 * casts nothing and receives no ambient falloff. It does still ride the monitor
 * flicker, because it is physically part of the same screen - chrome that held
 * perfectly steady while the board wavered would give the illusion away.
 *
 * All of it is axis-aligned by construction, so all of it snaps to whole device
 * pixels. A 1px board edge that renders as a 2px grey smear is the most visible
 * possible failure of this renderer's whole premise.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { BALL_DANGER_SPEED } from "@/lib/gameConstants";
import { PALETTE } from "./palette";
import type { LightScope } from "./light";
import { snapRect, snapStroke, snapWidth, snapEdge, hairline } from "./pixelGrid";
import { boardAngleFor } from "@/lib/boardTilt";
import { polygonBounds } from "@/lib/polygon";
import { BOARD_SIDES } from "@/lib/physics/boardEdges";
import { gravityCue, pullEdge, URGENT_SECONDS } from "./gravityCue";
import { edgeGeometry, edgeLook, edgeWake, type Vec } from "./edgeCue";

/** Ball speed (as a fraction of the danger threshold) before the frame shows. */
const DANGER_FLOOR = 0.55;
/** The space bar fades out over this long once the map is won. */
const BAR_FADE_MS = 600;

/**
 * A world-space direction, in screen space. Taken as the difference between two
 * projected points rather than by rotating by the tilt angle, so it stays
 * correct however w2s is built - including the fit scale a mid-turn board is
 * shrunk by, which a hand-rolled rotation would quietly ignore.
 */
function screenDir(w2s: (x: number, y: number) => Vec, at: Vec, d: Vec): Vec {
  const a = w2s(at.x, at.y);
  const b = w2s(at.x + d.x * 20, at.y + d.y * 20);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export class ChromeLayer {
  /**
   * In-board chrome. The rim and danger frame are drawn with wide soft strokes
   * CENTRED on the board boundary, so half of each stroke falls outside it.
   * They must therefore live inside the board mask (as they do in the classic
   * renderer) or the halo blooms out across the page as a heavy floating
   * rectangle - which is exactly what it does unclipped.
   */
  readonly container = new Container();
  /** Chrome that legitimately sits OUTSIDE the board: just the space bar. */
  readonly outer = new Container();

  private rim = new Graphics();
  private edges = new Graphics();
  private danger = new Graphics();
  private gravity = new Graphics();
  private bar = new Graphics();

  constructor() {
    // Live edges sit over the rim (they REPLACE what it says about those
    // sides) and under the danger frame, which outranks everything.
    this.container.addChild(this.rim, this.edges, this.danger, this.gravity);
    this.outer.addChild(this.bar);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    w2s: (x: number, y: number) => Vec,
    scale: number,
    now: number,
    spaceThreshold: number,
  ): void {
    this.drawRim(game, light, scale, now);
    this.drawEdges(game, w2s, scale, now);
    this.drawDanger(game, scale, now);
    this.drawGravity(game, scale, now);
    this.drawBar(game, scale, now, spaceThreshold);
  }

  /**
   * The perimeter. Three concentric strokes stand in for a baked glow: a wide
   * faint halo, a mid band, then one crisp hairline exactly on the boundary.
   * Only the hairline is pixel-snapped - snapping the halos would make them
   * jump a pixel as the board resizes, and nobody can see a halo's exact edge
   * anyway.
   */
  private drawRim(game: CanvasGameState, light: LightScope, scale: number, now: number): void {
    const { left, top, width, height } = game.boardRect;
    const g = this.rim;
    g.clear();

    const breathe = 0.8 + 0.2 * Math.sin(now * 0.0014);
    const level = breathe * light.level;

    g.rect(left, top, width, height).stroke({ width: 10 * scale, color: PALETTE.accent, alpha: 0.08 * level });
    g.rect(left, top, width, height).stroke({ width: 4 * scale, color: PALETTE.accent, alpha: 0.22 * level });

    const r = snapRect(left, top, width, height);
    g.rect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1)
      .stroke({ width: hairline(), color: PALETTE.accent, alpha: 0.85 * level });

    // Corner ticks: a console bezel cue, and they make the board feel mounted
    // rather than floating.
    const size = snapWidth(6 * scale);
    for (const [cx, cy] of [
      [r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height],
    ] as [number, number][]) {
      const q = snapRect(cx - size / 2, cy - size / 2, size, size);
      g.rect(q.x, q.y, q.width, q.height).fill({ color: PALETTE.accent, alpha: 0.9 * level });
    }
  }

  /**
   * The four outer walls, when a map has made them live.
   *
   * Reported as "the player must see that the outer edges aren't normal, that
   * they are bouncers". Level 14's floor kicks, its lid damps and its side
   * walls fire a ball back across, and every one of them rendered as the same
   * green hairline the other thirteen maps have.
   *
   * Three passes per side, loudest last: two stacked bands standing in for a
   * glow, a coloured rail ON the boundary where the ordinary green hairline
   * would be, and chevrons pointing the way that wall throws. See edgeCue.ts
   * for what each side is allowed to say and why.
   *
   * Everything here is scaled by `wake`, the nearest ball's closeness to that
   * side, so a wall brightens as a ball comes at it and flares as it is struck.
   * That is the pass that actually teaches the rule: the band says a wall is
   * live, the flare says THIS wall is what just happened to your ball.
   *
   * Costs nothing on a map that authors no edges: `boardEdges` is absent and
   * this returns before touching a Graphics.
   */
  private drawEdges(
    game: CanvasGameState,
    w2s: (x: number, y: number) => Vec,
    scale: number,
    now: number,
  ): void {
    const g = this.edges;
    g.clear();

    const specs = game.boardEdges;
    if (!specs || !game.boardPolygon) return;

    // The PLAY area, not the board rect: see edgeGeometry. Under a tilt the
    // corners come back through the same w2s every other layer uses, so the
    // bands ride round with the board rather than staying stuck to the screen.
    const bounds = polygonBounds(game.boardPolygon);
    const band = Math.max(3, 9 * scale);
    const breathe = 0.85 + 0.15 * Math.sin(now * 0.0018);

    for (const side of BOARD_SIDES) {
      const look = edgeLook(side, specs[side]);
      if (!look) continue;

      const geo = edgeGeometry(side, bounds);
      const a = w2s(geo.start.x, geo.start.y);
      const c = w2s(geo.end.x, geo.end.y);
      const inward = screenDir(w2s, geo.start, geo.inward);
      const thrown = screenDir(w2s, geo.start, look.direction);

      const wake = edgeWake(side, bounds, game.balls);
      const level = look.strength * (0.62 + 0.38 * wake) * breathe;

      this.bandQuad(a, c, inward, band * 2.4, look.colour, (0.05 + 0.09 * wake) * look.strength);
      this.bandQuad(a, c, inward, band, look.colour, (0.13 + 0.22 * wake) * look.strength);
      // The rail. One coloured line where every other map has one green one is
      // the whole cue at a glance, before any of the rest is read.
      this.bandQuad(a, c, inward, snapWidth(Math.max(2, 3 * scale)), look.colour,
        Math.min(0.95, 0.45 + 0.5 * level));

      this.drawEdgeArrows(a, c, inward, thrown, look.colour, look.arrows, scale, now, level, wake);
    }
  }

  /**
   * One band hugging a side, `t` thick, drawn inward from the boundary.
   *
   * Snapped when it is axis-aligned, which is every frame of a map that does
   * not tilt: an unsnapped 3px rail is exactly the 2px grey smear pixelGrid
   * exists to prevent. Mid-tilt the quad is rotated and is left alone, on the
   * same rule the rest of this renderer follows for diagonals.
   */
  private bandQuad(a: Vec, c: Vec, inward: Vec, t: number, colour: number, alpha: number): void {
    if (alpha <= 0.005 || t <= 0) return;
    const g = this.edges;
    const pts: Vec[] = [
      a, c,
      { x: c.x + inward.x * t, y: c.y + inward.y * t },
      { x: a.x + inward.x * t, y: a.y + inward.y * t },
    ];
    if (Math.abs(a.x - c.x) < 0.5 || Math.abs(a.y - c.y) < 0.5) {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const r = snapRect(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
      g.rect(r.x, r.y, r.width, r.height).fill({ color: colour, alpha });
      return;
    }
    g.poly(pts.flatMap(p => [p.x, p.y])).fill({ color: colour, alpha });
  }

  /**
   * Chevrons along a live side, pointing the way it throws.
   *
   * They breathe along that direction rather than marching along the wall: a
   * row of marks crawling sideways reads as a conveyor, which is the one thing
   * these walls do not do. The breath doubles as the contact cue - `wake`
   * shoves them a further half-length out as a ball arrives, so the wall visibly
   * pushes.
   */
  private drawEdgeArrows(
    a: Vec, c: Vec, inward: Vec, dir: Vec,
    colour: number, arrows: number,
    scale: number, now: number, level: number, wake: number,
  ): void {
    const g = this.edges;
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len <= 0) return;
    const ux = (c.x - a.x) / len, uy = (c.y - a.y) / len;   // along the wall
    const px = -dir.y, py = dir.x;                          // the chevron's arms
    // Few and large rather than many and small: at 7px a chevron read as part
    // of the grid lattice on a phone, and a run of twenty of them read as a
    // texture rather than as an instruction.
    const size = Math.max(5, 10 * scale);
    const gap = Math.max(34, 72 * scale);
    const stand = Math.max(9, 19 * scale) + (Math.sin(now * 0.0045) * 0.25 + wake * 0.6) * size;
    // Against hairline() rather than a flat 2, for the reason pixelGrid gives:
    // a width tuned in device pixels on a desktop vanishes on a 3x phone.
    const width = Math.max(1.5 * hairline(), 2.4 * scale);

    for (let s = gap * 0.5; s < len; s += gap) {
      // Fade the ends so the run dissolves into the corners rather than
      // stopping dead in them, where two live sides would otherwise collide.
      const fade = Math.min(1, Math.min(s, len - s) / (gap * 1.2));
      const alpha = 0.8 * level * fade;
      if (alpha <= 0.02) continue;
      const bx = a.x + ux * s + inward.x * stand;
      const by = a.y + uy * s + inward.y * stand;
      for (let n = 0; n < arrows; n++) {
        // A second chevron stacked behind the first is how a side says "and
        // faster": one mark is a direction, two is a shove.
        const tipX = bx + dir.x * (size - n * size * 1.15);
        const tipY = by + dir.y * (size - n * size * 1.15);
        g.moveTo(tipX - dir.x * size + px * size, tipY - dir.y * size + py * size)
          .lineTo(tipX, tipY)
          .lineTo(tipX - dir.x * size - px * size, tipY - dir.y * size - py * size)
          .stroke({ width, color: colour, alpha: n === 0 ? alpha : alpha * 0.55, cap: "round", join: "round" });
      }
    }
  }

  /** Red frame as any ball approaches danger speed. Pure warning, no light. */
  private drawDanger(game: CanvasGameState, scale: number, now: number): void {
    const g = this.danger;
    g.clear();

    let worst = 0;
    for (const b of game.balls) {
      if (b.speed <= 0) continue;
      worst = Math.max(worst, b.speed / BALL_DANGER_SPEED);
    }
    if (worst <= DANGER_FLOOR) return;

    const { left, top, width, height } = game.boardRect;
    const t = Math.min(1, (worst - DANGER_FLOOR) / (1 - DANGER_FLOOR));
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + Math.PI);
    const alpha = t * 0.45 * (0.55 + 0.45 * pulse);

    g.rect(left, top, width, height).stroke({ width: 12 * scale, color: PALETTE.danger, alpha: alpha * 0.35 });
    g.rect(left, top, width, height).stroke({ width: 5 * scale, color: PALETTE.danger, alpha });
  }

  /**
   * The pull, and when it changes.
   *
   * A band on the edge the board is tipping toward, chevrons running that way,
   * and a bar draining to the next shift. Drawn as chrome rather than scenery
   * because it is a statement ABOUT the board rather than a thing on it, and
   * because the danger frame beside it already established that a coloured
   * frame is how this game says "a condition is in force".
   *
   * The direction comes from gravityCue in SCREEN space, so during the 0.7s of
   * a turn the band slides round the frame with the board instead of jumping.
   *
   * Costs nothing on a map without gravity: the cue is null and this returns
   * before touching anything.
   */
  private drawGravity(game: CanvasGameState, scale: number, now: number): void {
    const g = this.gravity;
    g.clear();

    const tilt = boardAngleFor(game.activePlaySeconds, game.gravityConfig, game.boardTilt);
    const cue = gravityCue(game.gravityConfig, game.activePlaySeconds, tilt);
    if (!cue) return;

    const { left, top, width, height } = game.boardRect;
    // Snapped like everything else axis-aligned in this layer. All of it is
    // straight edges and flat fills, and an unsnapped 3px bar is precisely the
    // 2px grey smear pixelGrid exists to prevent. The chevrons below are the
    // one exception, and deliberately: their arms are diagonals, and rounding a
    // diagonal's endpoints quantises its slope.
    const band = snapWidth(Math.max(3, 10 * scale));

    if (cue.pull) {
      // The low side of a tipped table. Two stacked bands rather than a
      // gradient: Graphics has no cheap one, and the wide faint pass under a
      // narrow bright one reads as a glow at a fraction of the cost.
      const wide = pullEdge(cue.pull, { left, top, width, height }, snapWidth(band * 2.2));
      const near = pullEdge(cue.pull, { left, top, width, height }, band);
      const outer = snapRect(wide.x, wide.y, wide.width, wide.height);
      const inner = snapRect(near.x, near.y, near.width, near.height);
      const breathe = 0.85 + 0.15 * Math.sin(now * 0.0016);
      g.rect(outer.x, outer.y, outer.width, outer.height)
        .fill({ color: PALETTE.gravity, alpha: 0.07 * breathe });
      g.rect(inner.x, inner.y, inner.width, inner.height)
        .fill({ color: PALETTE.gravity, alpha: 0.16 * breathe });

      // Chevrons drifting the way the pull runs. The band alone says WHICH
      // EDGE; only motion says which way things are being dragged, and on a
      // square board those are not the same statement.
      this.drawChevrons(cue.pull, game, scale, now);
    }

    // The countdown. It runs whether or not a pull is active, because the
    // arrival of one is as worth telegraphing as its departure: a calm stretch
    // ending is the moment the board starts dragging again.
    const remaining = 1 - cue.progress;
    const urgent = cue.urgent;
    const barW = snapWidth(Math.max(2, 3 * scale));
    const colour = urgent ? PALETTE.amber : PALETTE.gravity;
    // Along the TOP edge, away from the pull band, so the two never overlap on
    // a downward pull (the most common phase there is).
    const track = snapRect(left + band, top + band, width - band * 2, barW);
    // The lit width is snapped too: a fractional end would shimmer as it drains.
    const lit = snapEdge(track.width * Math.max(0, Math.min(1, remaining)));
    g.rect(track.x, track.y, track.width, track.height).fill({ color: colour, alpha: 0.12 });
    if (lit > 0) {
      const pulse = urgent ? 0.75 + 0.25 * Math.sin(now * 0.012) : 1;
      g.rect(track.x, track.y, lit, track.height).fill({ color: colour, alpha: 0.7 * pulse });
    }

    // Where it goes next, once the shift is close enough to act on. A ghost of
    // the same band on the edge the pull jumps to, so the player can commit a
    // cut to where the board is about to tip rather than where it is tipped.
    if (cue.next && cue.urgent) {
      const t = 1 - cue.secondsLeft / URGENT_SECONDS;    // 0 -> 1 as it lands
      const edge = pullEdge(cue.next, { left, top, width, height }, band);
      const ghost = snapRect(edge.x, edge.y, edge.width, edge.height);
      g.rect(ghost.x, ghost.y, ghost.width, ghost.height)
        .fill({ color: PALETTE.amber, alpha: 0.05 + 0.18 * t });
    }
  }

  /** Three chevrons mid-board, pointing (and drifting) along the pull. */
  private drawChevrons(
    dir: { x: number; y: number },
    game: CanvasGameState,
    scale: number,
    now: number,
  ): void {
    const g = this.gravity;
    const { left, top, width, height } = game.boardRect;
    const cx = left + width / 2, cy = top + height / 2;
    const size = Math.max(4, 9 * scale);
    const gap = size * 2.6;
    // A slow crawl along the pull, so the cue has motion without competing
    // with anything the player is actually aiming at.
    const drift = ((now * 0.02) % gap);
    const px = -dir.y, py = dir.x;   // perpendicular, for the chevron's arms

    for (let i = 0; i < 3; i++) {
      const along = (i - 1) * gap + drift;
      const tipX = cx + dir.x * along, tipY = cy + dir.y * along;
      // Fade the ends so they emerge and dissolve rather than popping.
      const edge = Math.abs(along) / (gap * 1.8);
      const alpha = 0.3 * Math.max(0, 1 - edge * edge);
      if (alpha <= 0.01) continue;
      g.moveTo(tipX - dir.x * size + px * size, tipY - dir.y * size + py * size)
        .lineTo(tipX, tipY)
        .lineTo(tipX - dir.x * size - px * size, tipY - dir.y * size - py * size)
        .stroke({ width: Math.max(1, 2 * scale), color: PALETTE.gravity, alpha, cap: "round" });
    }
  }

  /**
   * Space progress: how close the captured area is to this map's clear target.
   * Sits just under the board and fades once the map is won, so it is gone
   * before the clear celebration rather than sitting under it.
   */
  private drawBar(game: CanvasGameState, scale: number, now: number, threshold: number): void {
    const g = this.bar;
    g.clear();
    if (!game.spaceGrid) return;

    const fade = game.levelComplete
      ? 1 - (now - (game.levelCompleteTime ?? 0)) / BAR_FADE_MS
      : 1;
    if (fade <= 0) return;

    const remaining = getRemainingPercent(game.spaceGrid);
    const target = 100 - threshold;
    const ratio = Math.min(1, target > 0 ? (100 - remaining) / target : 1);

    const { left, top, width, height } = game.boardRect;
    const track = snapRect(left, top + height + snapWidth(3 * scale), width, snapWidth(4 * scale));

    g.rect(track.x, track.y, track.width, track.height).fill({ color: 0x000000, alpha: 0.4 * fade });

    const fillW = Math.round(track.width * ratio);
    if (fillW <= 0) return;
    const done = ratio >= 1;
    g.rect(track.x, track.y, fillW, track.height)
      .fill({ color: done ? 0x00ff44 : PALETTE.accent, alpha: 0.8 * fade });

    // The target notch, so "how much more" is a position, not a calculation.
    if (!done) {
      const x = snapStroke(track.x + track.width, 1);
      g.moveTo(x, track.y).lineTo(x, track.y + track.height)
        .stroke({ width: hairline(), color: PALETTE.accentGlow, alpha: 0.7 * fade });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.outer.destroy({ children: true });
  }
}

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

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    const areas = game.coloredAreas ?? [];
    // Before the key check: the pulse is time-driven, so it must run on frames
    // where nothing about the areas themselves changed.
    this.drawPulse(areas, light, w2s);
    const key =
      areas
        .map(a => `${a.x},${a.y},${a.width},${a.height},${a.kind},${isGateArea(a) ? 1 : 0},${a.satisfied ? 1 : 0}`)
        .join("|") + `|${Math.round(game.boardRect.left)},${Math.round(game.boardRect.top)},${Math.round(scale * 1000)}`;
    if (key === this.key) return;
    this.key = key;

    this.g.clear();
    for (const t of this.labels) { t.parent?.removeChild(t); t.destroy(); }
    this.labels = [];

    for (const a of areas) {
      const st = areaStyle(a.kind);
      const gate = isGateArea(a);
      const lit = !!a.satisfied;
      const color = Number.parseInt(st.color.replace("#", ""), 16);
      // A dormant zone is drawn drained and faint; a live one keeps full chroma
      // and gets the pulse on top. The gap between the two is the whole point.
      const inkColor = lit ? color : dormantColor(color, gate);

      const tl = w2s(a.x, a.y);
      const br = w2s(a.x + a.width, a.y + a.height);
      // A floor marking is axis-aligned by definition, so it snaps outright.
      const r = snapRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      // Ambient only: the marking is part of the surface.
      const amb = ambientAt(light, r.x + r.width / 2, r.y + r.height / 2);
      // A lit zone deliberately paints LIGHTER than it used to: the breathing
      // wash from drawPulse sits on top of this every frame, and the two
      // stacked at the old weight read as a solid block. A dormant one paints
      // fainter still, so the contrast lives in the gap between them.
      const fill = (lit ? 0.12 : gate ? 0.07 : 0.03) * (0.55 + amb * 0.45);
      this.g.rect(r.x, r.y, r.width, r.height).fill({ color: inkColor, alpha: fill });

      if (lit) {
        // Occupied: solid and bright, unmistakably "this one is done".
        this.g
          .rect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1)
          .stroke({ width: 2, color, alpha: 0.95 * light.level });
      } else {
        const dash = gate ? 9 * scale : 3 * scale;
        const gap = gate ? 6 * scale : 5 * scale;
        const x0 = r.x + 0.5, y0 = r.y + 0.5;
        const x1 = r.x + r.width - 0.5, y1 = r.y + r.height - 0.5;
        dashedLine(this.g, x0, y0, x1, y0, dash, gap);
        dashedLine(this.g, x1, y0, x1, y1, dash, gap);
        dashedLine(this.g, x1, y1, x0, y1, dash, gap);
        dashedLine(this.g, x0, y1, x0, y0, dash, gap);
        this.g.stroke({
          width: hairline(),
          color: inkColor,
          alpha: (gate ? 0.55 : 0.28) * light.level,
        });
      }

      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const labelPx = Math.max(13, Math.min(r.width, r.height) * 0.2);
      // The label carries the state too: a dormant bonus zone reads as a faded
      // stencil, a live one as a lit sign.
      const alpha = lit ? 1 : gate ? 0.7 : 0.4;

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

      const tl = w2s(a.x, a.y);
      const br = w2s(a.x + a.width, a.y + a.height);
      const r = snapRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      const p = zonePulse(since);

      // A ring that expands OUT of the border during the flare, which reads as
      // the zone firing rather than merely getting brighter.
      if (p.flare > 0.01) {
        this.pulseG
          .rect(r.x - p.grow, r.y - p.grow, r.width + p.grow * 2, r.height + p.grow * 2)
          .stroke({ width: 2 + p.flare * 3, color, alpha: 0.85 * p.flare * light.level });
      }

      this.pulseG.rect(r.x, r.y, r.width, r.height).fill({ color, alpha: p.fillAlpha });
      this.pulseG
        .rect(r.x + 2.5, r.y + 2.5, r.width - 5, r.height - 5)
        .stroke({ width: 1.5, color, alpha: p.strokeAlpha * light.level });
    }

    // Leaving a stale pulse on screen would be worse than none at all.
    if (!pulsing && this.wasPulsing) this.pulseG.clear();
    this.wasPulsing = pulsing;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

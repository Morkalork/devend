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
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { areaStyle, isGateArea } from "@/lib/coloredAreas";
import { dashedLine } from "./dashedLine";
import { ambientAt, type LightScope } from "./light";
import { snapRect, type Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

export class AreaLayer {
  readonly container = new Container();

  private g = new Graphics();
  private labels: Text[] = [];
  private key = "";

  constructor() {
    this.container.addChild(this.g);
  }

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    const areas = game.coloredAreas ?? [];
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

      const tl = w2s(a.x, a.y);
      const br = w2s(a.x + a.width, a.y + a.height);
      // A floor marking is axis-aligned by definition, so it snaps outright.
      const r = snapRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      // Ambient only: the marking is part of the surface.
      const amb = ambientAt(light, r.x + r.width / 2, r.y + r.height / 2);
      const fill = (lit ? 0.3 : gate ? 0.11 : 0.06) * (0.55 + amb * 0.45);
      this.g.rect(r.x, r.y, r.width, r.height).fill({ color, alpha: fill });

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
          width: 1,
          color,
          alpha: (gate ? 0.8 : 0.5) * light.level,
        });
      }

      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const labelPx = Math.max(13, Math.min(r.width, r.height) * 0.2);
      const alpha = gate ? 1 : 0.7;

      const kind = new Text({
        text: st.label,
        style: new TextStyle({
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: labelPx,
          fill: color,
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
          fill: color,
        }),
      });
      mult.anchor.set(0.5, 0);
      mult.position.set(Math.round(cx), Math.round(cy + labelPx * 0.35));
      mult.alpha = alpha;

      this.container.addChild(kind, mult);
      this.labels.push(kind, mult);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

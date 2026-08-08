/**
 * Board chrome: the perimeter rim, the speed-danger frame and the space bar.
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
import { snapRect, snapStroke, snapWidth } from "./pixelGrid";

/** Ball speed (as a fraction of the danger threshold) before the frame shows. */
const DANGER_FLOOR = 0.55;
/** The space bar fades out over this long once the map is won. */
const BAR_FADE_MS = 600;

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
  private danger = new Graphics();
  private bar = new Graphics();

  constructor() {
    this.container.addChild(this.rim, this.danger);
    this.outer.addChild(this.bar);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    scale: number,
    now: number,
    spaceThreshold: number,
  ): void {
    this.drawRim(game, light, scale, now);
    this.drawDanger(game, scale, now);
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
      .stroke({ width: 1, color: PALETTE.accent, alpha: 0.85 * level });

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
        .stroke({ width: 1, color: PALETTE.accentGlow, alpha: 0.7 * fade });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.outer.destroy({ children: true });
  }
}

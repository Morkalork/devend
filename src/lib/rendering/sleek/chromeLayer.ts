/**
 * Board chrome: the perimeter rim, the speed-danger frame, the gravity cue and
 * the space bar.
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
import { snapRect, snapStroke, snapWidth, hairline } from "./pixelGrid";
import { boardAngleFor } from "@/lib/boardTilt";
import { gravityCue, pullEdge, URGENT_SECONDS } from "./gravityCue";

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
  private gravity = new Graphics();
  private bar = new Graphics();

  constructor() {
    this.container.addChild(this.rim, this.danger, this.gravity);
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
    const band = Math.max(3, 10 * scale);

    if (cue.pull) {
      // The low side of a tipped table. Two stacked bands rather than a
      // gradient: Graphics has no cheap one, and the wide faint pass under a
      // narrow bright one reads as a glow at a fraction of the cost.
      const outer = pullEdge(cue.pull, { left, top, width, height }, band * 2.2);
      const inner = pullEdge(cue.pull, { left, top, width, height }, band);
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
    const barW = Math.max(2, 3 * scale);
    const colour = urgent ? PALETTE.amber : PALETTE.gravity;
    // Along the TOP edge, away from the pull band, so the two never overlap on
    // a downward pull (the most common phase there is).
    const full = width - band * 2;
    const lit = full * Math.max(0, Math.min(1, remaining));
    const y = top + band;
    g.rect(left + band, y, full, barW).fill({ color: colour, alpha: 0.12 });
    if (lit > 0) {
      const pulse = urgent ? 0.75 + 0.25 * Math.sin(now * 0.012) : 1;
      g.rect(left + band, y, lit, barW).fill({ color: colour, alpha: 0.7 * pulse });
    }

    // Where it goes next, once the shift is close enough to act on. A ghost of
    // the same band on the edge the pull jumps to, so the player can commit a
    // cut to where the board is about to tip rather than where it is tipped.
    if (cue.next && cue.urgent) {
      const t = 1 - cue.secondsLeft / URGENT_SECONDS;    // 0 -> 1 as it lands
      const ghost = pullEdge(cue.next, { left, top, width, height }, band);
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

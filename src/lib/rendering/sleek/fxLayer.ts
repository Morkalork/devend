/**
 * Transient effects: the lock flash, chains, collapse debris and falling slabs.
 *
 * These are the moments the board rewards or punishes you, so they are the one
 * place the renderer is allowed to be loud. They are still bound by the light
 * model, with one deliberate exception: a lock flash EMITS. For the second it
 * burns it is the brightest thing on the board and takes no ambient dimming,
 * because it is the payoff for the whole loop.
 *
 * Everything here is culled by the physics layer; this module only draws what
 * it is handed and never mutates game state.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
// Imported, never re-declared: these govern how long the physics keeps a marker
// alive, and a local copy that drifts makes markers disappear early.
import { PICKUP_DRAW_RADIUS, PICKUP_FEEDBACK_MS } from "@/lib/pickups";
import { BUG_RADIUS, BUG_SPLAT_MS } from "@/lib/physics/bugs";
import { getBug } from "@/lib/bugs";
import { superiorSparkles, sparklePoints, SPARKLE_RADIUS } from "./superiorSparkle";
import {
  computeBallTrajectory, trajectoryBallSnapshots, buildTrajectorySegments,
  trajectoryTurnsFor,
} from "@/lib/gameUtils";
import { steerWorldOf } from "@/lib/physics/steering";
import { isLoadedSling, slingShape, slingCatches, slingGrabReach } from "@/lib/physics/slingFence";
import { isArmedBreakpoint } from "@/lib/physics/breakpointFence";
import { getFenceType } from "@/lib/fences";
import { dashedLine } from "./dashedLine";
import { lockImpact } from "./lockImpact";
import { mirrorOwner } from "./derivedLight";
import { rubbleAlpha } from "@/lib/physics/rubble";
import { getLightLook } from "@/lib/lightLook";
import { REACH_RADII } from "./ballLight";
import { closestOnSegment } from "./ballBounce";
import { LOCK_FLASH_MS, SUPERIOR_FLASH_MS } from "./flashLight";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { vec2Sub, vec2Length, vec2Normalize } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, shadowFor, type LightScope } from "./light";
import type { Pt } from "./pixelGrid";
import { bentDrawnPath, joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";

/** Opacity of the predicted path. A forecast, so never fully opaque. */
const TRAJECTORY_ALPHA = 0.5;
/** World units the line drifts past the last bounce before it is gone. */
const TAIL_WORLD = 130;
/** Alpha steps across that drift. One stroke each, whatever the ball count. */
const TAIL_BANDS = 6;

type W2S = (x: number, y: number) => Pt;

/** How long a lock flash burns. Mirrors the classic renderer's feel. */
/**
 * Magnet marker lifetime. Not exported from anywhere shared - the physics culls
 * the marker on its own clock - so this must stay 1100 to match. Guessing it
 * shorter makes the marker vanish while the state says it is still live.
 */
const MAGNET_MARKER_MS = 1100;

/** Token colours, mirroring propLayer so a claim ring matches its token. */
const PICKUP_FX_COLORS: Record<string, number> = {
  overtime: 0x00ff88,
  capRaise: 0xffd76b,
  freezeCharge: 0xbfefff,
  fork: 0xff9ebf,
  freeShopItem: 0x9fe6ff,
  extraLife: 0xff5b7a,
  rainbowConvert: 0xffbf80,
};

function parseColor(c: string, fallback: number): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** How long the Breakpoint's "held it" ring burns. Nothing else reads this:
 *  the physics clears no flash, so the fade below is the whole lifetime. */
const BREAKPOINT_FLASH_MS = 650;

/** Must match CLAIM_FLASH_MS in applyCut, which stamps the flashes. */
const CLAIM_FLASH_MS = 420;

export class FxLayer {
  readonly container = new Container();

  private under = new Graphics();  // pocket fills, below the actors
  private over = new Graphics();   // sparks, chains, debris
  /** Splat names (see drawBugSplats). Above the Graphics, so text is never buried. */
  private labels = new Container();
  /**
   * Pooled Text objects for those names, with the string each one currently
   * holds.
   *
   * Pooled rather than built per frame, which is what the rest of this renderer
   * would have done to it otherwise: a splat lives 1.3 seconds, so a fresh Text
   * per frame is eighty short-lived objects and eighty texture uploads per
   * squash, and Pixi re-rasterises a Text whenever its string is ASSIGNED, not
   * only when it changes. Both are avoided by keeping the slots and comparing
   * the string first.
   */
  private labelPool: { text: Text; current: string }[] = [];

  constructor() {
    this.container.addChild(this.under, this.over, this.labels);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    mods: GameModifiers,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    this.under.clear();
    this.over.clear();
    // Every label starts the frame hidden; drawBugSplats turns back on exactly
    // the ones it uses. Clearing by hiding rather than by destroying is what
    // makes the pool a pool.
    for (const slot of this.labelPool) slot.text.visible = false;

    this.drawCutPreview(game, w2s, scale);
    this.drawSlings(game, w2s, scale, now);
    this.drawBreakpoints(game, w2s, scale, now);
    this.drawClaimFlashes(game, w2s, now);
    this.drawLockFlashes(game, w2s, scale, now);
    this.drawChains(game, light, w2s, scale);
    this.drawRubble(game, light, w2s, scale, now);
    this.drawMirrorGlints(game, w2s, scale);
    this.drawDebris(game, w2s, scale, now);
    this.drawShellShatters(game, light, w2s, scale, now);
    this.drawFalling(game, light, w2s, now);
    this.drawAbilityFx(game, w2s, scale, now);
    this.drawMagnetMarker(game, w2s, scale, now);
    this.drawPickupFeedback(game, w2s, scale, now);
    this.drawBugSplats(game, w2s, scale, now);
    this.drawMoverFriction(game, w2s, scale, now);
    this.drawLockMarkers(game, w2s, scale);
    this.drawSuperiorSparkles(game, w2s, scale, now);
    this.drawBallPops(game, w2s, scale, now);
    this.drawTrajectory(game, mods, w2s, scale);
  }

  /**
   * The Breakpoint fences: a mark while the map's hold is still there.
   *
   * The budget is per MAP, so every Breakpoint on the board is armed or none
   * of them is, and they all go dark together the moment one fires. That is
   * the whole of the UI it needs: no counter, no meter, just a fence that
   * looks live and then does not.
   *
   * Drawn as a bracket rather than a dot - the grip idiom belongs to Redeploy,
   * and two different mechanics wearing one mark would be worse than either
   * being unmarked.
   */
  private drawBreakpoints(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const wall of game.walls) {
      if (!isArmedBreakpoint(game, wall)) continue;
      const colour = parseColor(getFenceType(wall.fenceTypeId).color, PALETTE.accent);
      const a = w2s(wall.start.x, wall.start.y);
      const b = w2s(wall.end.x, wall.end.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Across the fence, not along it: the mark has to read at a glance on a
      // fence drawn at any angle.
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const arm = 9 * scale;
      const pulse = 0.6 + 0.4 * Math.sin(now / 380);
      this.over
        .moveTo(mid.x - nx * arm, mid.y - ny * arm)
        .lineTo(mid.x + nx * arm, mid.y + ny * arm)
        .stroke({ width: Math.max(2, 3 * scale), color: colour, alpha: 0.9 * pulse });
      this.over.circle(mid.x, mid.y, 3 * scale).fill({ color: colour, alpha: 0.95 });
    }

    // The moment it fires, where it fired. A ring rather than a label: the ball
    // stopping is the message, and this only has to say WHICH stop that was.
    const flash = game.breakpointFlash;
    if (!flash) return;
    const elapsed = now - flash.startTime;
    if (elapsed < 0 || elapsed >= BREAKPOINT_FLASH_MS) return;
    const t = elapsed / BREAKPOINT_FLASH_MS;
    const p = w2s(flash.x, flash.y);
    this.over.circle(p.x, p.y, (18 + 34 * t) * scale)
      .stroke({ width: Math.max(2, 3 * scale), color: 0xb8a1ff, alpha: (1 - t) * 0.9 });
  }

  /**
   * The Redeploy fences: the grip on a loaded one, and the stretch on the one
   * being pulled.
   *
   * Drawn here rather than in the wall layer because neither is a fence. The
   * grip is a control, and the stretched band is a projection of intent - the
   * same category as the cut preview, and drawn beside it for the same reason:
   * a player has to be able to see what to grab before they have grabbed it,
   * and what they will throw before they let go.
   *
   * A spent fence gets no grip. That is the whole of the "once per fence" UI:
   * the affordance disappears when the throw does, so there is nothing to count
   * and no meter to read.
   */
  private drawSlings(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const drag = game.slingDrag;
    const dragWall = drag ? game.walls.find(w => w.id === drag.wallId) : undefined;

    // Grips, on every loaded fence except the one in hand (which is drawn as a
    // band below, and would otherwise carry a grip at a place it no longer is).
    for (const wall of game.walls) {
      if (!isLoadedSling(wall)) continue;
      if (dragWall && wall === dragWall) continue;
      const colour = parseColor(getFenceType(wall.fenceTypeId).color, PALETTE.accent);
      const mid = w2s((wall.start.x + wall.end.x) / 2, (wall.start.y + wall.end.y) / 2);
      // The grab target, drawn at the radius the grab actually tests. A grip
      // drawn smaller than the target teaches the player to aim finer than they
      // need to, which is how a throw came out as a cut; drawn larger it would
      // promise a grab that does not happen. Faint, because it is a hint about
      // where to press rather than a thing on the board.
      this.over.circle(mid.x, mid.y, slingGrabReach(wall) * scale)
        .fill({ color: colour, alpha: 0.07 });
      // A slow breathe, so a loaded fence reads as waiting rather than as a
      // decoration somebody painted on it.
      const pulse = 0.75 + 0.25 * Math.sin(now / 420);
      this.over.circle(mid.x, mid.y, 11 * scale * pulse)
        .stroke({ width: Math.max(1.5, 2 * scale), color: colour, alpha: 0.85 });
      this.over.circle(mid.x, mid.y, 4 * scale).fill({ color: colour, alpha: 0.9 });
    }

    if (!drag || !dragWall) return;
    const shape = slingShape(dragWall, {
      x: drag.current.x - drag.start.x,
      y: drag.current.y - drag.start.y,
    });
    if (!shape) return;

    const colour = parseColor(getFenceType(dragWall.fenceTypeId).color, PALETTE.accent);
    const a = w2s(shape.a.x, shape.a.y);
    const b = w2s(shape.b.x, shape.b.y);
    // The bow: the band's midpoint dragged back OPPOSITE the throw, by the pull
    // that was actually made. A quadratic through it, so it stretches the way a
    // band does instead of hinging like a lever.
    const pullLen = Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y);
    const mid = w2s(
      (shape.a.x + shape.b.x) / 2 - shape.heading.x * pullLen,
      (shape.a.y + shape.b.y) / 2 - shape.heading.y * pullLen,
    );
    const quad = (width: number, color: number, alpha: number) => {
      this.over.moveTo(a.x, a.y).quadraticCurveTo(mid.x, mid.y, b.x, b.y)
        .stroke({ width, color, alpha, cap: "round" });
    };
    quad((WALL_THICKNESS + 6) * scale, 0x000000, 0.5);
    quad((WALL_THICKNESS + 2) * scale * (0.6 + 0.4 * shape.powerT), colour, 0.95);

    // Where it will throw, from the fence's resting line: the aim, not the pull.
    const c = w2s(shape.centre.x, shape.centre.y);
    const tip = w2s(
      shape.centre.x + shape.heading.x * 70,
      shape.centre.y + shape.heading.y * 70,
    );
    dashedLine(this.over, c.x, c.y, tip.x, tip.y, 6 * scale, 7 * scale);
    this.over.stroke({ width: Math.max(1.5, 2 * scale), color: colour, alpha: 0.6 });

    // Everything it would catch, ringed LIVE. The throw cannot be taken back,
    // so letting go has to be a confirmation rather than a guess - the same
    // promise the Rubber Band overlay makes, kept by the same sweep function.
    for (const ball of slingCatches(game, shape)) {
      const p = w2s(ball.position.x, ball.position.y);
      this.over.circle(p.x, p.y, (ball.radius + 8) * scale)
        .stroke({ width: Math.max(2, 2.5 * scale), color: colour, alpha: 0.9 });
    }
  }

  /**
   * Banked power-up badges: a dot per power-up a lock claimed, left in the
   * pocket for the rest of the map. Persistent, not transient - the point is to
   * be able to look at a sealed pocket later and see what it paid.
   */
  private drawLockMarkers(game: CanvasGameState, w2s: W2S, scale: number): void {
    for (const m of game.pickupLockMarkers ?? []) {
      const p = w2s(m.x, m.y);
      const color = PICKUP_FX_COLORS[m.effect] ?? PALETTE.amber;
      // Brief pop-in on the active-play clock, so it lands with the lock.
      const age = game.activePlaySeconds - m.bornActiveSeconds;
      const pop = age < 0.35 ? 0.5 + (age / 0.35) * 0.5 : 1;
      const r = 5 * scale * pop;
      this.under.circle(p.x, p.y, r * 1.9).fill({ color, alpha: 0.16 });
      this.under.circle(p.x, p.y, r).fill({ color, alpha: 0.9 });
    }
  }

  /**
   * The twinkle inside a superior pocket.
   *
   * Drawn into `over`, above the pocket's own tint and hatch: it is a catch of
   * light ON the ground, and a sparkle drawn under the wash would be a sparkle
   * nobody sees on the darkest part of the board.
   *
   * Three passes, because a single filled star is a gold polygon and not a
   * glint: a soft halo underneath it for the bloom, the star itself in gold,
   * and a small white core. The core is what sells it - a sparkle's centre is
   * always brighter than its arms, and without it the shape reads as a cut-out
   * rather than as something emitting.
   *
   * The schedule and the geometry are in superiorSparkle.ts; this only paints
   * what that hands back.
   */
  private drawSuperiorSparkles(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const sparkles = superiorSparkles(game.spaceGrid, game.superiorLockCount ?? 0, now);
    if (sparkles.length === 0) return;

    for (const s of sparkles) {
      const p = w2s(s.x, s.y);
      const r = SPARKLE_RADIUS * s.scale * scale;
      if (r < 0.4) continue;

      // Bloom, as two stacked discs rather than one. A single flat circle at a
      // low alpha reads as a disc WITH a star on it - the edge is visible, and
      // a glint does not have an edge. Two rings approximate the falloff a
      // gradient would give for the cost of one more fill.
      this.over
        .circle(p.x, p.y, r * 2.1)
        .fill({ color: PALETTE.superior, alpha: s.alpha * 0.07 });
      this.over
        .circle(p.x, p.y, r * 1.3)
        .fill({ color: PALETTE.superior, alpha: s.alpha * 0.13 });

      const pts = sparklePoints(p.x, p.y, r, s.rotation);
      this.over.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) this.over.lineTo(pts[i], pts[i + 1]);
      this.over.closePath();
      this.over.fill({ color: PALETTE.superior, alpha: s.alpha * 0.95 });

      this.over
        .circle(p.x, p.y, Math.max(0.4, r * 0.3))
        .fill({ color: 0xffffff, alpha: s.alpha });
    }
  }

  /** A white "tappable" ball was tapped away: a quick expanding pop. */
  private drawBallPops(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const pop of game.ballPops ?? []) {
      const t = (now - pop.startTime) / 420;
      if (t < 0 || t >= 1) continue;
      const p = w2s(pop.x, pop.y);
      const color = parseColor(pop.color, 0xffffff);
      this.over
        .circle(p.x, p.y, (6 + 26 * t) * scale)
        .stroke({ width: Math.max(1, 2 * scale), color, alpha: (1 - t) * 0.9 });
      this.over
        .circle(p.x, p.y, Math.max(0.5, 6 * scale * (1 - t)))
        .fill({ color, alpha: (1 - t) * 0.8 });
    }
  }

  /**
   * Trajectory prediction (the SCRUM Master modifier): where the tracked balls
   * are heading, bounces included. Dashed rather than solid, because it is a
   * forecast - a solid line would read as geometry that already exists.
   *
   * Both the bounce count and how many balls are tracked come from the upgrade,
   * so this is off entirely unless the player bought it.
   *
   * The line does not stop dead at the last bounce. It drifts on a little way
   * past it and fades out, because a hard stop against a wall reads as "the
   * ball ends here" rather than "this is as far as I can see". The drift is
   * the NEXT leg the ball would take, asked for by predicting one bounce more
   * than the upgrade paid for and then truncating it: that way it is a real
   * continuation of the path, clipped by real geometry, and never draws through
   * a wall the way an invented stub would.
   */
  private drawTrajectory(
    game: CanvasGameState,
    mods: GameModifiers,
    w2s: W2S,
    scale: number,
  ): void {
    const bounces = mods.ballPathPredictionBounces;
    const maxBalls = mods.ballPathPredictionBalls;
    if (bounces <= 0 || maxBalls <= 0) return;

    const active = game.balls
      .filter(b => b.state === "active")
      .sort((a, b) => b.speed - a.speed);
    const tracked = maxBalls >= 100 ? active : active.slice(0, maxBalls);

    // Built ONCE for the frame, not once per tracked ball: the surfaces are
    // identical for every prediction, and rebuilding them per ball made the cost
    // and the garbage scale with balls x segments for no difference in result.
    const segs = buildTrajectorySegments(game.walls, game.obstaclePolygons);
    const dash = 6 * scale, gap = 8 * scale;

    // Gathered first, drawn second: the fade needs one stroke per alpha band
    // across ALL balls, not per ball, or tracking every ball at once (the
    // Architect tier) would cost a stroke per ball per band.
    //
    // A POLYLINE, not a segment: under steering the drift follows the same
    // chords the rest of the path does, and a straight tail would cut across a
    // curve the ball is going to take.
    const tails: Pt[][] = [];

    for (const ball of tracked) {
      // Start from the RENDER position, not the physics one, so the line begins
      // exactly at the drawn ball rather than a step ahead of it.
      const start = ball.renderPosition ?? ball.position;
      const marks: number[] = [];
      const wps = computeBallTrajectory(
        start, ball.velocity, game.walls, bounces + 1, ball.radius,
        game.obstaclePolygons, game.movers, game.creepFactor || 1,
        trajectoryBallSnapshots(game.balls, ball, game.frozenBallId),
        segs,
        // Anything that bends a heading, read through the SAME rule updateBall
        // steers by. Passing the gravity config alone is what left this preview
        // blind to gravity wells on six authored maps, ignoring the Free Fall
        // bend multiplier, and deciding "is gravity on" from a different
        // expression than the physics used.
        { world: steerWorldOf(game), atSeconds: game.activePlaySeconds, baseSpeed: ball.baseSpeed },
        { bounceAt: marks },
        // The compass turn is EXACT and telegraphed a whole cycle ahead, so the
        // preview puts it where it really lands. Drawing straight through a
        // turn the ball has already committed to made the tracker useless on
        // precisely the ball it is most needed for.
        trajectoryTurnsFor(ball, game.activePlaySeconds),
      );
      if (wps.length < 2) continue;

      // Where the bounce budget runs out, by BOUNCE and not by waypoint index.
      // Under steering every chord pushes a waypoint too, so indexing by the
      // bounce count sliced the line down to a couple of chords that re-rooted
      // on the ball every frame - the preview slid instead of projecting.
      const lastPaid = marks.length >= bounces ? marks[bounces - 1] : wps.length - 1;

      for (let i = 0; i < lastPaid; i++) {
        const a = w2s(wps[i].x, wps[i].y);
        const b = w2s(wps[i + 1].x, wps[i + 1].y);
        dashedLine(this.over, a.x, a.y, b.x, b.y, dash, gap);
      }

      // The drift: what the ball does next, walked in WORLD units so the length
      // is the same wherever the board is zoomed to, and cut off at TAIL_WORLD.
      if (lastPaid >= wps.length - 1) continue;
      const tail: Pt[] = [w2s(wps[lastPaid].x, wps[lastPaid].y)];
      let left = TAIL_WORLD;
      for (let i = lastPaid; i < wps.length - 1 && left > 0; i++) {
        const a = wps[i], b = wps[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        const use = Math.min(len, left);
        left -= use;
        tail.push(w2s(a.x + ((b.x - a.x) / len) * use, a.y + ((b.y - a.y) / len) * use));
      }
      if (tail.length > 1) tails.push(tail);
    }

    const width = Math.max(1, 2 * scale);
    this.over.stroke({ width, color: PALETTE.accent, alpha: TRAJECTORY_ALPHA, cap: "round" });

    // The fade, one stroke per band. Dashes are placed along the WHOLE drift and
    // bucketed by where they fall, so the dash rhythm carries on unbroken from
    // the solid part instead of restarting inside each band.
    for (let band = 0; band < TAIL_BANDS; band++) {
      let drew = false;
      for (const tail of tails) {
        let total = 0;
        for (let i = 0; i < tail.length - 1; i++) {
          total += Math.hypot(tail[i + 1].x - tail[i].x, tail[i + 1].y - tail[i].y);
        }
        if (total < 0.001) continue;
        let walked = 0;
        for (let i = 0; i < tail.length - 1; i++) {
          const a = tail[i], b = tail[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.001) continue;
          const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
          // Dashes continue across a chord boundary rather than restarting, or
          // a curving drift would stutter at every joint.
          for (let d = -(walked % (dash + gap)); d < len; d += dash + gap) {
            const s0 = Math.max(0, d), e0 = Math.min(d + dash, len);
            if (e0 <= s0) continue;
            // Bucket on the dash's midpoint along the WHOLE drift: a dash
            // straddling a band boundary belongs to one band, not to both at
            // two different alphas.
            const mid = (walked + (s0 + e0) / 2) / total;
            if (Math.floor(mid * TAIL_BANDS) !== band) continue;
            this.over.moveTo(a.x + ux * s0, a.y + uy * s0)
                     .lineTo(a.x + ux * e0, a.y + uy * e0);
            drew = true;
          }
          walked += len;
        }
      }
      if (!drew) continue;
      // Ease the alpha down rather than stepping it linearly: a linear ramp
      // still has a visible last dash, and the point is that the line runs out
      // of confidence rather than out of length.
      const t = (band + 0.5) / TAIL_BANDS;
      this.over.stroke({
        width, color: PALETTE.accent, cap: "round",
        alpha: TRAJECTORY_ALPHA * (1 - t) * (1 - t),
      });
    }
  }

  /**
   * Ability fired: a board-wide flash plus staggered rings.
   *
   * The flash exists because an ability can fire and change nothing the player
   * can see (one ball, already cornered), and "did that work?" is a terrible
   * thing for a spent charge to leave behind. Rings expand for most abilities
   * and CONVERGE for Magnet, matching the direction of the thing they describe.
   *
   * Pure UI, so no lighting: this is the interface confirming an input.
   */
  private drawAbilityFx(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const list = game.abilityFx;
    if (!list || list.length === 0) return;
    const { boardRect } = game;
    const maxR = 0.6 * Math.hypot(boardRect.width, boardRect.height);
    let expired = false;

    for (const fx of list) {
      const elapsed = now - fx.startTime;
      if (elapsed >= fx.durationMs) { expired = true; continue; }
      const t = elapsed / fx.durationMs;
      const color = parseColor(fx.color, PALETTE.accent);

      this.over
        .rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
        .fill({ color, alpha: 0.2 * (1 - t) });

      const c = w2s(fx.center.x, fx.center.y);
      for (let k = 0; k < 3; k++) {
        const ph = t - k * 0.15;
        if (ph <= 0) continue;
        const r = (fx.expand ? ph : 1 - ph) * maxR;
        if (r <= 0) continue;
        this.over
          .circle(c.x, c.y, r)
          .stroke({ width: Math.max(2, 3 * scale), color, alpha: 0.85 * (1 - t) });
      }
    }
    if (expired) game.abilityFx = list.filter(fx => now - fx.startTime < fx.durationMs);
  }

  /** Magnet: a fading ring at the point the player pulled toward. */
  private drawMagnetMarker(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const m = game.magnetMarker;
    if (!m) return;
    const t = (now - m.startTime) / MAGNET_MARKER_MS;
    if (t < 0 || t >= 1) return;
    const p = w2s(m.x, m.y);
    const r = (13 + t * 4) * scale;
    this.over.circle(p.x, p.y, r).stroke({ width: Math.max(1.5, 2 * scale), color: PALETTE.mover, alpha: 1 - t });
    this.over.circle(p.x, p.y, r * 0.35).fill({ color: PALETTE.mover, alpha: (1 - t) * 0.8 });
  }

  /**
   * Pickup claimed or wasted.
   *
   * Claimed gets an expanding ring in the token's own colour; wasted gets a grey
   * ring collapsing to nothing with a strike through it. The two read as
   * opposites at a glance, which matters because the player usually finds out a
   * token was wasted from this marker alone.
   *
   * The rising "+Nh" label the 2D path draws is omitted: the top bar already
   * reports the value, and floating text is the one thing that would fight the
   * board's typography.
   */
  /**
   * A mover grinding through a fence.
   *
   * Drawn straight from this frame's contacts rather than from a particle list
   * with lifetimes: the contact IS the frame, so a mover that has cleared the
   * fence stops sparking immediately instead of trailing a puff behind it.
   *
   * The look is a scuff, not an explosion. A bright short arc across the fence
   * line plus a few sparks thrown off it: enough to say "this is costing the
   * hazard something", quiet enough that a map with four patrols crossing eight
   * fences does not become a light show.
   */
  private drawMoverFriction(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const contacts = game.moverFriction ?? [];
    if (contacts.length === 0) return;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const c = w2s(contact.x, contact.y);
      const heat = Math.max(0.15, Math.min(1, contact.intensity));

      // Hot core, sized by how hard it is being worked.
      this.over
        .circle(c.x, c.y, Math.max(1, (2 + 2.5 * heat) * scale))
        .fill({ color: 0xffd9a0, alpha: 0.5 + 0.35 * heat });
      this.over
        .circle(c.x, c.y, Math.max(1.5, (5 + 5 * heat) * scale))
        .fill({ color: PALETTE.mover, alpha: 0.18 * heat });

      // Sparks. Seeded off the contact's own position and the clock so they
      // shimmer without a random() call that would also make them untestable.
      const sparks = 2 + Math.round(3 * heat);
      for (let k = 0; k < sparks; k++) {
        const seed = Math.sin((contact.x + contact.y) * 0.37 + k * 2.399 + now * 0.02);
        const ang = seed * Math.PI;
        const len = (3 + 7 * heat * Math.abs(seed)) * scale;
        this.over
          .moveTo(c.x, c.y)
          .lineTo(c.x + Math.cos(ang) * len, c.y + Math.sin(ang) * len)
          .stroke({
            width: Math.max(1, 1.2 * scale),
            color: 0xffd9a0,
            alpha: (0.35 + 0.45 * heat) * (0.5 + 0.5 * Math.abs(seed)),
            cap: "round",
          });
      }
    }
  }

  private drawPickupFeedback(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const list = game.pickupFeedback;
    if (!list || list.length === 0) return;

    for (const fb of list) {
      const elapsed = now - fb.startTime;
      if (elapsed < 0 || elapsed >= PICKUP_FEEDBACK_MS) continue;
      const t = elapsed / PICKUP_FEEDBACK_MS;
      const p = w2s(fb.position.x, fb.position.y);

      if (fb.kind === "claimed") {
        const ringT = Math.min(1, elapsed / 450);
        if (ringT >= 1) continue;
        const color = PICKUP_FX_COLORS[fb.effect] ?? PALETTE.accent;
        this.over
          .circle(p.x, p.y, (PICKUP_DRAW_RADIUS + 30 * ringT) * scale)
          .stroke({ width: Math.max(1.5, 2 * scale), color, alpha: (1 - ringT) * 0.8 });
      } else {
        const r = PICKUP_DRAW_RADIUS * scale * (1 - t);
        if (r <= 0.5) continue;
        const alpha = 0.7 * (1 - t);
        this.over.circle(p.x, p.y, r).stroke({ width: Math.max(1.5, 2 * scale), color: 0x9aa3ad, alpha });
        this.over
          .moveTo(p.x - r, p.y - r).lineTo(p.x + r, p.y + r)
          .stroke({ width: Math.max(1.5, 2 * scale), color: 0x9aa3ad, alpha });
      }
    }
  }

  /**
   * The squash.
   *
   * It sprays ALONG THE BALL'S HEADING rather than radiating, because a splat
   * that spread evenly would read as the bug popping on its own - and the whole
   * point of the mechanic is that a ball you steered did this. The direction is
   * the one piece of the event that says who is responsible.
   *
   * A declined effect (Branch at the ball cap, Auto Merge with no room for a ring)
   * gets a grey splat and a struck-through ring instead of the bug's colour.
   * "Nothing happened" and "nothing works" look the same from the outside, and
   * this board has form for shipping a mechanic nobody could tell was firing.
   *
   * ── And it says the name ────────────────────────────────────────────────
   *
   * Nine bugs told apart by colour alone is nine things a player cannot name,
   * and a power-up you cannot name is one you cannot plan around. Arkanoid has
   * the same problem and prints a letter on the capsule; a letter does not
   * survive on a body nine world units across, and the compass ring's comment
   * has the long version of why (a digit on a ball is eight screen pixels on a
   * phone).
   *
   * So the SPLAT carries the name instead of the bug. It is the one moment the
   * player is already looking at that exact spot, nothing is moving through it,
   * and there is room for a word - and it teaches in the order that sticks:
   * you did the thing, then you find out what it was called. The press-and-hold
   * explainer (boardEntityInfo.ts) is the other half, for deciding BEFORE.
   */
  private drawBugSplats(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const list = game.bugSplats;
    if (!list || list.length === 0) return;

    for (const splat of list) {
      const elapsed = now - splat.startTime;
      if (elapsed < 0 || elapsed >= BUG_SPLAT_MS) continue;
      const t = elapsed / BUG_SPLAT_MS;
      const p = w2s(splat.position.x, splat.position.y);
      const def = getBug(splat.effect);
      // Grey ONLY for a misfire. A denied bug keeps its own colour, because the
      // player refused it on purpose and greying it out would read as the tap
      // having failed.
      const color = splat.outcome !== "declined" && def
        ? Number.parseInt(def.color.replace("#", ""), 16)
        : 0x9aa3ad;
      const r = BUG_RADIUS * scale;
      // Fast out, slow fade: the burst is over in a third of the splat's life
      // and the stain lingers, which is how a squash actually looks.
      const burst = Math.min(1, elapsed / 220);
      const alpha = (1 - t) * (1 - t);

      // The stain, thrown forward along the heading.
      const dx = splat.direction.x;
      const dy = splat.direction.y;
      // Thrown forward along the heading and stretched along it. A tapped bug
      // has no heading, so the same expression leaves it centred and round.
      this.over
        .ellipse(
          p.x + dx * r * burst * 1.2,
          p.y + dy * r * burst * 1.2,
          r * (1 + burst * 0.9),
          r * (1 + burst * (dx === 0 && dy === 0 ? 0.9 : 0.45)),
        )
        .fill({ color, alpha: alpha * 0.55 });

      // Specks. Fanned into the half-plane the ball was heading into, or thrown
      // all the way round when nothing hit it - which is the tapped case, and
      // is how "a ball did this" and "I did this" tell themselves apart before
      // the name has even been read.
      if (burst < 1) {
        const tapped = dx === 0 && dy === 0;
        const count = tapped ? 8 : 5;
        const spread = tapped ? Math.PI * 2 : Math.PI * 0.55;
        const heading = tapped ? 0 : Math.atan2(dy, dx);
        for (let i = 0; i < count; i++) {
          const a = tapped
            ? (i / count) * spread
            : heading + (i / (count - 1) - 0.5) * spread;
          const d = r * (1.4 + burst * 3.4) * (0.7 + (i % 2) * 0.4);
          this.over
            .circle(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, Math.max(0.6, r * 0.22 * (1 - burst)))
            .fill({ color, alpha: alpha * 0.8 });
        }
      }

      if (splat.outcome === "declined") {
        // Struck through: the bug was squashed and gave nothing.
        const rr = r * 1.8;
        this.over
          .moveTo(p.x - rr, p.y - rr).lineTo(p.x + rr, p.y + rr)
          .stroke({ width: Math.max(1, 1.5 * scale), color, alpha: alpha * 0.9 });
      }

      if (def) {
        this.drawSplatName(def.name, p.x, p.y - r * 2.6, color, alpha, scale, burst);
      }
    }
  }

  /**
   * One splat's name, from the pool.
   *
   * Rises a little as it fades, which is what separates it from the board's
   * static labels: this is an event that happened, not a sign that is there.
   */
  private drawSplatName(
    name: string, x: number, y: number, color: number, alpha: number, scale: number, burst: number,
  ): void {
    const slot = this.labelPool.find(l => !l.text.visible) ?? this.makeLabelSlot();
    const size = Math.max(10, 13 * scale);
    if (slot.current !== name) {
      slot.text.text = name;
      slot.current = name;
    }
    slot.text.style.fontSize = size;
    slot.text.style.fill = color;
    slot.text.visible = true;
    slot.text.alpha = alpha;
    // Lifts by about a line over the splat's life, easing out with the burst.
    slot.text.position.set(Math.round(x), Math.round(y - size * burst * 0.8));
  }

  /** A new pooled label. Only ever grows to the most splats seen at once. */
  private makeLabelSlot(): { text: Text; current: string } {
    const text = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontWeight: "bold",
        fontSize: 13,
        fill: 0xffffff,
        // A thin dark halo, because a splat can land anywhere: over captured
        // ground, over a lit pocket, over a brick. Nothing on this board is a
        // reliable background for text.
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    text.anchor.set(0.5, 1);
    text.visible = false;
    this.labels.addChild(text);
    const slot = { text, current: "" };
    this.labelPool.push(slot);
    return slot;
  }

  /**
   * The cut preview: where the fence WILL land, shown while the player drags.
   *
   * This is the single most important affordance on the board - every cut is
   * aimed with it - so it is drawn as pure UI and deliberately breaks the light
   * model: no shadow, no ambient dimming, no rim. It is a projection of intent,
   * not an object sitting on the surface, and lighting it would both bury it
   * against the board and imply it is already real.
   *
   * The ray is cast through the same castRayWithReflections the physics uses,
   * so what the player sees is exactly what they will get, bounces included. A
   * cut that would anchor on a breakable turns red: it will "dud", and the
   * player deserves to know before they commit rather than after.
   */
  private drawCutPreview(game: CanvasGameState, w2s: W2S, scale: number): void {
    const { swipeStart, currentSwipePos, swipeRegionId } = game;
    if (!swipeStart || !currentSwipePos || !swipeRegionId) return;

    const delta = vec2Sub(currentSwipePos, swipeStart);
    // Below this the direction is noise, and a preview that flails around while
    // the finger settles is worse than none.
    if (vec2Length(delta) < 5) return;

    // Bent fences (#66): the preview is cast off the SAME path the cut will
    // follow, through the same function the input handler calls, because a
    // preview that draws a straight line for a fence that lands bent is worse
    // than no preview.
    const bent = bentDrawnPath(game);
    const dir = bent ? outgoingDirection(bent) : vec2Normalize(delta);
    const backDir = bent ? incomingDirection(bent) : { x: -dir.x, y: -dir.y };
    const fwd = castRayWithReflections(bent ? bent[bent.length - 1] : swipeStart, dir, game.walls);
    const bwd = castRayWithReflections(bent ? bent[0] : swipeStart, backDir, game.walls);
    if (!fwd || !bwd) return;

    const forwardPath = bent ? joinProjection(bent, fwd.waypoints) : fwd.waypoints;
    const fEnd = forwardPath[forwardPath.length - 1];
    const bEnd = bwd.waypoints[bwd.waypoints.length - 1];
    const isDud = cutAnchorsBreakable(game, fEnd, bEnd, WALL_THICKNESS + 6);

    const outer = isDud ? 0xff8080 : 0xffffff;
    const inner = isDud ? PALETTE.danger : PALETTE.accent;
    const dot = isDud ? 0xff5b5b : PALETTE.mirror;
    const alpha = isDud ? 0.3 : 0.15;

    const paths = [forwardPath, bwd.waypoints];
    const stroke = (width: number, color: number) => {
      for (const wps of paths) {
        for (let i = 0; i < wps.length - 1; i++) {
          const s = w2s(wps[i].x, wps[i].y);
          const e = w2s(wps[i + 1].x, wps[i + 1].y);
          this.over.moveTo(s.x, s.y).lineTo(e.x, e.y);
        }
      }
      this.over.stroke({ width, color, alpha, cap: "butt" });
    };
    stroke((WALL_THICKNESS + 8) * scale, outer);
    stroke((WALL_THICKNESS + 4) * scale, inner);

    // Bounce points: the interior waypoints are where the cut turns, and seeing
    // them is what makes a mirror bank readable before committing.
    for (const wps of paths) {
      for (let i = 1; i < wps.length - 1; i++) {
        const p = w2s(wps[i].x, wps[i].y);
        this.over.circle(p.x, p.y, 4 * scale).fill({ color: dot, alpha: 0.4 });
      }
    }
  }

  /**
   * The lock flash. Fills the pocket's traced contours (even-odd, so an obstacle
   * enclosed by the pocket stays a hole) and throws a dust burst from the catch
   * point. A SUPERIOR lock gets gold and expanding rings instead of a label -
   * the celebration should be felt, not read.
   *
   * The contours are pre-smoothed by checkBallWonState and must NOT be snapped,
   * for the same reason the region boundary must not be: snapping re-quantises
   * the smoothing into a staircase.
   */
  /**
   * The ground a cut just took, flashed once.
   *
   * Capturing space is the game's main verb and had no reaction: the fill
   * changed colour on the next redraw and that was all. This is punctuation
   * rather than an event, so it is brief and it fades rather than pulsing:
   * every completed fence fires one, and anything longer would have several
   * overlapping at once on a busy map.
   *
   * Drawn UNDER the lock flash on purpose. A cut that also locks a ball fires
   * both, and the lock is the bigger moment of the two.
   */
  private drawClaimFlashes(game: CanvasGameState, w2s: W2S, now: number): void {
    const list = game.claimFlashes;
    if (!list || list.length === 0) return;

    for (const flash of list) {
      const age = (now - flash.startTime) / CLAIM_FLASH_MS;
      if (age < 0 || age >= 1) continue;
      // Slam on, ease off: the claim is instantaneous, the acknowledgement is not.
      const alpha = Math.pow(1 - age, 1.8) * 0.3;
      for (const loop of flash.contours) {
        if (loop.length < 3) continue;
        this.under.poly(loop.map(p => w2s(p.x, p.y)));
      }
      this.under.fill({ color: PALETTE.accent, alpha });
    }

    // Cull here rather than in the game loop: the renderer is the only thing
    // that cares when one has finished playing.
    game.claimFlashes = list.filter(f => now - f.startTime < CLAIM_FLASH_MS);
  }

  private drawLockFlashes(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const a of game.assimilations.values()) {
      const dur = a.superior ? SUPERIOR_FLASH_MS : LOCK_FLASH_MS;
      const t = (now - a.startTime) / dur;
      if (t < 0 || t > 1) continue;

      // Zone first: landing a var/let/const box is the rarest and most valuable
      // outcome, so it owns the flash colour even on a superior lock (which
      // still keeps its longer duration and rings).
      const tint = a.zoneColor
        ? parseColor(a.zoneColor, PALETTE.accent)
        : a.superior ? 0xffd54a : parseColor(a.ballColor, PALETTE.accent);
      // Fast in, slow out: the pocket slams bright then drains.
      const intensity = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6);

      for (const loop of a.contours) {
        if (loop.length < 3) continue;
        this.under.poly(loop.map(p => w2s(p.x, p.y)));
      }
      this.under.fill({ color: tint, alpha: 0.42 * intensity });
      for (const loop of a.contours) {
        if (loop.length < 3) continue;
        this.under.poly(loop.map(p => w2s(p.x, p.y)));
      }
      this.under.stroke({ width: Math.max(1, 2 * scale), color: tint, alpha: 0.85 * intensity });

      // The thump. Struck at the catch point, where the player is already
      // looking, and before the dust so the particles fly out over it.
      const origin = w2s(a.ballPos.x, a.ballPos.y);
      const impact = lockImpact(t, scale);
      if (impact) {
        if (impact.ringAlpha > 0.01 && impact.ringRadius > 0.5) {
          this.over
            .circle(origin.x, origin.y, impact.ringRadius)
            .stroke({ width: impact.ringWidth, color: tint, alpha: impact.ringAlpha });
        }
        if (impact.coreAlpha > 0.01) {
          this.over
            .circle(origin.x, origin.y, impact.coreRadius)
            .fill({ color: tint, alpha: impact.coreAlpha });
        }
      }

      // Dust: each particle flies its own bearing from the catch point.
      const age = now - a.startTime;
      for (const p of a.particles) {
        const pt = age / p.lifetime;
        if (pt >= 1) continue;
        const dist = p.speed * (age / 1000) * scale;
        const x = origin.x + Math.cos(p.angle) * dist;
        const y = origin.y + Math.sin(p.angle) * dist;
        const tailX = x - Math.cos(p.angle) * p.lengthPx * scale * 0.5;
        const tailY = y - Math.sin(p.angle) * p.lengthPx * scale * 0.5;
        this.over
          .moveTo(tailX, tailY).lineTo(x, y)
          .stroke({ width: Math.max(1, p.size * scale), color: tint, alpha: (1 - pt) * 0.85 });
      }

      // Superior: expanding rings, the visual "that was a good one".
      if (a.superior) {
        const c = w2s(a.centroid.x, a.centroid.y);
        for (let i = 0; i < 3; i++) {
          const rt = Math.max(0, Math.min(1, t * 1.4 - i * 0.18));
          if (rt <= 0 || rt >= 1) continue;
          this.over
            .circle(c.x, c.y, rt * 130 * scale)
            .stroke({ width: Math.max(1, 2 * scale), color: 0xffd54a, alpha: (1 - rt) * 0.6 });
        }
      }
    }
  }

  /** Chains: a taut rope between two balls, lit as a thin solid object. */
  private drawChains(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    for (const chain of game.chains ?? []) {
      if (chain.nodes.length < 2) continue;
      const pts = chain.nodes.map(n => w2s(n.x, n.y));

      // One shadow for the whole rope, offset from its midpoint.
      const mid = pts[Math.floor(pts.length / 2)];
      const cast = shadowFor(light, mid.x, mid.y, 4 * scale);
      const ox = cast.dx * cast.length;
      const oy = cast.dy * cast.length;
      this.over.moveTo(pts[0].x + ox, pts[0].y + oy);
      for (let i = 1; i < pts.length; i++) this.over.lineTo(pts[i].x + ox, pts[i].y + oy);
      this.over.stroke({ width: Math.max(1, 4 * scale), color: PALETTE.shadow, alpha: cast.alpha, cap: "round", join: "round" });

      const amb = ambientAt(light, mid.x, mid.y);
      const body = chain.breaksFences ? PALETTE.danger : 0x9aa8a2;
      this.over.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) this.over.lineTo(pts[i].x, pts[i].y);
      this.over.stroke({
        width: Math.max(1, 3 * scale),
        color: mix(PALETTE.shadow, body, 0.45 + amb * 0.55),
        alpha: 1, cap: "round", join: "round",
      });
    }
  }

  /**
   * The bright smear a ball's light leaves on a mirror's face.
   *
   * The reflection itself (derivedLight.ts) is a pool standing behind the
   * mirror, which is the right picture and a slow read: it says something is
   * lit over there. This says WHICH SURFACE DID IT, on the surface, the moment
   * a ball comes near - the cue that makes a mirror legible as a mirror before
   * a ball has ever bounced off one, which was the original complaint about
   * `isMirror` and is still the thing a player needs first.
   *
   * Drawn along the face rather than as a blob on it, and brightest at the
   * point nearest the ball: a specular highlight on a flat surface is a streak
   * whose length is the surface and whose position is the light, so it slides
   * along the mirror as the ball travels. That sliding is the part the eye
   * catches.
   */
  private drawMirrorGlints(game: CanvasGameState, w2s: W2S, scale: number): void {
    const look = getLightLook();
    if (look.reflected <= 0.001) return;
    // One glint per mirror, from the ball with the strongest claim on it, so
    // two balls near one face do not stack into a white bar.
    const best = new Map<string, { t: number; wall: CanvasGameState["walls"][number]; near: { x: number; y: number }; color: number }>();
    for (const ball of game.balls) {
      if (ball.state === "won" || ball.state === "dormant") continue;
      const p = ball.splatMass ?? ball.renderPosition ?? ball.position;
      const reach = ball.radius * (ball.assimScale ?? 1) * REACH_RADII;
      for (const wall of game.walls) {
        if (!wall.isMirror || wall.portal) continue;
        const c = closestOnSegment(p.x, p.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y);
        if (c.dist >= reach) continue;
        // Squared, unlike the pool's linear falloff: a highlight is a narrow
        // thing that arrives late, where the reflected pool is a wide one that
        // has to arrive early to be a warning.
        const t = (1 - c.dist / reach) ** 2;
        const key = mirrorOwner(wall.id);
        const prev = best.get(key);
        if (!prev || t > prev.t) {
          best.set(key, { t, wall, near: c, color: parseColor(ball.color, 0xffffff) });
        }
      }
    }

    for (const { t, wall, near, color } of best.values()) {
      const a = w2s(wall.start.x, wall.start.y);
      const b = w2s(wall.end.x, wall.end.y);
      const c = w2s(near.x, near.y);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len, uy = dy / len;
      // Half-length of the streak: a close ball throws a short hot highlight,
      // a far one a long soft one, which is how a specular smear behaves and
      // also stops the glint from being a single unreadable dot.
      const half = Math.min(len / 2, (0.18 + (1 - t) * 0.5) * len);
      const x0 = Math.max(Math.min(c.x - ux * half, Math.max(a.x, b.x)), Math.min(a.x, b.x));
      const y0 = Math.max(Math.min(c.y - uy * half, Math.max(a.y, b.y)), Math.min(a.y, b.y));
      const x1 = Math.max(Math.min(c.x + ux * half, Math.max(a.x, b.x)), Math.min(a.x, b.x));
      const y1 = Math.max(Math.min(c.y + uy * half, Math.max(a.y, b.y)), Math.min(a.y, b.y));
      const glint = t * look.reflected;
      // Three strokes, widest and faintest first: a bloom around a core, which
      // is what a highlight on a polished surface looks like and what keeps it
      // from reading as a drawn line.
      this.over
        .moveTo(x0, y0).lineTo(x1, y1)
        .stroke({ width: 7 * scale, color, alpha: 0.28 * glint, cap: "round" })
        .moveTo(x0, y0).lineTo(x1, y1)
        .stroke({ width: 3.2 * scale, color, alpha: 0.5 * glint, cap: "round" })
        .moveTo(x0, y0).lineTo(x1, y1)
        .stroke({ width: 1.2 * scale, color: 0xffffff, alpha: 0.65 * glint, cap: "round" });
    }
  }

  /**
   * Pieces knocked off a breakable, lying where they stopped.
   *
   * Drawn as solid lit rock rather than as the translucent flecks the chip
   * burst uses, and that difference is the point: a chip is a picture of an
   * impact and this is a thing on the board a ball will bounce off. If it
   * looked like debris nobody would expect it to do anything, and the first
   * deflection would read as a bug.
   *
   * A shadow under each, for the same reason everything else standing on this
   * board has one - it is what puts an object ON the floor rather than painted
   * over it.
   */
  private drawRubble(
    game: CanvasGameState, light: LightScope, w2s: W2S, scale: number, now: number,
  ): void {
    for (const c of game.rubble ?? []) {
      const alpha = rubbleAlpha(c, now);
      if (alpha <= 0.01) continue;
      const s = w2s(c.x, c.y);
      const r = c.radius * scale;
      const amb = ambientAt(light, s.x, s.y);
      const body = parseColor(c.color, PALETTE.obstacle);

      // Five sides, turned by the chunk's own spin: enough to read as a broken
      // shard at this size, where a circle would read as a pebble or a ball.
      const pts: Pt[] = [];
      for (let i = 0; i < 5; i++) {
        // The radii alternate slightly so it is a chip, not a pentagon.
        const a = c.rotation + (i / 5) * Math.PI * 2;
        const rr = r * (i % 2 === 0 ? 1 : 0.72);
        pts.push({ x: s.x + Math.cos(a) * rr, y: s.y + Math.sin(a) * rr });
      }

      const cast = shadowFor(light, s.x, s.y, r * 0.5);
      this.under
        .poly(pts.map(p => ({ x: p.x + cast.dx * cast.length, y: p.y + cast.dy * cast.length })))
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * alpha });
      this.over
        .poly(pts)
        .fill({ color: mix(PALETTE.shadow, body, 0.4 + amb * 0.5), alpha })
        .poly(pts)
        .stroke({ width: Math.max(1, 1.1 * scale), color: body, alpha: 0.75 * alpha });
    }
  }

  /** Collapse debris: shards spinning out from a destroyed object. */
  private drawDebris(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const d of game.objectDebris) {
      const t = (now - d.startTime) / d.durationMs;
      if (t < 0 || t > 1) continue;
      const color = parseColor(d.color, PALETTE.obstacle);
      const secs = (now - d.startTime) / 1000;
      for (const p of d.particles) {
        const x = p.x + p.vx * secs;
        const y = p.y + p.vy * secs;
        const s = w2s(x, y);
        const size = Math.max(1, p.size * scale * (1 - t * 0.4));
        const rot = p.rotation + p.rotSpeed * secs;
        // A square shard, rotated: cheaper than a sprite and reads as rubble.
        const c = Math.cos(rot) * size, sn = Math.sin(rot) * size;
        this.over
          .poly([
            { x: s.x - c + sn, y: s.y - sn - c },
            { x: s.x + c + sn, y: s.y + sn - c },
            { x: s.x + c - sn, y: s.y + sn + c },
            { x: s.x - c - sn, y: s.y - sn + c },
          ])
          .fill({ color, alpha: (1 - t) * 0.9 });
      }
    }
  }

  /**
   * A launcher shell dematerializing: released sections fly apart as tiles.
   *
   * The same kinematics as the board's own shatter (transitions.ts): a tile
   * keeps its release velocity, falls under a constant gravity, spins, and
   * fades over its flight. Sections not yet released are not drawn here at
   * all; entityLayer draws them as the slabs they still stand in for.
   */
  private drawShellShatters(
    game: CanvasGameState, light: LightScope, w2s: W2S, scale: number, now: number,
  ): void {
    const GRAVITY = 500; // world units / s^2, the board shatter's fall at world scale
    for (const shatter of game.shellShatters ?? []) {
      for (const section of shatter.sections) {
        const released = shatter.startTime + section.delay;
        const t = (now - released) / shatter.flightMs;
        if (t < 0 || t > 1) {
          continue;
        }
        const secs = (now - released) / 1000;
        const fade = Math.max(0, 1 - t * 1.15);
        for (const tile of section.tiles) {
          const x = tile.x + tile.vx * secs;
          const y = tile.y + tile.vy * secs + GRAVITY * secs * secs;
          const s = w2s(x, y);
          const amb = ambientAt(light, s.x, s.y);
          const rot = tile.rotation + tile.rotSpeed * secs;
          const hw = (tile.w / 2) * scale;
          const hh = (tile.h / 2) * scale;
          const c = Math.cos(rot);
          const sn = Math.sin(rot);
          this.over
            .poly([
              { x: s.x - hw * c + hh * sn, y: s.y - hw * sn - hh * c },
              { x: s.x + hw * c + hh * sn, y: s.y + hw * sn - hh * c },
              { x: s.x + hw * c - hh * sn, y: s.y + hw * sn + hh * c },
              { x: s.x - hw * c - hh * sn, y: s.y - hw * sn + hh * c },
            ])
            .fill({ color: mix(PALETTE.shadow, PALETTE.obstacle, 0.45 + amb * 0.55), alpha: fade });
        }
      }
    }
  }

  /** A toppled obstacle mid-fall: the shape slides down and fades out. */
  private drawFalling(game: CanvasGameState, light: LightScope, w2s: W2S, now: number): void {
    for (const f of game.fallingObjects) {
      const t = (now - f.startTime) / f.durationMs;
      if (t < 0 || t > 1) continue;
      const drop = f.fallSpeed * ((now - f.startTime) / 1000);
      const pts = f.vertices.map(v => w2s(v.x, v.y + drop));
      if (pts.length < 3) continue;

      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;

      const amb = ambientAt(light, cx, cy);
      this.over
        .poly(pts)
        .fill({
          color: mix(PALETTE.shadow, parseColor(f.color, PALETTE.obstacle), 0.35 + amb * 0.65),
          alpha: 1 - t,
        });
    }
  }

  destroy(): void {
    // `children: true` takes the pooled labels with it, since they are children
    // of `this.labels` which is a child of the container. The pool array is
    // dropped too, so a layer rebuilt after a resize does not hand out Text
    // objects belonging to a destroyed scene graph.
    this.labelPool = [];
    this.container.destroy({ children: true });
  }
}

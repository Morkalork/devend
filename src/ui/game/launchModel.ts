/**
 * The plunger overlay's geometry and its reading of a pull, pure: LaunchOverlay
 * draws these, and the tests read them without a canvas.
 */
import {
  launchAim, muzzleVector, bandEnds, LAUNCH_MAX_POWER, LAUNCH_MIN_POWER, LAUNCH_FULL_PULL,
  type LaunchAim, type LaunchFacing,
} from "@/lib/launcher";
import type { Vector2 } from "@/types/game";
import { boardScale, worldToContainer, type BoardBox } from "./rubberBandModel";

/** The band's amber: the control, the read-out and the predicted path. */
export const LAUNCH_AMBER = 0xffb347;

/**
 * Read a drag into an aim. `start` and `now` are pointer positions in the
 * container's CSS px; the pull is measured in WORLD units so the dead zone and
 * the full-pull length mean the same thing on a phone and on a desktop. Null
 * for a pull too short (or too sideways) to register: not a weak launch, no
 * launch, because a shot cannot be taken back.
 */
export function readLaunchAim(box: BoardBox, start: Vector2 | null, now: Vector2, facing: LaunchFacing, angle?: number): LaunchAim | null {
  if (!start) return null;
  const scale = boardScale(box);
  return launchAim({ x: (now.x - start.x) / scale, y: (now.y - start.y) / scale }, facing, angle);
}

/** 0..1 of full power. */
export function launchPowerT(aim: LaunchAim | null): number {
  return aim ? (aim.power - LAUNCH_MIN_POWER) / (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER) : 0;
}

export interface LaunchGeometry {
  /** The muzzle-end ball, in container px. */
  ball: Vector2;
  /** The line the shot leaves on, from the ball. */
  lineEnd: Vector2;
  /** The band's posts, and its midpoint bowed back by the pull (the grip). */
  bandA: Vector2;
  bandB: Vector2;
  bandMid: Vector2;
}

/** Everything the plunger draws, in the container's CSS px. */
export function launchGeometry(p: BoardBox & {
  ballPosition: Vector2;
  inner: { x: number; y: number; width: number; height: number };
  angle?: number;
  facing: LaunchFacing;
  aim: LaunchAim | null;
}): LaunchGeometry {
  const box: BoardBox = p;
  const scale = boardScale(box);
  const ball = worldToContainer(box, p.ballPosition);
  const bearing = muzzleVector(p.facing, p.angle);
  const baseAngle = Math.atan2(bearing.y, bearing.x);

  // The band across the closed end: the thing that is actually pulled. Drawn
  // from the barrel's real back corners rather than from the ball, so it sits
  // on the barrel at any angle and a longer barrel gets a longer draw.
  const band = bandEnds(p.inner, p.facing, p.angle);
  const bandA = worldToContainer(box, band.a);
  const bandB = worldToContainer(box, band.b);
  // How far the band's midpoint is dragged back, in screen pixels: the pull the
  // player is making, shown on the band they are making it with.
  const draw = launchPowerT(p.aim) * LAUNCH_FULL_PULL * scale * 0.5;
  const bandMid = {
    x: (bandA.x + bandB.x) / 2 - bearing.x * draw,
    y: (bandA.y + bandB.y) / 2 - bearing.y * draw,
  };

  // The line the shot leaves on, drawn whether or not a pull has started: the
  // barrel decides the direction, so it can be shown before the player touches
  // anything rather than discovered by pulling.
  const lineLen = Math.max(60, p.canvasWidth * 0.32);
  const lineEnd = { x: ball.x + Math.cos(baseAngle) * lineLen, y: ball.y + Math.sin(baseAngle) * lineLen };

  return { ball, lineEnd, bandA, bandB, bandMid };
}

/**
 * The hand's gesture for the launcher hint (InteractiveTutorialOverlay): a
 * press on the band's grip at rest, a pull back down the barrel, away from the
 * muzzle, by what the band itself travels on a full pull, and the release at
 * the end of it. In the container's CSS px, like the geometry it is read off.
 */
export function launchHintGesture(
  box: BoardBox, geo: LaunchGeometry, facing: LaunchFacing, angle?: number,
): { fromX: number; fromY: number; toX: number; toY: number } {
  const bearing = muzzleVector(facing, angle);
  const pull = LAUNCH_FULL_PULL * boardScale(box) * 0.5;
  return {
    fromX: geo.bandMid.x, fromY: geo.bandMid.y,
    toX: geo.bandMid.x - bearing.x * pull, toY: geo.bandMid.y - bearing.y * pull,
  };
}

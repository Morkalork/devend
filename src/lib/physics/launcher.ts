/**
 * Launcher runtime: the cup on the board and the shot that empties it.
 *
 * The pure geometry and the deal live in src/lib/launcher.ts. This is the part
 * that touches the live game: waking the loaded ball, recording the power the
 * map was bought at, and answering "is anything still waiting to be fired".
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/types/game";
import type { LaunchFacing, LaunchAim } from "@/lib/launcher";
import { launchVelocity, clampLaunchPower, LAUNCH_SPREAD } from "@/lib/launcher";
import { findRegionContainingPoint } from "@/lib/gameUtils";

export interface LauncherState {
  id: string;
  /** Interior of the barrel, in world units. The balls are stacked down it. */
  inner: { x: number; y: number; width: number; height: number };
  facing: LaunchFacing;
  /** The barrel's own turn, in degrees clockwise. The muzzle is facing + this. */
  angle?: number;
  /**
   * Every sleeping ball this barrel holds, muzzle-end first.
   *
   * All of them, not one: a launcher map loads the WHOLE roster and the shot
   * empties the barrel. One ball in the cup and the rest already loose on the
   * board made the launch a curiosity happening in a corner of a map that was
   * otherwise ordinary; with the roster inside, the pull is the map.
   */
  ballIds: string[];
  fired: boolean;
}

/** True while any cup on the map still holds its ball. */
export function launchPending(game: Pick<CanvasGameState, "launchers">): boolean {
  return (game.launchers ?? []).some(l => !l.fired);
}

/** The cup waiting to be fired, if there is one. */
export function pendingLauncher(
  game: Pick<CanvasGameState, "launchers">,
): LauncherState | null {
  return (game.launchers ?? []).find(l => !l.fired) ?? null;
}

/**
 * Spread the barrel's shots so a stack does not leave as one ball.
 *
 * Every ball fired on exactly the aim would travel the same line at the same
 * speed forever - the engine damps nothing - so the roster would arrive as a
 * single moving column and never separate. Fanning them across the cone is what
 * turns one pull into a map full of balls, and it uses the SAME cone the aim is
 * clamped to, so nothing leaves anywhere the player could not have aimed.
 *
 * A single ball fires dead on the aim; the fan only appears when there is
 * something to fan.
 */
export function fanDirections(aim: LaunchAim, count: number): Vector2[] {
  if (count <= 1) return [aim.direction];
  const base = Math.atan2(aim.direction.y, aim.direction.x);
  // Half the cone, so even the outermost shot stays well inside it.
  const spread = LAUNCH_SPREAD * 0.5;
  const out: Vector2[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1..1
    const a = base + t * spread;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return out;
}

/**
 * Fire a barrel: every ball in it leaves at once.
 *
 * Deliberately the same shape as circuit.ts's wakeBall, and for the same
 * reason: a dormant ball holds its region uncapturable, so bringing it to life
 * has to set state, velocity and a fresh regionId together or the ball wakes
 * up owning a region it is no longer standing in.
 *
 * Where wakeBall picks a random heading at base speed, this takes the player's.
 * That is the whole feature, and it also means a launcher map is reproducible
 * in a way a circuit map is not - wakeBall calls Math.random() rather than the
 * run's seeded stream.
 *
 * Returns the power actually used, or null when there was nothing to fire.
 */
export function fireLauncher(
  game: CanvasGameState, launcher: LauncherState, aim: LaunchAim,
): number | null {
  if (launcher.fired) return null;
  const loaded = launcher.ballIds
    .map(id => game.balls.find(b => b.id === id))
    .filter((b): b is NonNullable<typeof b> => !!b && b.state === "dormant");
  if (loaded.length === 0) return null;

  const power = clampLaunchPower(aim.power);
  const headings = fanDirections(aim, loaded.length);
  loaded.forEach((ball, i) => {
    ball.state = "active";
    ball.velocity = launchVelocity({ ...aim, power, direction: headings[i] }, ball.baseSpeed || 250);
    ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    ball.spawnTime = performance.now();
    const region = findRegionContainingPoint(game.regions, ball.position.x, ball.position.y);
    if (region) ball.regionId = region.id;
  });

  launcher.fired = true;
  // The map is bought at the power of the hardest shot on it. A map with two
  // cups is two wagers, and taking the safe one second should not refund the
  // first: `max` is what makes each pull a commitment rather than an average.
  game.launchPower = Math.max(game.launchPower ?? 1, power);
  return power;
}

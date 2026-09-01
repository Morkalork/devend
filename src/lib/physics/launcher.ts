/**
 * Launcher runtime: the cup on the board and the shot that empties it.
 *
 * The pure geometry and the deal live in src/lib/launcher.ts. This is the part
 * that touches the live game: waking the loaded ball, recording the power the
 * map was bought at, and answering "is anything still waiting to be fired".
 */
import type { CanvasGameState } from "@/types/gameState";
import type { LaunchFacing, LaunchAim } from "@/lib/launcher";
import { launchVelocity, clampLaunchPower } from "@/lib/launcher";
import { findRegionContainingPoint } from "@/lib/gameUtils";

export interface LauncherState {
  id: string;
  /** Interior of the cup, in world units. The ball starts at its centre. */
  inner: { x: number; y: number; width: number; height: number };
  facing: LaunchFacing;
  /** The sleeping ball this cup holds, until it is fired. */
  ballId: string;
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
 * Fire a cup's ball.
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
  const ball = game.balls.find(b => b.id === launcher.ballId);
  if (!ball || ball.state !== "dormant") return null;

  const power = clampLaunchPower(aim.power);
  ball.state = "active";
  ball.velocity = launchVelocity({ ...aim, power }, ball.baseSpeed || 250);
  ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  ball.spawnTime = performance.now();
  const region = findRegionContainingPoint(game.regions, ball.position.x, ball.position.y);
  if (region) ball.regionId = region.id;

  launcher.fired = true;
  // The map is bought at the power of the hardest shot on it. A map with two
  // cups is two wagers, and taking the safe one second should not refund the
  // first: `max` is what makes each pull a commitment rather than an average.
  game.launchPower = Math.max(game.launchPower ?? 1, power);
  return power;
}

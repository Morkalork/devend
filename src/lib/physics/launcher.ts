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
  /**
   * ARMED, and latching: true from the first frame after firing when the barrel
   * interior is empty, and true forever after.
   *
   * The barrel interior is forbidden ground until this flips. You cannot fence
   * while it is false (a fence there would trap balls the shot is still
   * emptying), and a ball sealed inside while it is false fails the map. Once
   * armed, the interior is an ordinary - if tricky - pocket: a ball that finds
   * its way back in can be locked there like anywhere else.
   *
   * Latching is the point. A returning ball puts a ball back inside an ARMED
   * barrel, and that must stay lockable rather than dropping the barrel back
   * into its forbidden state and failing the map for the very play the rule
   * exists to allow.
   */
  armed?: boolean;
}

/**
 * Is a world point inside a barrel's interior?
 *
 * The interior rect is stored axis-aligned in the barrel's OWN frame (see
 * initGame), so a turned barrel needs the point brought back into that frame
 * first - rotated about the interior's centre by minus the barrel's angle -
 * before an ordinary rect test means anything. Testing the world point against
 * the un-turned rect would check a box the barrel no longer occupies, which is
 * the same authored-vs-real mistake entityOutline exists to stop.
 */
export function pointInLauncherInterior(p: Vector2, launcher: LauncherState): boolean {
  const { inner, angle } = launcher;
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  let lx = p.x, ly = p.y;
  if (angle) {
    const rad = (-angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = p.x - cx, dy = p.y - cy;
    lx = cx + dx * cos - dy * sin;
    ly = cy + dx * sin + dy * cos;
  }
  return lx >= inner.x && lx <= inner.x + inner.width
      && ly >= inner.y && ly <= inner.y + inner.height;
}

/** True while any ball (awake or asleep) still sits inside this barrel. */
export function launcherHoldsBall(
  game: Pick<CanvasGameState, "balls">, launcher: LauncherState,
): boolean {
  return game.balls.some(b =>
    b.state !== "won" && pointInLauncherInterior(b.position, launcher));
}

/**
 * Latch every fired barrel that has finished emptying.
 *
 * Called once per active frame. Only ever sets armed true, never false: see the
 * note on `armed` for why a returning ball must not un-arm the barrel.
 */
export function updateLauncherArming(game: Pick<CanvasGameState, "balls" | "launchers">): void {
  for (const l of game.launchers ?? []) {
    if (l.armed || !l.fired) continue;
    if (!launcherHoldsBall(game, l)) l.armed = true;
  }
}

/**
 * May the player start a fence right now?
 *
 * No, while any barrel is not yet armed - unfired (still holding the whole
 * roster) or fired but still draining. A fence during the drain would seal
 * balls the shot is mid-way through ejecting, which is the exact thing the
 * lock-inside rule fails the map for; blocking the fence is the humane half of
 * that rule, refusing the mistake rather than punishing it.
 */
export function fencesBlockedByLauncher(
  game: Pick<CanvasGameState, "launchers">,
): boolean {
  return (game.launchers ?? []).some(l => !l.armed);
}

/**
 * A barrel that just had a ball sealed inside it before it was armed, or null.
 *
 * The failure state of the lock-inside rule. Reads the balls that locked THIS
 * pass rather than every won ball, so a lock landing in an already-armed barrel
 * (the intended play, a returning ball) is untouched.
 */
export function lockedInsideUnarmedLauncher(
  game: Pick<CanvasGameState, "balls" | "launchers">,
  wonThisPass: ReadonlyArray<{ position: Vector2 }>,
): LauncherState | null {
  for (const l of game.launchers ?? []) {
    if (l.armed) continue;
    for (const b of wonThisPass) {
      if (pointInLauncherInterior(b.position, l)) return l;
    }
  }
  return null;
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

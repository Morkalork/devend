/**
 * commands — every player action, as a value that can be applied twice.
 *
 * Before this existed, a pointer handler WAS the action: handlePointerUp cast
 * its rays and pushed onto game.activeWalls on the spot, a freeze tap stamped
 * frozenUntil where the finger landed, a mover grab wrote game.moverDrag. That
 * works exactly once, on the device the finger is on, which is why none of it
 * could be replayed anywhere else (TWO_PLAYER_PLAN.md step 3).
 *
 * The split this file draws:
 *
 *   - The pointer layer still owns REFUSAL. Whether there is a wall in the way,
 *     whether the start cell is captured, whether the player is at their fence
 *     limit: all of that is answered where the finger is, with the message the
 *     player already sees, because a refusal is feedback and not an event.
 *   - What survives refusal becomes a COMMAND: a small plain object naming a
 *     player and what they did. Commands go on game.pending, and the loop
 *     drains them at the top of the frame, before any physics runs.
 *   - applyCommand is then the ONLY place a player action reaches the game
 *     state, and it does not know or care whether the finger was on this
 *     device. That is the whole point: the same function runs for a local
 *     command and a remote one, so both boards take the same step.
 *
 * What is deliberately NOT a command: the swipe in progress. The line under a
 * moving finger is local preview state (game.swipeStart and friends); nothing
 * in the physics tick reads it, and a half-drawn fence is not yet an event.
 * Only lifting the finger is.
 *
 * The payoff outside two-player is a replay: a seed plus an ordered command log
 * reproduces a map exactly, which turns a bug report into a file.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, GrowingWall, Vector2 } from "@/types/game";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { GameMessageId } from "@/lib/gameMessages";
import { vec2Length, vec2Normalize, vec2Sub } from "@/lib/polygon";
import { WALL_THICKNESS, castRayWithReflections } from "@/lib/wallGeometry";
import { STANDARD_FENCE_ID, getFenceType } from "@/lib/fences";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";
import { slingShape, fireSlingFence } from "@/lib/physics/slingFence";
import { railParam, railReading, releaseMover } from "@/lib/physics/moverControl";
import { isTappableBall } from "@/lib/ballTypes";
import { FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";
import { simNow } from "@/lib/simClock";

/** Player 0 is whoever started the run; player 1 is the partner. Solo play is
 *  all player 0, which is why nothing below special-cases it. */
export type PlayerId = 0 | 1;

/**
 * Which player this DEVICE is.
 *
 * Solo play is always player 0, which is why nothing in the pointer layer
 * special-cases it. In a pair the guest's phone is player 1, and every command
 * its fingers produce has to say so, or the two devices apply each other's
 * actions under the wrong name and the fence colours (and the mover grabs)
 * swap over. One device, one answer, so this is a module value rather than
 * something threaded through every handler.
 */
let localPlayer: PlayerId = 0;

export function setLocalPlayer(p: PlayerId): void { localPlayer = p; }
export function getLocalPlayer(): PlayerId { return localPlayer; }

/**
 * Where a command goes when the pointer layer produces one.
 *
 * Solo, straight onto the game's own queue, drained by the loop at the top of
 * the frame. In a pair the lockstep takes it instead: it books the command for
 * a tick a few ahead, sends it to the other phone, and hands it back to the
 * queue when that tick comes round on BOTH devices. The pointer layer does not
 * know which of those is happening, which is the point.
 */
let sink: ((cmd: GameCommand) => void) | null = null;

export function setCommandSink(fn: ((cmd: GameCommand) => void) | null): void {
  sink = fn;
}

export type GameCommand =
  /** A finished cut. Carries the drag, not the fence: both devices cast the
   *  rays themselves, off walls they already agree about. */
  | {
      kind: "cut";
      player: PlayerId;
      start: Vector2;
      end: Vector2;
      /** The simplified bent path, when the drag had corners in it (#66). */
      path: Vector2[] | null;
      regionId: string;
      fenceTypeId: string;
    }
  /** A tap that freezes the ball under it, and its nearest neighbours. */
  | { kind: "freezeTap"; player: PlayerId; at: Vector2; regionId: string; useCharge: boolean }
  /** A tap that pops a white ball (#57). */
  | { kind: "tapRemove"; player: PlayerId; ballId: string }
  /** Letting go of a pulled-back Redeploy fence. */
  | { kind: "slingRelease"; player: PlayerId; wallId: string; pull: Vector2 }
  /** Taking hold of a mover (Control Freak). */
  | {
      kind: "moverGrab";
      player: PlayerId;
      moverId: string;
      pointer: Vector2;
      driveMultiplier: number;
      canDerail: boolean;
      canBand: boolean;
    }
  /** The held mover's finger moved. */
  | { kind: "moverMove"; player: PlayerId; pointer: Vector2 }
  /**
   * The held mover was let go. `cancel` is the second-finger call-off: the
   * mover simply stops being held, where an ordinary release may fire a bumper
   * snap or spend a derail.
   */
  | { kind: "moverRelease"; player: PlayerId; cancel?: boolean }
  /** A different fence slot was chosen. */
  | { kind: "selectFence"; player: PlayerId; fenceTypeId: string };

/**
 * The few things a command needs that do not live on the game state.
 *
 * Modifiers are the run's, so both devices hold the same ones once step 6
 * syncs the run; the callbacks are how an applied command reaches React (a cut
 * count, a message, a pop) without the command layer importing a component.
 */
export interface CommandDeps {
  modifiers: GameModifiers;
  setCutCount?: (n: number) => void;
  setFreezeUsesRemaining?: (n: number) => void;
  onMessage?: (id: GameMessageId) => void;
  onTapRemove?: (info: { x: number; y: number; color: string }) => void;
  /** Haptics. Only ever fired for the local player's own commands: a phone
   *  buzzing for a fence the other player drew would read as a fault. */
  vibrate?: (pattern: number | number[]) => void;
}

/** Put a command where it should go: the local queue, or the pair's lockstep. */
export function enqueueCommand(game: CanvasGameState, cmd: GameCommand): void {
  if (sink) { sink(cmd); return; }
  queueLocally(game, cmd);
}

/**
 * Put a command straight on the game's own queue, sink or no sink.
 *
 * This is how the lockstep hands a released tick's commands over: they have
 * already been through the sink once, on the device whose finger made them,
 * and sending them round again would be a loop.
 */
export function queueLocally(game: CanvasGameState, cmd: GameCommand): void {
  (game.pending ??= []).push(cmd);
}

/**
 * Drain the queue into the game state.
 *
 * Applied in the order queued, which for a pair is the order the lockstep
 * released them: by tick, then by player, so both devices walk the same list.
 * Called at the top of a frame, before any physics step, which is where the
 * pointer handlers' mutations used to land anyway.
 */
export function drainCommands(game: CanvasGameState, deps: CommandDeps): void {
  const queue = game.pending;
  if (!queue || queue.length === 0) return;
  // Take the whole queue first: applying a command can enqueue another (a
  // mover release that derails, say), and those belong to the NEXT drain, not
  // this one, or a command could put the loop in a queue it never leaves.
  game.pending = [];
  for (const cmd of queue) applyCommand(game, cmd, deps);
}

/** Apply one command. The only door between a player and the game state. */
export function applyCommand(game: CanvasGameState, cmd: GameCommand, deps: CommandDeps): void {
  switch (cmd.kind) {
    case "cut":          applyCut(game, cmd, deps); break;
    case "freezeTap":    applyFreezeTap(game, cmd, deps); break;
    case "tapRemove":    applyTapRemove(game, cmd, deps); break;
    case "slingRelease": applySlingRelease(game, cmd, deps); break;
    case "moverGrab":    applyMoverGrab(game, cmd, deps); break;
    case "moverMove":    applyMoverMove(game, cmd); break;
    case "moverRelease": applyMoverRelease(game, cmd, deps); break;
    case "selectFence":  game.selectedFenceTypeId = cmd.fenceTypeId; break;
  }
}

// ── cut ─────────────────────────────────────────────────────────────────────

function applyCut(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "cut" }>,
  deps: CommandDeps,
): void {
  const bent = cmd.path && cmd.path.length > 1 ? cmd.path : null;
  const origin    = bent ? { ...bent[0] } : { ...cmd.start };
  const direction = bent ? outgoingDirection(bent) : vec2Normalize(vec2Sub(cmd.end, cmd.start));
  const backDir   = bent ? incomingDirection(bent) : { x: -direction.x, y: -direction.y };

  const forwardResult  = castRayWithReflections(bent ? bent[bent.length - 1] : origin, direction, game.walls);
  const backwardResult = castRayWithReflections(origin, backDir, game.walls);
  if (!forwardResult || !backwardResult) return;

  const endWaypoints   = bent ? joinProjection(bent, forwardResult.waypoints) : forwardResult.waypoints;
  const startWaypoints = backwardResult.waypoints;
  const targetEnd      = endWaypoints[endWaypoints.length - 1];
  const targetStart    = startWaypoints[startWaypoints.length - 1];

  // Anchoring on a breakable is refused HERE rather than in the pointer layer,
  // because it depends on where the rays landed, which is state both devices
  // share. The buzz and the message are the local player's alone.
  const mayAnchor = getFenceType(cmd.fenceTypeId).anchorOnBreakable;
  if (!mayAnchor && cutAnchorsBreakable(game, targetStart, targetEnd, WALL_THICKNESS + 6)) {
    game.lastDudAt = simNow();
    deps.onMessage?.("breakableAnchor");
    deps.vibrate?.([8, 30, 8]);
    return;
  }

  game.wallCount += 1;
  deps.setCutCount?.(game.wallCount);

  const isInstant = game.wallCount <= deps.modifiers.instantFencesPerMap;

  game.activeWalls.push({
    origin,
    direction,
    startWaypoints,
    endWaypoints,
    startSegmentIndex:  isInstant ? startWaypoints.length - 2 : 0,
    endSegmentIndex:    isInstant ? endWaypoints.length - 2 : 0,
    startPoint:         isInstant ? { ...targetStart } : { ...origin },
    endPoint:           isInstant ? { ...targetEnd   } : { ...origin },
    targetStart,
    targetEnd,
    thickness:          WALL_THICKNESS,
    isComplete:         isInstant,
    activeRegionId:     cmd.regionId,
    startTime:          isInstant ? undefined : simNow(),
    fenceTypeId:        cmd.fenceTypeId ?? STANDARD_FENCE_ID,
    player:             cmd.player,
  } as GrowingWall);

  game.swipeTrail = {
    start:     { ...cmd.start },
    end:       { ...cmd.end },
    createdAt: simNow(),
  };
}

// ── taps ────────────────────────────────────────────────────────────────────

/** The ball a freeze tap lands on, or null. Shared by the pointer layer (which
 *  needs to know whether the tap is worth sending at all) and the command. */
export function freezeTargetAt(
  game: CanvasGameState, at: Vector2, regionId: string,
): Ball | null {
  const now = simNow();
  let target: Ball | null = null;
  let best = Infinity;
  for (const ball of game.balls) {
    if (ball.state !== "active") continue;
    if (ball.regionId !== regionId) continue;
    if (isTappableBall(ball.ability)) continue;                  // white balls pop, never freeze (#57)
    if (ball.frozenUntil && now < ball.frozenUntil) continue;
    if (ball.freezeReadyAt && now < ball.freezeReadyAt) continue;
    const d = vec2Length(vec2Sub(ball.position, at));
    if (d <= ball.radius + FREEZE_TAP_SLOP_WORLD && d < best) { best = d; target = ball; }
  }
  return target;
}

/** Kept in step with useGameInput's FREEZE_TAP_SLOP; re-exported so the two
 *  cannot drift apart while the same tap is judged in both places. */
import { FREEZE_TAP_SLOP } from "@/lib/gameConstants";
const FREEZE_TAP_SLOP_WORLD = FREEZE_TAP_SLOP;

function applyFreezeTap(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "freezeTap" }>,
  deps: CommandDeps,
): void {
  const target = freezeTargetAt(game, cmd.at, cmd.regionId);
  if (!target) return;

  if (cmd.useCharge) {
    if ((game.freezeCharges ?? 0) <= 0) return;
    game.freezeCharges -= 1;
  } else {
    if ((game.freezeUsesRemaining ?? 0) <= 0) return;
    game.freezeUsesRemaining -= 1;
    deps.setFreezeUsesRemaining?.(game.freezeUsesRemaining);
  }

  const now = simNow();
  const durationMs = (cmd.useCharge
    ? (game.freezeChargeSeconds || 3)
    : deps.modifiers.ballFreezeDuration) * 1000;
  const freezeCount = 1 + Math.max(0, Math.round(deps.modifiers.ballFreezeCount));

  const eligible = game.balls.filter(b =>
    b.state === "active" &&
    b.regionId === cmd.regionId &&
    !isTappableBall(b.ability) &&
    !(b.frozenUntil && now < b.frozenUntil) &&
    !(b.freezeReadyAt && now < b.freezeReadyAt)
  );
  eligible.sort((a, b) =>
    vec2Length(vec2Sub(a.position, target.position)) -
    vec2Length(vec2Sub(b.position, target.position))
  );
  for (const ball of eligible.slice(0, freezeCount)) {
    ball.frozenUntil   = now + durationMs;
    ball.freezeReadyAt = deps.modifiers.freezeNoCooldown > 0
      ? now + durationMs
      : now + durationMs * (1 + FREEZE_COOLDOWN_MULTIPLIER);
  }
  deps.vibrate?.(20);
}

function applyTapRemove(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "tapRemove" }>,
  deps: CommandDeps,
): void {
  const target = game.balls.find(b => b.id === cmd.ballId && b.state === "active");
  if (!target) return;
  const removed = { x: target.position.x, y: target.position.y, color: target.color };
  game.balls = game.balls.filter(b => b !== target);
  deps.onTapRemove?.(removed);
}

// ── the slingshot fence ─────────────────────────────────────────────────────

function applySlingRelease(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "slingRelease" }>,
  deps: CommandDeps,
): void {
  const wall = game.walls.find(w => w.id === cmd.wallId);
  if (!wall) return;
  const shape = slingShape(wall, cmd.pull);
  // A tap on the fence, or a throw that caught nothing, spends nothing: the
  // player could see the rings while they dragged, so an empty release is a
  // change of mind rather than a miss to charge them for.
  if (shape && fireSlingFence(game, wall, shape)) deps.vibrate?.(25);
}

// ── movers ──────────────────────────────────────────────────────────────────

function applyMoverGrab(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "moverGrab" }>,
  deps: CommandDeps,
): void {
  const mover = game.movers?.find(m => m.id === cmd.moverId);
  if (!mover) return;
  game.moverDrag = {
    moverId: cmd.moverId,
    // The pointer id belongs to the device the finger is on, so it is not part
    // of the command; the pointer layer keeps its own copy for the second-finger
    // cancel and this one is only ever read as "a drag is live".
    pointerId: -1,
    pointer: { ...cmd.pointer },
    // The grip stays under the finger: subtract what the rail read at the
    // moment of the grab, so the body does not snap its centre to the touch.
    ref: railReading(mover, cmd.pointer.x, cmd.pointer.y) - railParam(mover),
    driveMultiplier: cmd.driveMultiplier,
    canDerail: cmd.canDerail,
    canBand: cmd.canBand,
    stopHoldMs: 0,
    derailAt: 0,
    player: cmd.player,
  };
  deps.vibrate?.(15);
}

function applyMoverMove(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "moverMove" }>,
): void {
  if (!game.moverDrag || game.moverDrag.player !== cmd.player) return;
  game.moverDrag.pointer = { ...cmd.pointer };
}

function applyMoverRelease(
  game: CanvasGameState,
  cmd: Extract<GameCommand, { kind: "moverRelease" }>,
  deps: CommandDeps,
): void {
  if (!game.moverDrag || game.moverDrag.player !== cmd.player) return;
  const held = game.movers?.find(m => m.id === game.moverDrag.moverId);
  if (!held) { game.moverDrag = null; return; }
  if (cmd.cancel) {
    // Called off, not released: no bumper snap, no derail spent. The mover
    // stops dead where it was parked and resumes patrolling from there.
    game.moverDrag = null;
    held.driveRate = 0;
    return;
  }
  if (releaseMover(game, held)) deps.vibrate?.(25);
}

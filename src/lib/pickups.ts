/**
 * Pickup (power-up token) logic: spawning, expiry, claiming and wasting.
 *
 * The rule set (see types/pickups.ts):
 * - Tokens spawn in open playable space on a chance roll every few active-play
 *   seconds (config: game-config.yml `pickups:`; per-map overrides in map.yml).
 * - CLAIM: a token pays out when a ball LOCKS in a pocket whose cells contain
 *   it — the reward is for leading a ball to the token and sealing them in
 *   together (checkBallWonState calls claimPickupsInPocket with the pocket's
 *   flood-expanded cell set).
 * - WASTE: capturing the token's cell with no lock (an empty-space capture, a
 *   destroy-recapture, or a fence drawn straight over it) destroys the token.
 * - EXPIRY: an unclaimed token vanishes after its lifetime. All timing runs on
 *   game.activePlaySeconds, so pauses and menus never eat a token.
 *
 * Every entry point guards against games built without pickup state (the
 * physics test fixtures construct partial CanvasGameState objects).
 */
import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { PickupConfig, PickupState, PickupEffect } from "@/types/pickups";
import { Vector2, pointToSegmentDistance } from "@/lib/polygon";
import { CellState, isPositionActive, worldToGridIndex } from "@/lib/spaceGrid";
import { createBallEffectState } from "@/lib/ballEffects";
import { playPickupClaimedSound } from "@/lib/gameAudio";
import { GameCallbacks } from "@/lib/physics/gameCallbacks";

/** Token visual radius in world units (rendering + spawn clearance). */
export const PICKUP_RADIUS = 14;
/** Claim/waste feedback marker lifetime (ms, wall clock). */
export const PICKUP_FEEDBACK_MS = 1100;
/** A token starts blinking this many seconds before it expires. */
export const PICKUP_EXPIRY_WARN_SECONDS = 3;
/** Fork claimed with no free ball left to split: consolation overtime hours. */
export const FORK_CONSOLATION_OVERTIME = 3;

const MIN_WALL_CLEARANCE = PICKUP_RADIUS + 10; // world units to any wall segment
const MIN_BALL_CLEARANCE = 70;                 // don't spawn under a ball
const MIN_TOKEN_SPACING  = 100;                // between simultaneous tokens
const RANDOM_SPAWN_ATTEMPTS = 40;

let _pickupCounter = 0;
let _forkCounter = 0;

/**
 * The effective spawn chance for a map: the map's own `pickupChance` override
 * (which also bypasses the start-level gate), else the global chance once the
 * level gate is passed. The Benefits Package upgrade bonus is added only where
 * pickups are enabled at all - it raises frequency, it never turns them on.
 * Returns 0 when pickups are off for this map.
 */
export function effectivePickupChance(
  cfg: PickupConfig,
  levelNumber: number,
  levelChanceOverride: number | undefined,
  chanceBonus: number,
): number {
  const base = levelChanceOverride ?? (levelNumber >= cfg.startLevel ? cfg.spawnChance : 0);
  if (base <= 0) return 0;
  const bonus = Number.isFinite(chanceBonus) && chanceBonus > 0 ? chanceBonus : 0;
  return Math.min(1, base + bonus);
}

// ── Spawning / expiry ────────────────────────────────────────────────────────

/**
 * Per-frame tick: cull finished feedback, expire stale tokens, and (on the
 * config cadence) roll a spawn. Call only on live-play frames — all lifetime
 * math keys off game.activePlaySeconds, which only advances during play.
 */
export function updatePickups(game: CanvasGameState): void {
  if (game.pickupFeedback && game.pickupFeedback.length > 0) {
    const now = performance.now();
    game.pickupFeedback = game.pickupFeedback.filter(f => now - f.startTime < PICKUP_FEEDBACK_MS);
  }

  const cfg = game.pickupConfig;
  if (!cfg || !game.pickups) return;

  const nowS = game.activePlaySeconds;
  if (game.pickups.length > 0) {
    game.pickups = game.pickups.filter(t => nowS < t.expiresAtSeconds);
  }

  if (nowS - game.lastPickupRollAt < cfg.spawnCheckSeconds) return;
  game.lastPickupRollAt = nowS;
  if (game.pickups.length >= cfg.maxSimultaneous) return;
  if (Math.random() >= cfg.spawnChance) return;
  spawnPickup(game, cfg);
}

/** True when a token can sit at `p`: open space, clear of walls/balls/tokens. */
function isSpotFree(game: CanvasGameState, p: Vector2): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;
  // The token's own cell plus a one-cell ring must be playable, so it never
  // straddles a fence's raster band or a captured edge.
  const c = grid.cellSize;
  for (const [dx, dy] of [[0, 0], [c, 0], [-c, 0], [0, c], [0, -c]]) {
    if (!isPositionActive(grid, { x: p.x + dx, y: p.y + dy })) return false;
  }
  for (const w of game.walls) {
    if (pointToSegmentDistance(p, w.start, w.end) < MIN_WALL_CLEARANCE) return false;
  }
  for (const t of game.pickups) {
    if (Math.hypot(t.position.x - p.x, t.position.y - p.y) < MIN_TOKEN_SPACING) return false;
  }
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    if (Math.hypot(b.position.x - p.x, b.position.y - p.y) < MIN_BALL_CLEARANCE) return false;
  }
  return true;
}

function spawnPickup(game: CanvasGameState, cfg: PickupConfig): void {
  const grid = game.spaceGrid;
  if (!grid) return;

  // Weighted effect pick.
  const totalWeight = cfg.effects.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (totalWeight <= 0) return;
  let roll = Math.random() * totalWeight;
  let def = cfg.effects[cfg.effects.length - 1];
  for (const e of cfg.effects) {
    roll -= Math.max(0, e.weight);
    if (roll < 0) { def = e; break; }
  }

  // Position: prefer a curated map spot that is still free ("random, but
  // thought through"), else sample random open cells.
  let pos: Vector2 | null = null;
  const spots = game.pickupSpots ?? [];
  if (spots.length > 0) {
    const shuffled = [...spots].sort(() => Math.random() - 0.5);
    for (const s of shuffled) {
      if (isSpotFree(game, s)) { pos = { x: s.x, y: s.y }; break; }
    }
  }
  if (!pos) {
    for (let i = 0; i < RANDOM_SPAWN_ATTEMPTS; i++) {
      const col = Math.floor(Math.random() * grid.width);
      const row = Math.floor(Math.random() * grid.height);
      const p = {
        x: grid.originX + col * grid.cellSize + grid.cellSize / 2,
        y: grid.originY + row * grid.cellSize + grid.cellSize / 2,
      };
      if (isSpotFree(game, p)) { pos = p; break; }
    }
  }
  if (!pos) return; // crowded board — try again next roll

  game.pickups.push({
    id: `pickup-${++_pickupCounter}`,
    effect: def.effect,
    value: def.value,
    position: pos,
    spawnedAtSeconds: game.activePlaySeconds,
    // Cryo Protocol: frozen tokens never expire (the render layer ices them
    // over). Infinity also disables the pre-expiry blink for free.
    expiresAtSeconds: game.freezePickups ? Infinity : game.activePlaySeconds + cfg.lifetimeSeconds,
  });
}

// ── Claiming / wasting ───────────────────────────────────────────────────────

function pushFeedback(
  game: CanvasGameState,
  token: PickupState,
  kind: "claimed" | "wasted",
  effect: PickupEffect = token.effect,
  value: number = token.value,
): void {
  (game.pickupFeedback ??= []).push({
    id: `${token.id}-${kind}`,
    effect,
    value,
    position: { ...token.position },
    startTime: performance.now(),
    kind,
  });
}

/**
 * A ball just locked; `pocketCells` is its pocket's cell set (including the
 * flood-expanded band up to the bounding fences). Every token inside pays out.
 * `payoutLevel` is the Total Compensation upgrade level (0-3): it enhances
 * every effect (see applyPickupEffect / forkRandomFreeBall).
 */
export function claimPickupsInPocket(
  game: CanvasGameState,
  pocketCells: Set<number>,
  callbacks?: Pick<GameCallbacks, "onBallCountChanged">,
  payoutLevel = 0,
): void {
  const grid = game.spaceGrid;
  if (!grid || !game.pickups || game.pickups.length === 0) return;
  const level = Number.isFinite(payoutLevel) && payoutLevel > 0 ? Math.floor(payoutLevel) : 0;
  const remaining: PickupState[] = [];
  let claimedAny = false;
  for (const token of game.pickups) {
    const idx = worldToGridIndex(grid, token.position.x, token.position.y);
    if (idx >= 0 && pocketCells.has(idx)) {
      applyPickupEffect(game, token, callbacks, level);
      claimedAny = true;
    } else {
      remaining.push(token);
    }
  }
  if (claimedAny) {
    game.pickups = remaining;
    playPickupClaimedSound?.();
  }
}

/**
 * Destroy every remaining token whose cell got captured without a lock — an
 * empty-space capture, a destroy-recapture, or a fence drawn right over it.
 * Call AFTER claimPickupsInPocket, so a properly locked token never reads as
 * wasted. (The locked pocket's cells are captured right after the lock, which
 * is exactly why claiming must run first.)
 */
export function wasteCapturedPickups(game: CanvasGameState): void {
  const grid = game.spaceGrid;
  if (!grid || !game.pickups || game.pickups.length === 0) return;
  const remaining: PickupState[] = [];
  for (const token of game.pickups) {
    const idx = worldToGridIndex(grid, token.position.x, token.position.y);
    if (idx < 0 || grid.cells[idx] === CellState.REMOVED) {
      pushFeedback(game, token, "wasted");
    } else {
      remaining.push(token);
    }
  }
  if (remaining.length !== game.pickups.length) game.pickups = remaining;
}

/** Total Compensation: split balls fly this much slower per payout level. */
const FORK_SLOW_PER_LEVEL = 0.05;
/** Total Compensation level at which the Fork yields a THIRD ball. */
const FORK_TRIPLE_LEVEL = 3;

function applyPickupEffect(
  game: CanvasGameState,
  token: PickupState,
  callbacks?: Pick<GameCallbacks, "onBallCountChanged">,
  payoutLevel = 0,
): void {
  switch (token.effect) {
    case "overtime":
      // Total Compensation: +1h per level (feedback shows the real payout).
      game.pickupOvertime = (game.pickupOvertime ?? 0) + token.value + payoutLevel;
      pushFeedback(game, token, "claimed", "overtime", token.value + payoutLevel);
      break;
    case "capRaise":
      game.pickupCapBonus = (game.pickupCapBonus ?? 0) + token.value + payoutLevel;
      pushFeedback(game, token, "claimed", "capRaise", token.value + payoutLevel);
      break;
    case "freezeCharge":
      // Total Compensation: each level makes the charge hold 1s longer.
      game.freezeCharges = (game.freezeCharges ?? 0) + 1;
      game.freezeChargeSeconds = Math.max(game.freezeChargeSeconds ?? 0, token.value + payoutLevel);
      pushFeedback(game, token, "claimed");
      break;
    case "fork": {
      if (forkRandomFreeBall(game, payoutLevel)) {
        pushFeedback(game, token, "claimed");
        callbacks?.onBallCountChanged?.(game.balls.length);
      } else {
        // Claimed by the LAST lock of the map: nothing left to split, pay a
        // small overtime consolation instead (feedback shows the hours).
        const consolation = FORK_CONSOLATION_OVERTIME + payoutLevel;
        game.pickupOvertime = (game.pickupOvertime ?? 0) + consolation;
        pushFeedback(game, token, "claimed", "overtime", consolation);
      }
      break;
    }
  }
}

/**
 * Slow a split ball toward its type's speed floor. Yellow's variable-speed
 * range shrinks with it, matching how other slow effects treat it.
 */
function slowSplitBall(ball: Ball, factor: number): void {
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (speed <= 0) return;
  const target = Math.max(ball.minimumSpeed, speed * factor);
  const s = target / speed;
  ball.velocity.x *= s;
  ball.velocity.y *= s;
  ball.speed = target;
  if (ball.speedRange) {
    const lo = Math.max(ball.minimumSpeed, ball.speedRange[0] * factor);
    ball.speedRange = [lo, Math.max(lo, ball.speedRange[1] * factor)];
  }
}

/**
 * Split a random still-free ball into copies of the same type. Total
 * Compensation (payoutLevel): every resulting ball is slowed 5% per level
 * (never below its minimum speed), and at level 3 the split yields a THIRD
 * ball - three slower balls means three lock payouts.
 */
function forkRandomFreeBall(game: CanvasGameState, payoutLevel = 0): boolean {
  const free = game.balls.filter(b => b.state === "active" && b.speed > 0);
  if (free.length === 0) return false;
  const src = free[Math.floor(Math.random() * free.length)];
  const speed = Math.hypot(src.velocity.x, src.velocity.y) || src.baseSpeed;
  const cloneCount = payoutLevel >= FORK_TRIPLE_LEVEL ? 2 : 1;
  const spawned: Ball[] = [];
  for (let i = 0; i < cloneCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const clone: Ball = {
      ...src,
      id: `${src.typeId}-fork-${++_forkCounter}`,
      // A tiny offset avoids a zero-distance ball-ball collision solve; the
      // normal collision pass separates the pair on the next steps.
      position: { x: src.position.x + Math.cos(angle) * 2, y: src.position.y + Math.sin(angle) * 2 },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      rotation: Math.random() * Math.PI * 2,
      effects: createBallEffectState(),
      speedRange: src.speedRange ? [src.speedRange[0], src.speedRange[1]] : undefined,
      prevPosition: undefined,
      renderPosition: undefined,
      trailPositions: undefined,
      trailHead: undefined,
      trailCount: undefined,
      frozenUntil: undefined,
      freezeReadyAt: undefined,
    };
    game.balls.push(clone);
    spawned.push(clone);
  }
  if (payoutLevel > 0) {
    const factor = 1 - FORK_SLOW_PER_LEVEL * Math.min(payoutLevel, 3);
    slowSplitBall(src, factor);
    for (const clone of spawned) slowSplitBall(clone, factor);
  }
  return true;
}

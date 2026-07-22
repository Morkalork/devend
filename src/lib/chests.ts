/**
 * Treasure chests ("destruct-ups", issue #38) - loot-gem physics.
 *
 * A chest is a breakable obstacle that, when SMASHED, grants the player ONE
 * charge of an activatable ability. Charges bank run-wide in the ability bar
 * beneath the board. The reward roster + the seeded, level-gated roll live in
 * the catalogue (src/lib/abilities.ts, loaded from public/abilities.yml); this
 * module only owns the cosmetic loot gem a broken chest spits out (it falls
 * under gravity and bounces like a rubber ball; coloured by the ability).
 */
import { ChestLoot } from "@/types/game";

// ── Loot gem physics ─────────────────────────────────────────────────────────

/** Downward acceleration on loot gems (world units / s²). */
const LOOT_GRAVITY = 1400;
/** Bounce energy kept per floor hit — high (rubber ball), so it settles slowly. */
const LOOT_RESTITUTION = 0.75;
/** Horizontal damping per floor hit. */
const LOOT_FLOOR_FRICTION = 0.86;
/** Below this bounce speed the gem is considered at rest. */
const LOOT_REST_SPEED = 40;
/** How long a gem lives before it is culled (active-play seconds). */
export const LOOT_TTL_SECONDS = 3.0;

/**
 * Spawn a bouncing loot gem at a broken chest. `bornActiveSeconds` anchors the
 * lifetime to the active-play clock so pauses never eat it.
 */
export function makeChestLoot(
  id: string,
  reward: string,
  x: number,
  y: number,
  bornActiveSeconds: number,
): ChestLoot {
  return {
    id,
    reward,
    x,
    y,
    // A little upward pop out of the chest, then gravity takes over.
    vx: (Math.random() - 0.5) * 120,
    vy: -220 - Math.random() * 120,
    bornActiveSeconds,
    settled: false,
  };
}

/** A collision surface a loot gem can land on (a wall/obstacle edge). */
export interface LootSegment { x1: number; y1: number; x2: number; y2: number; }

/** The world a loot gem falls through: surfaces to land on + a floor fallback. */
export interface LootWorld { segments: LootSegment[]; floorY: number; }

/**
 * The FIRST surface directly beneath a point: the highest segment that spans
 * `x` horizontally and sits at/below `y`, else the board floor. Near-vertical
 * segments (obstacle sides, board walls) can't be rested on and are skipped.
 */
export function surfaceFloorUnder(
  segments: LootSegment[],
  x: number,
  y: number,
  fallbackFloor: number,
): number {
  let floor = fallbackFloor;
  const TOL = 0.5; // treat a surface within this of the point as "below" (anti-jitter)
  for (const s of segments) {
    const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
    if (x < minX || x > maxX) continue;
    const dx = s.x2 - s.x1;
    if (Math.abs(dx) < 1e-3) continue; // vertical: not a surface to rest on
    const t = (x - s.x1) / dx;
    const sy = s.y1 + (s.y2 - s.y1) * t;
    if (sy >= y - TOL && sy < floor) floor = sy;
  }
  return floor;
}

/**
 * Advance every loot gem one frame: gravity, then a rubber-ball bounce off the
 * FIRST surface beneath it — an obstacle top, a fence, or the board floor —
 * instead of falling straight through to the bottom. `dt` is seconds; `world`
 * carries the collision segments + the floor fallback. Mutates in place and
 * culls expired gems.
 */
export function updateChestLoot(
  loot: ChestLoot[],
  dt: number,
  world: LootWorld,
  nowActiveSeconds: number,
): ChestLoot[] {
  if (loot.length === 0) return loot;
  const kept: ChestLoot[] = [];
  for (const g of loot) {
    if (nowActiveSeconds - g.bornActiveSeconds >= LOOT_TTL_SECONDS) continue; // expired
    if (!g.settled) {
      // The surface it would land on, taken at its position BEFORE this step so
      // a surface it has already fallen past is never grabbed back.
      const floor = surfaceFloorUnder(world.segments, g.x, g.y, world.floorY);
      g.vy += LOOT_GRAVITY * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (g.y >= floor && g.vy > 0) {
        g.y = floor;
        // Rubber-ball rebound: keep most of the speed, so it bounces several
        // times and fades slower than a low-pressure ball would.
        g.vy = -g.vy * LOOT_RESTITUTION;
        g.vx *= LOOT_FLOOR_FRICTION;
        if (Math.abs(g.vy) < LOOT_REST_SPEED) { g.vy = 0; g.settled = true; }
      }
    }
    kept.push(g);
  }
  return kept;
}

/** 0..1 fade for a loot gem, easing out over the last third of its life. */
export function chestLootAlpha(g: ChestLoot, nowActiveSeconds: number): number {
  const age = nowActiveSeconds - g.bornActiveSeconds;
  const t = age / LOOT_TTL_SECONDS;
  if (t <= 0.66) return 1;
  return Math.max(0, 1 - (t - 0.66) / 0.34);
}

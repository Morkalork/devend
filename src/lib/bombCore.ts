/**
 * The bomb inside every destructible box.
 *
 * A slab or chest is a hull round a bomb. Each hit chips the hull, and the
 * wear opens a hole in it through which the bomb shows, a little more each
 * time. Once the bomb is fully showing, the next ball to touch the box hits
 * the bomb, and the whole box goes up.
 *
 * Exposure lands at "all but the last hit" of the box's integrity, so a box
 * still takes the hits it always did (a three-hit slab: two to open it, the
 * third on the bomb). What changes is that the last hit is visible as a
 * target before it is landed, and that no single blow can skip it: a hull hit
 * only ever exposes; it is the bomb that destroys.
 *
 * Not in one-touch brittle shards (nothing to chip), fence-style curtains (a
 * line, not a box), mirrors or movers. A map opts a box out with `bomb: false`.
 *
 * SHARD BOMBS are the small version, and a different idea: a brittle shard has
 * nothing to chip, so a bomb in one is not a last hit to aim for but a charge
 * waiting in the wall. About one shard in ten carries one (seeded per shard),
 * from level 17 on (`effectiveShardBombChance`: a map that teaches bricks gets
 * plain ones), drawn on the brick so it can be planned around. When it breaks it goes up
 * with the full bomb blast and strikes everything close by: neighbouring
 * shards go with it (a bomb among them goes up in turn), and a slab or chest
 * in reach takes a heavy blow. An ordinary shard, by contrast, now breaks with
 * a small burst: the big blast is the bomb's.
 */
import type { Ball, DestructibleState } from "@/types/game";
import type { LevelConfig, WallEntity } from "@/types/level";
import type { Polygon } from "@/lib/polygon";
import { polygonCentroid } from "@/lib/polygon";
import { getRunRng } from "@/lib/runRng";

/** Does this authored wall get a bomb? Asked once, when the map is built. */
export function entityHasBomb(e: Pick<WallEntity, "breakable" | "chest" | "brittle" | "fence" | "bomb">): boolean {
  if (e.bomb === false) return false;
  if (e.brittle || e.fence) return false;
  return !!(e.breakable || e.chest);
}

/** The hull's share of the integrity: all of it but the last hit. */
export function bombExposeAt(maxHits: number): number {
  return Math.max(0, maxHits - 1);
}

/** How much of the bomb shows, 0..1: the hull's wear against what it takes to open it. */
export function bombReveal(d: Pick<DestructibleState, "hits" | "bombExposeAt" | "bombExposed">): number {
  if (d.bombExposed) return 1;
  const at = d.bombExposeAt ?? 0;
  if (at <= 0) return 1;
  return Math.max(0, Math.min(1, d.hits / at));
}

/**
 * Apply one counted hit to a bomb box, returning the damage the hit really
 * does. A hull hit wears up to the exposure point and no further; a hit on
 * an exposed bomb spends the rest of the box at once.
 */
export function bombHitDamage(d: DestructibleState, amount: number, now: number): number {
  if (d.bombExposed) {
    d.bombDetonated = true;
    return Math.max(0, d.maxHits - d.hits);
  }
  const at = d.bombExposeAt ?? bombExposeAt(d.maxHits);
  const dealt = Math.max(0, Math.min(amount, at - d.hits));
  if (d.hits + dealt >= at) {
    d.bombExposed = true;
    d.bombExposedAt = now;
  }
  return dealt;
}

/** The bomb's colours: a dark iron casing and a fuse light that says "hit me". */
export const BOMB_CASING = 0x1a1d22;
export const BOMB_LIGHT = 0xff3b2a;
/** The fire the box goes up in. */
export const BOMB_BLAST_COLOR = "#ff5a2a";
/** The bomb's radius against the box's smaller half-extent. */
export const BOMB_SIZE = 0.62;
/** The fuse light's blink once exposed, ms per cycle. */
export const BOMB_BLINK_MS = 520;

// ── Shard bombs ─────────────────────────────────────────────────────────────

/** One kind of bomb's blast. */
export interface BombBlast {
  /** How far it reaches, world units: what it strikes, the hole it blows, the balls it throws. */
  radius: number;
  /** The blow a slab or chest in reach takes (a ball head-on at base speed does about 1). */
  damage: number;
  /** The kick a ball at the blast's centre gets, as a speed multiple; less towards the edge. */
  ballBoost: number;
}

/** public/game-config.yml `shard_bombs:` and `box_bombs:`. */
export interface ShardBombConfig {
  /** Chance an eligible shard carries one, rolled once per shard when the map is dealt. */
  chance: number;
  /**
   * The first map that rolls them: their Meet. Below it a map gets none unless
   * it says so (`shardBombChance`, or `bomb: true` on a shard), so a map that
   * teaches bricks is not also handing out unannounced explosions.
   */
  startLevel: number;
  /** A shard bomb's blast. */
  blastRadius: number;
  blastDamage: number;
  ballBoost: number;
  /** A slab or chest bomb's blast: the same effect, bigger. */
  box: BombBlast;
  /** How long a thrown ball takes to ease back to its own speed, seconds. */
  boostSeconds: number;
}

export const DEFAULT_SHARD_BOMB_CONFIG: ShardBombConfig = {
  chance: 0.1, startLevel: 17, blastRadius: 100, blastDamage: 1.5, ballBoost: 1.5,
  box: { radius: 150, damage: 2, ballBoost: 1.8 },
  boostSeconds: 2.5,
};

/** The kick at distance `d` from a blast of `radius`: full at the centre, half of it at the edge. */
export function blastKick(d: number, radius: number, boost: number): number {
  if (d > radius) return 1;
  const near = 1 - Math.max(0, d) / radius;
  return 1 + (boost - 1) * (0.5 + 0.5 * near);
}

/**
 * Throw every active ball in reach outward from the blast, faster. Each one
 * eases back to the speed it had before (see Ball.blastRestSpeed), so a chain
 * of blasts kicks a ball again rather than winding it up for good. A ball on
 * the exact centre gets a seeded direction, so both phones of a pair agree.
 */
export function blastBalls(
  balls: Ball[], centre: { x: number; y: number }, blast: BombBlast, now: number, boostSeconds: number,
  roll: () => number,
): number {
  let thrown = 0;
  for (const b of balls) {
    if (b.state !== "active") continue;
    let dx = b.position.x - centre.x, dy = b.position.y - centre.y;
    let d = Math.hypot(dx, dy);
    if (d > blast.radius) continue;
    const current = Math.hypot(b.velocity.x, b.velocity.y) || b.speed || b.baseSpeed || 100;
    const rest = b.blastRestSpeed ?? current;
    const sp = rest * blastKick(d, blast.radius, blast.ballBoost);
    if (d < 1) { dx = roll() - 0.5; dy = roll() - 0.5; d = Math.hypot(dx, dy) || 1; }
    dx /= d; dy /= d;
    b.velocity = { x: dx * sp, y: dy * sp };
    b.speed = sp;
    b.blastRestSpeed = rest;
    b.blastBoostFrom = sp;
    b.blastBoostAt = now;
    b.blastBoostUntil = now + boostSeconds * 1000;
    thrown++;
  }
  return thrown;
}

/**
 * Ease a thrown ball back towards its own speed. Called every physics step;
 * a no-op on a ball no blast has touched. Returns the speed to hold, or null.
 */
export function blastEaseSpeed(b: Ball, now: number): number | null {
  if (b.blastBoostUntil == null || b.blastRestSpeed == null || b.blastBoostFrom == null || b.blastBoostAt == null) return null;
  if (now >= b.blastBoostUntil) {
    const rest = b.blastRestSpeed;
    b.blastRestSpeed = b.blastBoostFrom = b.blastBoostAt = b.blastBoostUntil = undefined;
    return rest;
  }
  const t = (now - b.blastBoostAt) / Math.max(1, b.blastBoostUntil - b.blastBoostAt);
  // Eased out: most of the kick is spent early, so it reads as a shove.
  const k = 1 - (1 - t) * (1 - t);
  return b.blastBoostFrom + (b.blastRestSpeed - b.blastBoostFrom) * k;
}

/**
 * The chance this map's shards carry a bomb. Same shape as the pickups' and
 * bugs': the map's own `shardBombChance` wins outright (so a map below the
 * start level can opt in and one above it can say 0), else the global chance
 * from `startLevel` on, else none. The Playground's bonus goes on top, so a
 * tester can force bombs onto any map.
 */
export function effectiveShardBombChance(
  cfg: Pick<ShardBombConfig, "chance" | "startLevel">,
  levelNumber: number,
  levelChanceOverride: number | undefined,
  bonus = 0,
): number {
  const base = levelChanceOverride ?? (levelNumber >= cfg.startLevel ? cfg.chance : 0);
  return Math.max(0, Math.min(1, base + bonus));
}

/**
 * Can this map show a shard bomb at all, on the shipped config? The ledger's
 * question (lib/admin/mechanicSpread.ts), answered from the map alone: it has
 * shards, and either pins one, or its chance (its own, or the default from the
 * start level) is above zero.
 */
export function mapCanHaveShardBombs(
  level: Pick<LevelConfig, "entities" | "level" | "shardBombChance">,
  cfg: Pick<ShardBombConfig, "chance" | "startLevel"> = DEFAULT_SHARD_BOMB_CONFIG,
): boolean {
  const shards = (level.entities ?? []).filter(e => e.kind === "wall" && (e as WallEntity).brittle) as WallEntity[];
  if (shards.length === 0) return false;
  if (shards.some(w => w.bomb === true)) return true;
  return effectiveShardBombChance(cfg, level.level ?? 0, level.shardBombChance) > 0;
}

/** Which shards a map pins (`bomb: true`) or keeps clear (`bomb: false`). */
export function authoredShardBombs(level: Pick<LevelConfig, "entities">): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of level.entities ?? []) {
    if (e.kind !== "wall") continue;
    const w = e as WallEntity;
    if (w.brittle && typeof w.bomb === "boolean") out.set(w.id, w.bomb);
  }
  return out;
}

/**
 * Decide which shards carry a bomb, once, when the map is dealt. Seeded per
 * shard, so a Daily run and both halves of a lockstep pair carry the same
 * bricks. A shard already carrying a bug is skipped: a brick holding two
 * things is a brick nobody can read. Authored pins win both ways.
 */
export function assignShardBombs(
  destructibles: DestructibleState[], chance: number, authored: Map<string, boolean>,
): void {
  for (const d of destructibles) {
    if (d.kind !== "breakable" || !d.brittle || d.fenceStyle) continue;
    const want = authored.get(d.id);
    if (want === false) continue;
    if (want === true) { d.shardBomb = true; continue; }
    if (d.bug || chance <= 0) continue;
    if (getRunRng(`shardBomb:${d.id}`)() < chance) d.shardBomb = true;
  }
}

/** Distance from `p` to a polygon: 0 inside it, else to its nearest edge. Also the nearest point. */
function nearestOnPolygon(p: { x: number; y: number }, poly: Polygon): { d: number; at: { x: number; y: number } } {
  const v = poly.vertices;
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if ((v[i].y > p.y) !== (v[j].y > p.y) && p.x < ((v[j].x - v[i].x) * (p.y - v[i].y)) / (v[j].y - v[i].y) + v[i].x) inside = !inside;
  }
  if (inside) return { d: 0, at: { x: p.x, y: p.y } };
  let best = Infinity, at = { x: p.x, y: p.y };
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    const q = { x: a.x + ex * t, y: a.y + ey * t };
    const dd = Math.hypot(p.x - q.x, p.y - q.y);
    if (dd < best) { best = dd; at = q; }
  }
  return { d: best, at };
}

/**
 * What a shard bomb's blast reaches: every live breakable (other than the
 * bomb itself) whose nearest edge is within `radius` of the bomb's centre,
 * with the point it is struck at. Mirrors and movers stand in the blast
 * untouched, as they do against an ordinary ball.
 */
export function shardBombTargets(
  destructibles: readonly DestructibleState[], bomb: DestructibleState, radius: number,
): { d: DestructibleState; at: { x: number; y: number } }[] {
  const poly = bomb.obstaclePolygon;
  if (!poly) return [];
  const c = polygonCentroid(poly);
  const out: { d: DestructibleState; at: { x: number; y: number } }[] = [];
  for (const o of destructibles) {
    if (o === bomb || o.destroyed || o.kind !== "breakable" || !o.obstaclePolygon) continue;
    const near = nearestOnPolygon(c, o.obstaclePolygon);
    if (near.d <= radius) out.push({ d: o, at: near.at });
  }
  return out;
}

/** How big the 3D flash of an ordinary shard's break is (0..1); the bomb's is the full one. */
export const SHARD_BREAK_BLAST = 0.15;

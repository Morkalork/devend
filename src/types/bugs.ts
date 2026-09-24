/**
 * Bugs: the mini power-ups that fly around a board and pay the ball that
 * squashes them.
 *
 * ── Not to be confused with the Bug Squash upgrade ──────────────────────────
 *
 * `Ball.bugSquashUntil` and the `bugSquashChance` modifier are an OLDER,
 * unrelated feature: there the BALL is the bug, and squashing means the ball
 * splats flat against a wall it hit. Nothing in this file touches that. The
 * name collision is the price of a game about software: everything is a bug.
 * Everything here is spelled `bug` with no `Squash`, and everything there is
 * spelled `bugSquash`.
 *
 * ── Why this is not a pickup ────────────────────────────────────────────────
 *
 * A pickup token is claimed by SEALING A BALL IN WITH IT - the reward is for
 * where you drew your fence. MAP_DESIGN_GUIDELINES.md argued hard against a
 * third claim mechanism, on the grounds that a drop you had to tap or catch
 * would be a new rule stacked on a new archetype, and it was right about the
 * rule it was describing. This is a different one: a bug is squashed by a ball
 * running it over, which asks the question the token cannot - WHICH ball, and
 * where are you letting it run. On a Demolition map, where the balls are the
 * hammers and keeping one loose is the standing decision, that is the archetype
 * already being played, with a reason attached.
 *
 * It also answers the thing that ruled a classic falling drop out on this
 * ladder: most maps have no gravity, so nothing falls. A bug flies.
 *
 * Catalogue in public/bugs.yml; flight and squashing in lib/physics/bugs.ts;
 * what each one does in lib/physics/bugEffects.ts.
 */
import { Vector2 } from "@/lib/polygon";

/** A bug id is a catalogue key (dynamic, so just a string). */
export type BugEffect = string;

/** One entry in public/bugs.yml. */
export interface BugDef {
  id: BugEffect;
  name: string;
  /** Board colour, hex with '#'. */
  color: string;
  /** Relative spawn odds. 0 = never spawns randomly, but stays forceable. */
  weight: number;
  /** Magnitude; what it means is per-effect (see bugs.yml and bugEffects.ts). */
  value: number;
  /** Upper end when the magnitude is a range; `value` is then the lower end. */
  valueMax?: number;
  /** Squashing this can cost the player the map: drawn with a warning ring. */
  danger: boolean;
  /** What the player gets, in their own words. Shown on hold and in the roster. */
  description: string;
  /**
   * What it costs them.
   *
   * Its own field rather than a second sentence in `description`, because every
   * bug in this pool is double-edged and the upside and the downside have to be
   * legible as a PAIR. A card that buried the cost in a paragraph would be the
   * same card that made the pool read as pure reward, which is the one thing it
   * must not be.
   */
  cost: string;
}

/** A bug alive on the board. */
export interface BugState {
  id: string;
  effect: BugEffect;
  position: Vector2;
  /** World units per second; direction is the heading, magnitude the speed. */
  velocity: Vector2;
  /**
   * Wander phase, in radians, advanced every step.
   *
   * A bug that flew straight until it hit something would read as a slow
   * bullet. The phase drives both the heading's drift and the speed's pulse,
   * from one number, so a bug's path is a legible skitter rather than noise:
   * it darts, it slows, it turns, and a player can lead a ball into it.
   */
  wander: number;
  /** Offsets this bug's wander from its neighbours' so two never fly in step. */
  wanderSeed: number;
  /** game.activePlaySeconds, so a pause never eats a bug's life. */
  spawnedAtSeconds: number;
  expiresAtSeconds: number;
  /**
   * When it came out of a shard, for the brief burst the renderer draws at the
   * break. Absent on a bug the Playground conjured, which has no shard behind
   * it and so has nothing to burst out of.
   */
  bornAtSeconds?: number;
  /**
   * Where it was released, kept separately from `position` because the bug
   * flies away from it immediately and the burst has to stay on the SHARD.
   */
  spawnPosition?: Vector2;
}

/** A squash, rendered briefly where it happened. */
export interface BugSplat {
  id: string;
  effect: BugEffect;
  position: Vector2;
  /**
   * Direction the ball was travelling, so the splat sprays the right way.
   *
   * Zero when nothing hit it, which is the tapped case: a bug the player
   * squashed with a finger has no heading to spray along, so it bursts
   * radially instead. That difference is not decoration - it is how "a ball did
   * this" and "I did this" tell themselves apart at a glance.
   */
  direction: Vector2;
  /** performance.now() - presentation only, wall clock is right for it. */
  startTime: number;
  /**
   * What actually happened.
   *
   * Three outcomes, not two, and the third is the reason this stopped being a
   * boolean:
   *
   *   paid      a ball ran it over and the power landed on that ball.
   *   declined  a ball ran it over and the effect could not fire - Branch at
   *             the ball cap, Auto Merge on a ball with no room for a ring.
   *             "Nothing happened" and "nothing works" look the same from the
   *             outside, so the splat says which.
   *   denied    the PLAYER squashed it with a tap. Nothing was paid and nothing
   *             failed: the bug was refused on purpose, which is a different
   *             thing from an effect that misfired and must not be drawn as
   *             one.
   */
  outcome: "paid" | "declined" | "denied";
}

/**
 * Parsed `bugs:` block of game-config.yml.
 *
 * Spawning tuning is gone from this and is not coming back: a bug is not rolled
 * onto the board on a timer any more, it is carried by a shard and released
 * when that shard breaks. What is left is how MANY shards carry one, and how a
 * released bug behaves.
 */
export interface BugConfig {
  /** First level number shards may carry bugs on (a map's `bugChance` overrides it). */
  startLevel: number;
  /** Chance an eligible shard carries a bug, 0-1, rolled once per shard at map init. */
  carryChance: number;
  /** Hard cap on carrying shards per map, so a long wall is not a bug farm. */
  maxPerMap: number;
  /** Active-play seconds a RELEASED bug lives before it flies off. */
  lifetimeSeconds: number;
  /** Cruise speed in world units per second. */
  speed: number;
}

/**
 * The fallback tuning, used when game-config.yml has not loaded or omits a
 * field. Mirrors the shipped `bugs:` block and is pinned to it by a test, for
 * the reason DEFAULT_PICKUP_CONFIG is: the YAML normally wins, so drift here is
 * invisible until the one run where it doesn't.
 */
export const DEFAULT_BUG_CONFIG: BugConfig = {
  startLevel: 999,
  carryChance: 0.25,
  maxPerMap: 3,
  lifetimeSeconds: 20,
  speed: 95,
};

/**
 * A slab that has been hit a lot should LOOK like it, and should have left
 * pieces of itself on the board.
 *
 * Reported from play: "they just deform slightly after the first hit and the
 * deformation just moves around after that", with a wish attached - "I would
 * even appreciate pieces of it falling off of it and being hittable by balls
 * to change their course".
 *
 * The first half was a real defect with a one-line cause. Damage was drawn
 * from `dents`, which was a ring buffer of the six most recent CONTACTS, and a
 * slab in a long rally takes many small ones: the seventh contact dropped the
 * first, so a bite that had been taken out of the silhouette HEALED to make
 * room for a new one somewhere else. Nothing accumulated, and the wear
 * appeared to wander around the slab.
 *
 * Now a scar is cut per WEAR STEP - each time the slab loses another sixth of
 * its integrity - and none is ever removed. That makes the look monotonic by
 * construction (this file's first concern), bounds the list without dropping
 * anything, and gives the rubble something honest to be: the material the
 * silhouette just lost.
 *
 * The second half is physics/rubble.ts, and the thing worth pinning hardest
 * about it is everything it refuses to be. A chunk deflects balls and does
 * NOTHING else: it is not a wall, not in the space grid, not an occluder. A
 * transient obstacle that could seal a pocket or strand an objective would be
 * a far worse bug than the cosmetic one this started as.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerObjectHit } from "@/lib/physics/destructibles";
import {
  spawnRubble, updateRubble, deflectOffRubble, rubbleAlpha,
  CHUNK_LIFE_MS, MAX_RUBBLE,
} from "@/lib/physics/rubble";
import { setRunSeedText } from "@/lib/runRng";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, DestructibleState } from "@/types/game";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

/** A plain 3-hit slab, the ladder's ordinary breakable. */
function slab(over: Partial<DestructibleState> = {}): DestructibleState {
  return {
    id: "slab-1", kind: "breakable", hits: 0, maxHits: 3, destroyed: false,
    obstaclePolygon: { vertices: [
      { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 140 }, { x: 100, y: 140 },
    ] },
    ...over,
  } as unknown as DestructibleState;
}

function state(): CanvasGameState {
  return {
    objectDebris: [], pendingDestroys: [], rubble: [], balls: [],
  } as unknown as CanvasGameState;
}

/** Strike the slab's top face, well clear of the debounce each time. */
function strike(game: CanvasGameState, d: DestructibleState, n: number, amount = 1): void {
  for (let i = 0; i < n; i++) {
    registerObjectHit(game, d, "b1", 1000 + i * 500, amount, { x: 120 + i * 9, y: 100 });
  }
}

describe("wear accumulates instead of wandering", () => {
  it("never drops a scar it has cut", () => {
    // THE regression. Ten contacts on a slab used to leave six scars, the first
    // four healed; the count must only ever climb.
    setRunSeedText("wear");
    const game = state();
    const d = slab({ maxHits: 12 });
    let seen = 0;
    for (let i = 0; i < 10; i++) {
      strike(game, d, 1, 0.9);
      const now = d.dents?.length ?? 0;
      expect(now, "a scar was dropped to make room for a newer one")
        .toBeGreaterThanOrEqual(seen);
      seen = now;
    }
    setRunSeedText(null);
  });

  it("shows more of them the closer it is to breaking", () => {
    setRunSeedText("wear");
    const game = state();
    const d = slab({ maxHits: 6 });
    strike(game, d, 1, 1);
    const early = d.dents?.length ?? 0;
    strike(game, d, 4, 1);
    const late = d.dents?.length ?? 0;
    expect(early).toBeGreaterThan(0);
    expect(late, "a nearly-dead slab wears no more than a fresh one")
      .toBeGreaterThan(early);
    setRunSeedText(null);
  });

  it("cuts the late scars deeper than the early ones", () => {
    // So the silhouette degrades faster than linearly and "one more hit" is
    // readable from the shape, not only from the colour drain.
    setRunSeedText("wear");
    const game = state();
    const d = slab({ maxHits: 6 });
    strike(game, d, 6, 1);
    const depths = (d.dents ?? []).map(s => s.s);
    expect(depths.length).toBeGreaterThan(1);
    expect(depths[depths.length - 1], "the last scar bites no deeper than the first")
      .toBeGreaterThan(depths[0]);
    setRunSeedText(null);
  });

  it("never grows past the number of steps a slab can cross", () => {
    setRunSeedText("wear");
    const game = state();
    const d = slab({ maxHits: 30 });
    strike(game, d, 40, 0.6);
    expect((d.dents ?? []).length).toBeLessThanOrEqual(6);
    setRunSeedText(null);
  });
});

describe("pieces come off, and only when they should", () => {
  it("sheds rubble on a solid blow", () => {
    setRunSeedText("wear");
    const game = state();
    strike(game, slab(), 1, 1);
    expect(game.rubble.length, "a square hit knocked nothing loose").toBeGreaterThan(0);
    setRunSeedText(null);
  });

  it("wears but sheds nothing on a scrape", () => {
    // The chip floor is 0.15. A graze marks the surface and leaves it whole.
    setRunSeedText("wear");
    const game = state();
    const d = slab();
    strike(game, d, 1, 0.2);
    expect(d.dents?.length ?? 0, "a scrape left no mark at all").toBeGreaterThan(0);
    expect(game.rubble, "a scrape knocked a lump off").toHaveLength(0);
    setRunSeedText(null);
  });

  it("sheds nothing from a rail, whose lane is its outward side", () => {
    // Level 15's launcher rail is a 14-hit breakable a ball is meant to RIDE.
    // Rubble off it lands in the lane being ridden, and the shot bounced off
    // its own debris instead of following the bend (launcherRail.test.ts).
    setRunSeedText("wear");
    const game = state();
    strike(game, slab({ maxHits: 14 }), 3, 1);
    expect(game.rubble, "a rail shed into its own lane").toHaveLength(0);
    setRunSeedText(null);
  });

  it("sheds nothing on the hit that destroys the slab", () => {
    // The full shatter covers the last one; a chunk as well would be the same
    // material paid out twice.
    setRunSeedText("wear");
    const game = state();
    const d = slab({ maxHits: 1 });
    strike(game, d, 1, 1);
    expect(d.destroyed).toBe(true);
    expect(game.rubble).toHaveLength(0);
    setRunSeedText(null);
  });
});

describe("a chunk is a deflector and nothing more", () => {
  const rng = () => 0.5;

  function ballAt(x: number, y: number, vx: number): Ball {
    return {
      id: "b", position: { x, y }, velocity: { x: vx, y: 0 }, speed: Math.abs(vx),
      radius: 18, state: "active", assimScale: 1,
    } as unknown as Ball;
  }

  it("turns a ball without taking any of its speed", () => {
    // Nothing on this board damps a ball - the launcher's wager depends on it -
    // so a deflector that bled speed would be a brake wearing a rock's paint.
    const game = state();
    spawnRubble(game, { x: 300, y: 300 }, 1, 0, "#ffb454", 0, rng, 1);
    const c = game.rubble[0];
    const ball = ballAt(c.x - 40, c.y, 300);
    for (let i = 0; i < 40; i++) {
      ball.position.x += ball.velocity.x / 120;
      deflectOffRubble(game, ball, 1000 + i * 8);
    }
    expect(ball.velocity.x, "the ball went straight through").toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(300, 6);
  });

  it("is shoved by the ball that hits it", () => {
    const game = state();
    spawnRubble(game, { x: 300, y: 300 }, 1, 0, "#ffb454", 0, rng, 1);
    const c = game.rubble[0];
    for (let i = 0; i < 400; i++) updateRubble(game, 1 / 120, i * 8);  // let it settle
    expect(Math.hypot(c.vx, c.vy)).toBe(0);
    const ball = ballAt(c.x - 40, c.y, 300);
    for (let i = 0; i < 40; i++) {
      ball.position.x += ball.velocity.x / 120;
      deflectOffRubble(game, ball, 5000 + i * 8);
    }
    expect(c.vx, "a ball passed through it and left it sitting there").toBeGreaterThan(0);
  });

  it("slides, slows and comes to rest", () => {
    const game = state();
    spawnRubble(game, { x: 300, y: 300 }, 1, 0, "#ffb454", 0, rng, 1);
    const c = game.rubble[0];
    const startX = c.x;
    for (let i = 0; i < 400; i++) updateRubble(game, 1 / 120, i * 8);
    expect(c.x, "it never moved").toBeGreaterThan(startX);
    expect(Math.hypot(c.vx, c.vy), "it is still travelling").toBe(0);
  });

  it("fades and is gone, so the board stays the board", () => {
    const game = state();
    spawnRubble(game, { x: 300, y: 300 }, 1, 0, "#ffb454", 0, rng, 1);
    expect(rubbleAlpha(game.rubble[0], 0)).toBe(1);
    expect(rubbleAlpha(game.rubble[0], CHUNK_LIFE_MS * 0.95)).toBeLessThan(1);
    updateRubble(game, 1 / 120, CHUNK_LIFE_MS + 1);
    expect(game.rubble).toHaveLength(0);
  });

  it("keeps the newest pieces when the board is busy", () => {
    const game = state();
    for (let i = 0; i < MAX_RUBBLE + 8; i++) {
      spawnRubble(game, { x: 300 + i, y: 300 }, 1, 0, "#ffb454", i, rng, 1);
    }
    expect(game.rubble.length).toBeLessThanOrEqual(MAX_RUBBLE);
    expect(game.rubble[game.rubble.length - 1].x, "the newest hit produced nothing visible")
      .toBeGreaterThan(300 + MAX_RUBBLE);
  });
});

describe("rubble never touches what the map wants", () => {
  /**
   * Code only. This module's header explains at length what it refuses to
   * reach into, so a search over the raw file finds every forbidden name in
   * the prose that promises not to use them.
   */
  const codeOf = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
  const rubble = codeOf("../lib/physics/rubble.ts");

  it("is not a wall, not in the grid, and not an occluder", () => {
    // The whole safety argument. A transient obstacle that could seal a pocket
    // or strand an objective would be far worse than the cosmetic complaint
    // this feature started as, so it stays out of every system that decides
    // whether a map can still be won.
    for (const forbidden of ["game.walls", "spaceGrid", "regions", "obstaclePolygons"]) {
      expect(rubble, `rubble reaches into ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("is seeded, so a replayed seed deflects the same way", () => {
    // A deflector is physics. Physics that differed between two runs of one
    // seed would put the bot and the player on different boards.
    expect(rubble, "a chunk rolls its own dice").not.toContain("Math.random");
    expect(codeOf("../lib/physics/destructibles.ts")).toContain("getRunRng(`rubble:");
  });
});

describe("the wear and the rubble are wired in", () => {
  it("slides rubble in the browser loop and the bot harness alike", () => {
    expect(read("../hooks/useGameLoop.ts")).toContain("updateRubble(game, PHYSICS_STEP");
    expect(read("../lib/bot/headlessGame.ts"), "the bot plays different physics")
      .toContain("updateRubble(game, dt");
  });

  it("deflects balls from inside updateBall, so both collision paths see it", () => {
    expect(read("../lib/physics/updateBall.ts")).toContain("deflectOffRubble(game, ball, now);");
  });

  it("draws the pieces", () => {
    expect(read("../lib/rendering/sleek/fxLayer.ts")).toContain("this.drawRubble(game, light, w2s, scale, now);");
  });
});

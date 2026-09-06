/**
 * Steps 3-5 of FENCE_TYPES_PLAN: what the fence types actually DO.
 *
 * Ice takes speed off a ball, flare puts it on, and every special fence pays
 * for itself by building slower. The three shipped together on purpose: ice
 * without its cost is not a fence type, it is a free upgrade, and putting that
 * on staging even for one commit would be measuring a game nobody is going to
 * play.
 *
 * The two failures this file is really about, both silent:
 *
 *   THE RATCHET   a ball wedged in an ice corner touches the fence on every
 *                 frame. Step it every frame and it slows to a standstill and
 *                 the map cannot be finished - and it would read as a physics
 *                 bug rather than as a rule.
 *   THE SUM       build-speed factors that ADD instead of multiplying would
 *                 make an exotic fence on slow ground merely slow rather than
 *                 doubly so. The fence still builds, just not at the price it
 *                 names, so nothing on screen would ever say.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyFenceSpeedStep, STEP_DEBOUNCE_MS, MAX_SPEED_FACTOR,
} from "@/lib/physics/fenceTouch";
import { getFenceType, getAllFenceTypes } from "@/lib/fences";
import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ball = (speed = 200, over: Partial<Ball> = {}): Ball => ({
  id: "b", position: { x: 0, y: 0 }, velocity: { x: speed, y: 0 },
  speed, baseSpeed: 200, minimumSpeed: 60, radius: 18, state: "active",
  ...over,
} as unknown as Ball);

const fence = (fenceTypeId: string): Wall => ({
  id: "w1", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 6, fenceTypeId,
} as unknown as Wall);

const speedOf = (b: Ball) => Math.hypot(b.velocity.x, b.velocity.y);

describe("ice and flare", () => {
  it("takes speed off for ice", () => {
    const b = ball(200);
    expect(applyFenceSpeedStep(b, fence("ice"), 1000)).toBe(true);
    expect(speedOf(b)).toBeLessThan(200);
    expect(b.speed).toBeCloseTo(speedOf(b), 4);
  });

  it("puts speed on for flare", () => {
    const b = ball(200);
    expect(applyFenceSpeedStep(b, fence("flare"), 1000)).toBe(true);
    expect(speedOf(b)).toBeGreaterThan(200);
  });

  it("does nothing for a standard fence", () => {
    // The promise that owning none of this changes nothing, at the one site
    // where a bug would change every map in the game.
    const b = ball(200);
    expect(applyFenceSpeedStep(b, fence("standard"), 1000)).toBe(false);
    expect(speedOf(b)).toBe(200);
  });

  it("does nothing for a wall with no fence type at all", () => {
    // Board edges and obstacle boundaries. They are the majority of walls, and
    // they run through this on every bounce.
    const b = ball(200);
    const edge = { id: "board-1", start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, thickness: 6 } as unknown as Wall;
    expect(applyFenceSpeedStep(b, edge, 1000)).toBe(false);
    expect(speedOf(b)).toBe(200);
  });

  it("changes only the speed, never the direction", () => {
    // A fence that re-aimed a ball would be a bumper, which is a different
    // object with a different lesson.
    const b = ball(200, { velocity: { x: 120, y: 160 } } as Partial<Ball>);
    const before = Math.atan2(b.velocity.y, b.velocity.x);
    applyFenceSpeedStep(b, fence("ice"), 1000);
    expect(Math.atan2(b.velocity.y, b.velocity.x)).toBeCloseTo(before, 6);
  });
});

describe("the ratchet cannot happen", () => {
  it("steps at most once per debounce window", () => {
    // A ball resting against ice touches it sixty times a second.
    //
    // Given HEADROOM on purpose: at an ordinary 200 with a 60 floor, ice runs
    // out of room after about seven steps, so the count is bounded by the floor
    // and the test passes whether or not the debounce exists. It did exactly
    // that, and deleting the debounce - the ratchet, the failure this whole
    // module is written around - left it green.
    const b = ball(5000, { minimumSpeed: 20, baseSpeed: 5000 } as Partial<Ball>);
    let taken = 0;
    for (let frame = 0; frame < 60; frame++) {
      if (applyFenceSpeedStep(b, fence("ice"), 1000 + frame * 16)) taken++;
    }
    // 60 frames at 16ms is 960ms; at 90ms apart that is eleven steps, not sixty.
    expect(taken, "the debounce is gone: the ball is stepping every frame")
      .toBeLessThanOrEqual(Math.ceil(960 / STEP_DEBOUNCE_MS));
    expect(taken, "nothing stepped at all, so this proves nothing").toBeGreaterThan(1);
    expect(speedOf(b), "with headroom the floor must not be what stopped it")
      .toBeGreaterThan(20);
  });

  it("never takes a ball below its own floor", () => {
    const b = ball(200, { minimumSpeed: 150 } as Partial<Ball>);
    for (let i = 0; i < 200; i++) applyFenceSpeedStep(b, fence("ice"), 1000 + i * 100);
    expect(speedOf(b)).toBeGreaterThanOrEqual(150 - 1e-6);
  });

  it("uses the BALL's floor, not a constant", () => {
    // A grey ball winds itself down to its own minimum. Ice must not be able to
    // take it below what the ball type says is its slowest.
    const fast = ball(200, { minimumSpeed: 190 } as Partial<Ball>);
    for (let i = 0; i < 50; i++) applyFenceSpeedStep(fast, fence("ice"), 1000 + i * 100);
    expect(speedOf(fast)).toBeGreaterThanOrEqual(190 - 1e-6);
  });

  it("stops spending the debounce once it is pinned", () => {
    // At the floor, ice is a no-op - and it must not eat the debounce doing
    // nothing, or a bounce off FLARE a moment later would be swallowed too.
    const b = ball(200, { minimumSpeed: 200 } as Partial<Ball>);
    expect(applyFenceSpeedStep(b, fence("ice"), 1000)).toBe(false);
    expect(applyFenceSpeedStep(b, fence("flare"), 1001), "the pinned ice bounce ate the flare bounce")
      .toBe(true);
  });

  it("caps how fast flare can make a ball", () => {
    // Without a ceiling a ball outruns the collision step and tunnels through
    // fences, so the reward for using flare would be a fence that does nothing.
    const b = ball(200);
    for (let i = 0; i < 500; i++) applyFenceSpeedStep(b, fence("flare"), 1000 + i * 100);
    expect(speedOf(b)).toBeLessThanOrEqual(200 * MAX_SPEED_FACTOR + 1e-6);
  });

  it("keeps its own debounce, apart from the yellow ball's", () => {
    // A yellow ball bouncing off ice has to get both effects. One shared
    // timestamp would have whichever fired first silently eat the other.
    const b = ball(200, { lastSpeedStepAt: 1000 } as Partial<Ball>);
    expect(applyFenceSpeedStep(b, fence("ice"), 1001)).toBe(true);
  });
});

describe("what a special fence costs", () => {
  it("multiplies its build speed in, rather than adding it", () => {
    const src = read("src/lib/physics/updateFenceWall.ts");
    expect(src, "the fence type stopped affecting build speed")
      .toMatch(/getFenceType\(wall\.fenceTypeId\)\.buildSpeed/);
    // The whole factor stack on one expression, all multiplied.
    const line = src.slice(src.indexOf("const wallSpeedEffective"), src.indexOf("let totalStartPath"));
    expect(line, "a build-speed factor is being added instead of multiplied")
      .not.toMatch(/[+-]\s*fenceType/);
    expect(line).toMatch(/\*\s*terrain\s*\*\s*fenceType/);
  });

  it("prices every special type", () => {
    // A type with no cost and a real effect is a free upgrade, which is the one
    // shape the whole cost model exists to forbid.
    for (const f of getAllFenceTypes()) {
      if (f.id === "standard") continue;
      const hasEffect = f.ballSpeedStep !== 0 || f.maxHits !== undefined
        || f.anchorOnBreakable || f.drillDamage > 0;
      if (!hasEffect) continue;
      expect(f.buildSpeed, `${f.id} has an effect and no price`).not.toBe(1);
    }
  });

  it("lets tripwire be the one that pays the other way", () => {
    // The axis has to run both ways or it is a tax rather than a trade: the
    // fast fence exists, and it is the fragile one.
    const t = getFenceType("tripwire");
    expect(t.buildSpeed).toBeGreaterThan(1);
    expect(t.maxHits, "the fast fence is not the fragile one").toBe(1);
  });

  it("charges the slingshot fence in build speed like every other special", () => {
    // Redeploy's effect is a gesture rather than a collision rule, which makes
    // it the type most likely to be quietly handed out for free. It pays the
    // same price as the rest: it builds slower.
    const r = getFenceType("redeploy");
    expect(r.slingshot).toBe(true);
    expect(r.buildSpeed).toBeLessThan(1);
  });

  it("has exactly one slingshot type", () => {
    // A second one would need its own reason to exist, and the grab would have
    // to choose between them.
    const slings = getAllFenceTypes().filter(f => f.slingshot).map(f => f.id);
    expect(slings).toEqual(["redeploy"]);
  });
});

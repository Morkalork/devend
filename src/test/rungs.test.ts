/**
 * The rungs' rules (BALL_TREE_PLAN.md phase 2; lib/physics/rungs.ts).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  FROST_BOUNCE_MS, FROST_ICE_MS, FROST_TOUCH_MS, GRACE_MS, PACE3_FROZEN_MS, SIGHT_BOUNCES, WEIGHT_DENSITY, WORTH_LOCK,
  applyRungsAtSpawn, frostOnBounce, frostOnCollision, frostOnIce, sightBouncesOf, spendGrace,
} from "@/lib/physics/rungs";
import { applyFenceSpeedStep } from "@/lib/physics/fenceTouch";
import { ballMass } from "@/lib/physics/destructibles";
import { createBallEffectState } from "@/lib/ballEffects";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { setActiveRuleSet } from "@/lib/cardRules";
import { defaultRoster, setActiveRoster } from "@/lib/roster";
import { createBotGame, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { ARCHIVE, byLevel } from "./fixtures/maps";
import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";

const ball = (over: Partial<Ball> = {}): Ball => ({
  id: "b", state: "active", position: { x: 100, y: 100 }, velocity: { x: 200, y: 0 }, speed: 200, baseSpeed: 200,
  topSpeed: 200, minimumSpeed: 100, radius: BASE_BALL_RADIUS, typeId: "red", color: "#fff", ability: "none",
  lockMultiplier: 1, regionId: "r", effects: createBallEffectState(), ...over,
} as unknown as Ball);

describe("a rung applied at spawn", () => {
  it("weight sets the mass and, from rank two, the heavy rules", () => {
    const light = ball();
    const one = ball(); applyRungsAtSpawn(one, { slot: 1, rungs: { weight: 1 } }, 0);
    const two = ball(); applyRungsAtSpawn(two, { slot: 1, rungs: { weight: 2 } }, 0);
    const three = ball(); applyRungsAtSpawn(three, { slot: 1, rungs: { weight: 3 } }, 0);
    expect(ballMass(one)).toBeCloseTo(ballMass(light) * WEIGHT_DENSITY[1]);
    expect(ballMass(three)).toBeCloseTo(ballMass(light) * WEIGHT_DENSITY[3]);
    expect(one.heavy).toBe(false);
    expect(two.heavy).toBe(true);
    expect(two.shoves).toBe(false);
    expect(three.shoves).toBe(true);
    expect(three.lockMultiplier).toBe(3);
    expect(one.slot).toBe(1);
    expect(one.rungs).toEqual({ weight: 1 });
  });

  it("worth multiplies the lock and, at rank three, makes the money ball", () => {
    const b = ball(); applyRungsAtSpawn(b, { slot: 2, rungs: { worth: 2 } }, 0);
    expect(b.lockMultiplier).toBe(WORTH_LOCK[2]);
    expect(b.ability).toBe("none");
    const m = ball(); applyRungsAtSpawn(m, { slot: 2, rungs: { worth: 3 } }, 0);
    expect(m.ability).toBe("moneyBall");
    // Weight three and worth stack.
    const both = ball(); applyRungsAtSpawn(both, { slot: 1, rungs: { worth: 1, weight: 3 } }, 0);
    expect(both.lockMultiplier).toBe(6);
  });

  it("pace slows the ball, steadies it, and at rank three holds it at the start", () => {
    const one = ball(); applyRungsAtSpawn(one, { slot: 1, rungs: { pace: 1 } }, 1000);
    expect(one.speed).toBeCloseTo(160);
    expect(one.velocity.x).toBeCloseTo(160);
    expect(one.minimumSpeed).toBeCloseTo(80);
    expect(one.steady).toBe(false);
    expect(one.frozenUntil).toBeUndefined();
    const three = ball(); applyRungsAtSpawn(three, { slot: 1, rungs: { pace: 3 } }, 1000);
    expect(three.steady).toBe(true);
    expect(three.frozenUntil).toBe(1000 + PACE3_FROZEN_MS);
  });

  it("grace gives the fence its quarter second and, from rank two, lives for the fence to pay", () => {
    const one = ball(); applyRungsAtSpawn(one, { slot: 1, rungs: { grace: 1 } }, 0);
    expect(one.graceMs).toBe(GRACE_MS);
    expect(spendGrace(one)).toBe(false);
    const two = ball(); applyRungsAtSpawn(two, { slot: 1, rungs: { grace: 2 } }, 0);
    expect(spendGrace(two)).toBe(true);
    expect(spendGrace(two)).toBe(false);
    const three = ball(); applyRungsAtSpawn(three, { slot: 1, rungs: { grace: 3 } }, 0);
    for (let i = 0; i < 5; i++) expect(spendGrace(three)).toBe(true);
  });

  it("sight draws one, three or five bounces", () => {
    expect(sightBouncesOf(ball())).toBe(0);
    for (const rank of [1, 2, 3] as const) {
      const b = ball(); applyRungsAtSpawn(b, { slot: 1, rungs: { sight: rank } }, 0);
      expect(sightBouncesOf(b)).toBe(SIGHT_BOUNCES[rank]);
    }
  });
});

describe("frost", () => {
  it("rank one freezes on every third surface hit, by the freeze path", () => {
    const b = ball(); applyRungsAtSpawn(b, { slot: 1, rungs: { frost: 1 } }, 0);
    expect(frostOnBounce(b, 100)).toBe(false);
    expect(frostOnBounce(b, 200)).toBe(false);
    expect(frostOnBounce(b, 300)).toBe(true);
    expect(b.frozenUntil).toBe(300 + FROST_BOUNCE_MS);
    expect(frostOnBounce(ball(), 100)).toBe(false);
  });

  it("rank two freezes the ball it struck; rank three freezes on Ice", () => {
    const one = ball(); applyRungsAtSpawn(one, { slot: 1, rungs: { frost: 1 } }, 0);
    const other = ball({ id: "o" });
    expect(frostOnCollision(one, other, 50)).toBe(false);
    const two = ball(); applyRungsAtSpawn(two, { slot: 1, rungs: { frost: 2 } }, 0);
    expect(frostOnCollision(two, other, 50)).toBe(true);
    expect(other.frozenUntil).toBe(50 + FROST_TOUCH_MS);
    // Already frozen: not refrozen, not extended.
    expect(frostOnCollision(two, other, 60)).toBe(false);
    expect(frostOnIce(two, 70)).toBe(false);
    const three = ball(); applyRungsAtSpawn(three, { slot: 1, rungs: { frost: 3 } }, 0);
    expect(frostOnIce(three, 70)).toBe(true);
    expect(three.frozenUntil).toBe(70 + FROST_ICE_MS);
  });
});

describe("a steady or heavy ball against a fence", () => {
  const ice = { id: "w", fenceTypeId: "ice", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6 } as unknown as Wall;
  const flare = { id: "f", fenceTypeId: "flare", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6 } as unknown as Wall;

  it("ice slows a plain ball and not a heavy one; nothing steps a steady one", () => {
    const plain = ball();
    expect(applyFenceSpeedStep(plain, ice, 1000)).toBe(true);
    const heavy = ball(); applyRungsAtSpawn(heavy, { slot: 1, rungs: { weight: 2 } }, 0);
    expect(applyFenceSpeedStep(heavy, ice, 1000)).toBe(false);
    // Flare still speeds a heavy ball up: only Ice is beneath it.
    expect(applyFenceSpeedStep(heavy, flare, 2000)).toBe(true);
    const steady = ball(); applyRungsAtSpawn(steady, { slot: 1, rungs: { pace: 2 } }, 0);
    expect(applyFenceSpeedStep(steady, ice, 1000)).toBe(false);
    expect(applyFenceSpeedStep(steady, flare, 2000)).toBe(false);
  });
});

describe("the roster's rungs on a real board", () => {
  afterEach(() => {
    setActiveRuleSet("classic");
    setActiveRoster(defaultRoster());
    releaseClock();
  });

  it("spawns a super ball and a fleet with their rules on", () => {
    installClock();
    setRunSeedText("rungs");
    setActiveRuleSet("tree");
    setActiveRoster([
      { slot: 1, rungs: { weight: 3, worth: 2 } },
      { slot: 2, rungs: { pace: 3 } },
      { slot: 3, rungs: { sight: 2, grace: 1 } },
    ]);
    const { game } = createBotGame(byLevel(ARCHIVE, 8)!, 8);
    const mine = game.balls.filter(b => b.slot !== undefined);
    expect(mine.length).toBe(3);
    const [a, b, c] = mine;
    expect(a.density).toBe(WEIGHT_DENSITY[3]);
    expect(a.lockMultiplier).toBe(3 * WORTH_LOCK[2]);
    expect(b.steady).toBe(true);
    expect(b.frozenUntil).toBeGreaterThan(0);
    expect(sightBouncesOf(c)).toBe(3);
    expect(c.graceMs).toBe(GRACE_MS);
  });
});

/**
 * The Breakpoint fence: the first ball to touch one stops dead, once a map.
 *
 * Three things would ship broken and silent, and the first is the whole
 * balance of the mechanic:
 *
 *   THE BUDGET   once per MAP, not per fence. A fence type is unlimited once
 *                owned, so per-fence would let a player line a board with
 *                Breakpoints and chain-hold one ball from end to end - a
 *                stronger effect than Cascade Freeze, which costs a maxed
 *                family and twenty-two levels. Nothing on screen would say:
 *                it would just be the best fence in the game.
 *   THE RESET    the budget lives on the game state, so the per-map block in
 *                GameCanvas has to clear it. A field that block forgets is a
 *                field that is never set at all - the launcher shipped inert
 *                for exactly that - and here it would give map two no
 *                Breakpoint and no sign of why.
 *   THE REFUND   spending the hold and then losing the fence must not give it
 *                back, which is why the count is not on the wall.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  holdMsOf, isArmedBreakpoint, holdOnBreakpoint,
} from "@/lib/physics/breakpointFence";
import { getFenceType, getAllFenceTypes } from "@/lib/fences";
import { FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";
import type { Wall } from "@/lib/wallGeometry";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";

const fence = (fenceTypeId = "breakpoint", id = "w1"): Wall => ({
  id, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6, fenceTypeId,
} as unknown as Wall);

/** A board edge or obstacle boundary: no fence type at all, and never will be. */
const untypedWall = (): Wall => ({
  id: "board-top", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6,
} as unknown as Wall);

const ball = (over: Partial<Ball> = {}): Ball => ({
  id: "b", position: { x: 50, y: 10 }, velocity: { x: 0, y: -200 },
  speed: 200, baseSpeed: 200, minimumSpeed: 60, radius: 18, state: "active",
  ...over,
} as unknown as Ball);

const board = (walls: Wall[] = [fence()]): CanvasGameState =>
  ({ walls, balls: [] } as unknown as CanvasGameState);

const NOW = 10_000;

describe("the catalogue entry", () => {
  it("is the only holding type, and it pays in build speed", () => {
    const holders = getAllFenceTypes().filter(f => f.holdMs > 0);
    expect(holders.map(f => f.id)).toEqual(["breakpoint"]);
    // The mildest price of any special, because it is the accessible one - but
    // still a price. A free special would make the slot bar a pure gain.
    expect(holders[0].buildSpeed).toBeLessThan(1);
  });

  it("holds once, for two seconds", () => {
    const b = getFenceType("breakpoint");
    expect(b.holdMs).toBe(2000);
    expect(b.holdsPerMap).toBe(1);
  });

  it("does nothing else: it is one idea", () => {
    const b = getFenceType("breakpoint");
    expect(b.ballSpeedStep).toBe(0);
    expect(b.slingshot).toBe(false);
    expect(b.drillDamage).toBe(0);
    expect(b.anchorOnBreakable).toBe(false);
  });

  it("leaves every other type unable to hold", () => {
    for (const id of ["standard", "ice", "flare", "tripwire", "redeploy", "drill"]) {
      expect(holdMsOf(fence(id)), `${id} holds balls`).toBe(0);
    }
    // A board edge or obstacle boundary carries no type at all.
    expect(holdMsOf(untypedWall())).toBe(0);
  });
});

describe("the hold", () => {
  it("stops the first ball to bounce off one", () => {
    const g = board();
    const b = ball();
    expect(holdOnBreakpoint(g, b, fence(), NOW)).toBe(true);
    expect(b.frozenUntil).toBe(NOW + 2000);
    // The same two fields a tap-freeze writes, so a held ball IS a frozen ball
    // rather than a second kind of motionless ball to learn about.
    expect(b.freezeReadyAt).toBe(NOW + 2000 * (1 + FREEZE_COOLDOWN_MULTIPLIER));
  });

  it("is spent once per MAP, across every fence on it", () => {
    // The balance decision. Per fence, a board lined with Breakpoints would
    // chain-hold one ball from one end to the other.
    const g = board([fence("breakpoint", "a"), fence("breakpoint", "b")]);
    expect(holdOnBreakpoint(g, ball(), fence("breakpoint", "a"), NOW)).toBe(true);
    const second = ball();
    expect(holdOnBreakpoint(g, second, fence("breakpoint", "b"), NOW + 5000)).toBe(false);
    expect(second.frozenUntil).toBeUndefined();
  });

  it("darkens every Breakpoint on the board at once, because the budget is shared", () => {
    const a = fence("breakpoint", "a"), b = fence("breakpoint", "b");
    const g = board([a, b]);
    expect(isArmedBreakpoint(g, a)).toBe(true);
    expect(isArmedBreakpoint(g, b)).toBe(true);
    holdOnBreakpoint(g, ball(), a, NOW);
    expect(isArmedBreakpoint(g, a)).toBe(false);
    expect(isArmedBreakpoint(g, b)).toBe(false);
  });

  it("is not spent on a ball that is already frozen", () => {
    // It is not moving, so a hold buys nothing - and swallowing the map's one
    // hold for nothing is the worst outcome the mechanic can have.
    const g = board();
    const frozen = ball({ frozenUntil: NOW + 500 });
    expect(holdOnBreakpoint(g, frozen, fence(), NOW)).toBe(false);
    expect(g.breakpointHoldsUsed ?? 0).toBe(0);
    // ...and once it has thawed, the hold is still there for it.
    expect(holdOnBreakpoint(g, ball(), fence(), NOW + 1000)).toBe(true);
  });

  it("does nothing for a fence of any other type", () => {
    const g = board();
    for (const id of ["standard", "ice", "flare", "tripwire", "redeploy", "drill"]) {
      const b = ball();
      expect(holdOnBreakpoint(g, b, fence(id), NOW), `${id} held a ball`).toBe(false);
      expect(b.frozenUntil).toBeUndefined();
    }
  });

  it("does not refund itself when the fence that spent it is gone", () => {
    // The count is on the MAP, not on the wall, exactly so that losing the
    // fence cannot hand the hold back.
    const g = board();
    expect(holdOnBreakpoint(g, ball(), fence(), NOW)).toBe(true);
    g.walls = [];
    expect(holdOnBreakpoint(g, ball(), fence(), NOW + 100)).toBe(false);
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("is called from the bounce, beside the speed step", () => {
    // A ball can touch two fences in one step, so the fence that stops it has
    // to be the one it really hit - which is why this lives at the collision
    // rather than after the loop from a remembered id.
    const src = read("src/lib/physics/updateBall.ts");
    expect(src).toMatch(/holdOnBreakpoint\(game, ball, wall, now\)/);
  });

  it("resets its budget with the rest of the per-map state", () => {
    // A hold that carried over would give map two no Breakpoint and nothing on
    // screen to say why.
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/game\.breakpointHoldsUsed = 0/);
  });

  it("is reachable without committing to anything: a root upgrade", () => {
    // The whole point of this one. Every other fence type is the crown of a
    // maxed family; a player who spreads their buys has to be able to meet the
    // system anyway.
    const yaml = read("public/upgrades.yml");
    const entry = yaml.slice(yaml.indexOf("- id: set_a_breakpoint"));
    const block = entry.slice(0, entry.indexOf("\n  - id:"));
    expect(block).toMatch(/grantsFenceType: breakpoint/);
    expect(block, "the open shelf grew a prerequisite").not.toMatch(/prerequisites:/);
    expect(block, "the open shelf grew a family gate").not.toMatch(/unlockAfterChoice:/);
  });
});

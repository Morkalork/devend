/**
 * The Guardrail fence: a fence that brings its own shield.
 *
 * It replaced Breakpoint, which held the first ball to bounce off a FINISHED
 * fence for two seconds. A finished fence is already safe, so the hold paid out
 * where nothing was at risk. The Guardrail pays out while the fence grows: the
 * first ball to cut through one on a map costs the fence, not a life, exactly
 * as a Defensive Programming shield would.
 *
 * Pinned here:
 *   - the price:   it builds slower, and the shield is once per MAP, however
 *                  many Guardrails are drawn;
 *   - the order:   its own shield goes before the run's, so a Guardrail hit
 *                  never spends the shield bought for every other fence;
 *   - the scope:   a standard fence hit never touches it;
 *   - the retire:  Breakpoint is gone, and a run that owned it owns this.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  guardrailShieldsOf, isArmedGuardrail, spendGuardrailShield,
} from "@/lib/physics/guardrailFence";
import { ballStruckFence } from "@/lib/physics/fenceStrike";
import { getAllFenceTypes, getFenceType, isKnownFenceType, STANDARD_FENCE_ID } from "@/lib/fences";
import { liveUpgradeIds } from "@/lib/upgradeMigration";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { MapFailure } from "@/lib/mapFailure";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ball = (): Ball => ({
  id: "b", position: { x: 50, y: 10 }, velocity: { x: 0, y: -200 },
  speed: 200, baseSpeed: 200, minimumSpeed: 60, radius: 18, state: "active",
} as unknown as Ball);

const board = (wallShields = 0): CanvasGameState => ({
  walls: [], balls: [], activeWalls: [{ fenceTypeId: "guardrail" }],
  wallShieldsRemaining: wallShields, pushMode: null,
} as unknown as CanvasGameState);

/** Just enough of the callbacks for a strike that does not end the run. */
function harness(lives = 3) {
  let current = lives;
  const messages: string[] = [];
  const callbacks = {
    flashTimeoutRef: { current: null }, shakeTimeoutRef: { current: null },
    setScreenFlash: () => {}, setIsShaking: () => {}, setIsRecovering: () => {},
    setWallShieldCount: () => {},
    getLives: () => current,
    setLivesRef: (n: number) => { current = n; },
    setDisplayLives: () => {}, onLivesChange: () => {},
    onGameMessage: (id: string) => messages.push(id),
  } as unknown as GameCallbacks;
  return { callbacks, messages, lives: () => current };
}

const strike = (game: CanvasGameState, h: ReturnType<typeof harness>, fenceTypeId?: string) =>
  ballStruckFence(
    game, ball(), {} as LevelConfig, 5, {} as GameModifiers, h.callbacks,
    { kind: "ballHitFence" } as MapFailure, fenceTypeId,
  );

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("the catalogue entry", () => {
  it("is the only type with a shield, one a map, and it pays in build speed", () => {
    const shielded = getAllFenceTypes().filter(f => f.shieldsPerMap > 0);
    expect(shielded.map(f => f.id)).toEqual(["guardrail"]);
    expect(shielded[0].shieldsPerMap).toBe(1);
    // Every special pays by building slower (fences.yml). A free one would
    // make the slot a pure gain over Standard.
    expect(shielded[0].buildSpeed).toBeLessThan(1);
  });

  it("gives no shield to the standard fence, or to a wall with no type", () => {
    expect(guardrailShieldsOf(undefined)).toBe(0);
    expect(guardrailShieldsOf(STANDARD_FENCE_ID)).toBe(0);
    expect(guardrailShieldsOf("guardrail")).toBe(1);
  });

  it("retires Breakpoint completely", () => {
    expect(isKnownFenceType("breakpoint")).toBe(false);
    expect(getAllFenceTypes().some(f => /breakpoint/i.test(f.name))).toBe(false);
  });
});

describe("the shield", () => {
  it("forgives the first Guardrail hit: the fence goes, the life stays", () => {
    const game = board();
    const h = harness(3);
    strike(game, h, "guardrail");
    expect(h.lives()).toBe(3);
    expect(game.activeWalls).toEqual([]);
    expect(game.guardrailShieldsUsed).toBe(1);
    expect(h.messages).toEqual(["guardrailCaught"]);
    expect(game.guardrailFlash).toMatchObject({ x: 50, y: 10 });
  });

  it("is spent before the run's Defensive Programming shield", () => {
    // Otherwise a Guardrail hit would burn the shield bought for every other
    // fence and leave its own sitting there unused.
    const game = board(1);
    const h = harness(3);
    strike(game, h, "guardrail");
    expect(game.wallShieldsRemaining, "the run's shield went first").toBe(1);
    expect(game.guardrailShieldsUsed).toBe(1);
  });

  it("is once per MAP, however many Guardrails are drawn", () => {
    // Per fence would be a free life on every cut.
    const game = board(0);
    const h = harness(3);
    strike(game, h, "guardrail");
    expect(isArmedGuardrail(game, "guardrail")).toBe(false);
    strike(game, h, "guardrail");
    expect(h.lives(), "a second Guardrail was forgiven too").toBe(2);
    expect(h.messages).toEqual(["guardrailCaught", "lifeLostBall"]);
  });

  it("hands over to the run's shields once it is spent", () => {
    const game = board(1);
    const h = harness(3);
    strike(game, h, "guardrail");
    strike(game, h, "guardrail");
    expect(h.lives()).toBe(3);
    expect(game.wallShieldsRemaining).toBe(0);
  });

  it("never covers a standard fence", () => {
    const game = board(0);
    const h = harness(3);
    strike(game, h, STANDARD_FENCE_ID);
    expect(h.lives()).toBe(2);
    expect(game.guardrailShieldsUsed ?? 0).toBe(0);
    expect(isArmedGuardrail(game, "guardrail"), "a standard hit spent the Guardrail's shield").toBe(true);
  });

  it("does not spend when there is nothing armed", () => {
    const game = board();
    expect(spendGuardrailShield(game, ball(), undefined, 0)).toBe(false);
    expect(spendGuardrailShield(game, ball(), "ice", 0)).toBe(false);
    expect(game.guardrailShieldsUsed ?? 0).toBe(0);
  });
});

describe("the wiring", () => {
  it("both ways a ball can break a fence say which fence it was", () => {
    // A growing fence hit and a ball found on the line at completion cost the
    // same (fenceStrikeCost.test.ts), so both have to be forgivable.
    expect(read("src/lib/physics/updateFenceWall.ts")).toMatch(/ballStruckFence\([\s\S]*?wall\.fenceTypeId\)/);
    expect(read("src/lib/physics/applyCut.ts")).toMatch(/ballStruckFence\([\s\S]*?wall\.fenceTypeId\)/);
  });

  it("resets with the rest of the per-map state", () => {
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/game\.guardrailShieldsUsed = 0/);
    expect(src).toMatch(/setGuardrailSpent\(false\)/);
  });

  it("is reachable without committing to anything: a root upgrade", () => {
    const yaml = read("public/upgrades.yml");
    const entry = yaml.slice(yaml.indexOf("- id: add_guardrails"));
    const block = entry.slice(0, entry.indexOf("\n  - id:"));
    expect(block).toMatch(/grantsFenceType: guardrail/);
    expect(block, "the open shelf grew a prerequisite").not.toMatch(/prerequisites:/);
    expect(block, "the open shelf grew a family gate").not.toMatch(/unlockAfterChoice:/);
    expect(yaml, "the retired upgrade is still for sale").not.toMatch(/id: set_a_breakpoint/);
  });

  it("carries a saved run that owned Set A Breakpoint over to Add Guardrails", () => {
    expect(liveUpgradeIds(["set_a_breakpoint", "defensive_programming_junior"]))
      .toEqual(["add_guardrails", "defensive_programming_junior"]);
  });

  it("keeps its colour where the ring is drawn", () => {
    // The flash ring is a literal in the effects layer; it must stay the fence's.
    const hex = getFenceType("guardrail").color.replace("#", "").toLowerCase();
    expect(read("src/lib/rendering/sleek/fxLayer.ts")).toContain(`0x${hex}`);
  });
});

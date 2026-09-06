/**
 * Mutex and Semaphore: the fences that only seal the right crowd, and the pay
 * that escapes the map's cap.
 *
 * ── The number the whole feature exists for ────────────────────────────────
 *
 * The simultaneous-lock multiplier is `newlyLocked`, applied to the SUM of the
 * balls locked in the pass, so the curve is already N-squared: at lockValue 12
 * a four-ball pass earns 192h nominal. All of it banks through delivery (30h)
 * and craft (30h), so sixty hours is the ceiling - and only if nothing else had
 * filled those lanes, which on a map where you just herded four balls into one
 * pocket is unlikely. The fourth ball is frequently worth NOTHING today.
 *
 * So qualified overtime is added AFTER the backstop clamp, and these are the
 * three properties that keep an uncapped channel safe:
 *
 *   A FLAT TABLE    nothing multiplies it, so uncapped cannot become unbounded.
 *   THE REAL COUNT  keyed to balls locked, never to the simultaneous MULTIPLIER
 *                   that Chain Reaction inflates - otherwise a set bonus buys a
 *                   bracket for free.
 *   CLAMPED AT 4    every map's maxBalls is 1-4. A pass of five means something
 *                   upstream broke, and a bug should cost a wrong number rather
 *                   than an unbounded one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bandAllowsLock, lockBandOf, ballsSharingPocket } from "@/lib/physics/lockBand";
import {
  qualifiedUnitsFor, qualifiedHoursFor, MAX_SIMULTANEOUS_LOCK,
} from "@/lib/qualifiedOvertime";
import { getFenceType, getAllFenceTypes } from "@/lib/fences";
import { calculateScore, getOvertimeCap, DEFAULT_SCORING_CONFIG } from "@/lib/scoring";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const LOCK_VALUE = 12;

describe("the catalogue entries", () => {
  it("are the only banded types, and they are opposite ends of one rule", () => {
    const banded = getAllFenceTypes().filter(f => f.lockBand);
    expect(banded.map(f => f.id).sort()).toEqual(["mutex", "semaphore"]);
    expect(getFenceType("mutex").lockBand).toEqual([1, 1]);
    expect(getFenceType("semaphore").lockBand).toEqual([2, MAX_SIMULTANEOUS_LOCK]);
  });

  it("both still pay in build speed like every other special", () => {
    for (const id of ["mutex", "semaphore"]) {
      expect(getFenceType(id).buildSpeed, `${id} builds at standard speed`).toBeLessThan(1);
    }
    // And the riskier one pays more for it: Semaphore's cut is longer exposed.
    expect(getFenceType("semaphore").buildSpeed)
      .toBeLessThan(getFenceType("mutex").buildSpeed);
  });

  it("leaves every other type unbanded, so nothing else changed", () => {
    for (const id of ["standard", "ice", "flare", "tripwire", "redeploy", "drill", "breakpoint"]) {
      expect(lockBandOf(id), `${id} grew a lock band`).toBeNull();
      expect(bandAllowsLock(id, 1)).toBe(true);
      expect(bandAllowsLock(id, 4)).toBe(true);
    }
    // ...including a cut whose type nothing recorded.
    expect(bandAllowsLock(undefined, 3)).toBe(true);
    expect(bandAllowsLock(null, 0)).toBe(true);
  });
});

describe("the band", () => {
  it("lets Mutex seal one and refuses a crowd", () => {
    expect(bandAllowsLock("mutex", 1)).toBe(true);
    expect(bandAllowsLock("mutex", 2)).toBe(false);
    expect(bandAllowsLock("mutex", 4)).toBe(false);
  });

  it("refuses Semaphore a single ball and takes anything above", () => {
    // The price of the fence: a Semaphore cut that catches one ball has spent a
    // fence and captured nothing.
    expect(bandAllowsLock("semaphore", 1)).toBe(false);
    expect(bandAllowsLock("semaphore", 2)).toBe(true);
    expect(bandAllowsLock("semaphore", 4)).toBe(true);
  });

  it("counts the balls still in play, not the ones already locked", () => {
    const at = (x: number, state = "active"): Ball =>
      ({ position: { x, y: 0 }, state } as unknown as Ball);
    const game = { balls: [at(10), at(20), at(900), at(30, "won")] } as unknown as CanvasGameState;
    // Region A holds two live balls and one already-won; region B holds one.
    const regionOf = (x: number) => ({ id: x < 100 ? "A" : "B" });
    expect(ballsSharingPocket(game, "A", regionOf)).toBe(2);
    expect(ballsSharingPocket(game, "B", regionOf)).toBe(1);
  });
});

describe("the pay table", () => {
  it("gives Mutex a steady drip and Semaphore a jackpot", () => {
    const mutex = getFenceType("mutex");
    const semaphore = getFenceType("semaphore");
    expect(qualifiedHoursFor(mutex, 1, LOCK_VALUE)).toBe(6);
    expect(qualifiedHoursFor(semaphore, 2, LOCK_VALUE)).toBe(24);
    expect(qualifiedHoursFor(semaphore, 3, LOCK_VALUE)).toBe(72);
    expect(qualifiedHoursFor(semaphore, 4, LOCK_VALUE)).toBe(168);
  });

  it("pays Semaphore nothing for the single ball its band already refused", () => {
    expect(qualifiedUnitsFor(getFenceType("semaphore"), 1)).toBe(0);
  });

  it("rises faster than the ball count, which is the point", () => {
    // Each extra ball more than doubles it: two is a bonus, three is a big
    // deal, four nearly doubles the map. A linear table would make the fourth
    // ball feel like the second.
    const s = getFenceType("semaphore");
    const [two, three, four] = [2, 3, 4].map(n => qualifiedUnitsFor(s, n));
    expect(three).toBeGreaterThan(two * 2);
    expect(four).toBeGreaterThan(three * 2);
  });

  it("holds its last value past four rather than extrapolating", () => {
    // maxBalls is 1-4 on every map, so a pass of five means something upstream
    // broke. A bug should cost a wrong number, never an unbounded one.
    //
    // Probed with a table LONGER than the clamp, because the shipped one has
    // exactly four entries - so reading past the end is already caught by the
    // table's own length and this assertion passed with the clamp deleted. The
    // clamp's real job is a table that reaches further than the game does.
    const overlong = { qualifiedByCount: [0, 2, 6, 14, 999] };
    expect(qualifiedUnitsFor(overlong, 4)).toBe(14);
    expect(qualifiedUnitsFor(overlong, 5), "paid a bracket the game cannot reach").toBe(14);
    expect(qualifiedUnitsFor(overlong, 99)).toBe(14);

    const s = getFenceType("semaphore");
    expect(qualifiedUnitsFor(s, 5)).toBe(qualifiedUnitsFor(s, 4));
  });

  it("pays nothing for a type with no table, or for no balls", () => {
    expect(qualifiedUnitsFor(getFenceType("standard"), 4)).toBe(0);
    expect(qualifiedUnitsFor(getFenceType("semaphore"), 0)).toBe(0);
  });
});

describe("the money really does escape the cap", () => {
  /**
   * Scored with a `flatBonus` far past the backstop, so the clamp is BINDING.
   *
   * The first version of this test scored an ordinary map, where nothing was
   * near the ceiling - so moving the qualified hours inside the clamp changed
   * nothing and the mutation survived. A test of "this escapes the cap" has to
   * be run against a score the cap is actually holding down.
   */
  const score = (qualified: number, flatBonus = 100_000) => calculateScore(
    2, 6, 5, 40, 20,
    { locks: { lockedCapacity: 0, totalCapacity: 10, premiumEarned: 0, premiumAvailable: 10 },
      engagement: null, flatBonus, qualifiedOvertime: qualified },
  );

  it("adds it ON TOP of the backstop, which nothing else does", () => {
    const pinned = score(0).levelScore;
    // Everything else is already clamped: another 10k of flat bonus buys zero.
    expect(score(0, 200_000).levelScore, "the clamp is not binding in this fixture")
      .toBe(pinned);
    // Qualified overtime is the one thing that still gets through.
    expect(score(168).levelScore - pinned).toBe(168);
  });

  it("reports what it paid, because an unseen uncapped number is a mystery", () => {
    expect(score(72).qualifiedOvertime).toBe(72);
    expect(score(0).qualifiedOvertime).toBe(0);
  });

  it("ignores a negative or nonsense figure rather than subtracting it", () => {
    expect(score(-50).levelScore).toBe(score(0).levelScore);
    expect(score(Number.NaN).levelScore).toBe(score(0).levelScore);
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("judges the band with the cut that SEALED the pocket", () => {
    // Not the walls bounding it: a pocket is usually closed by board edges,
    // obstacles and old fences, and a rule read off the boundary would depend
    // on geometry the player was not thinking about.
    const src = read("src/lib/physics/applyCut.ts");
    expect(src).toMatch(/wall\.fenceTypeId \?\? STANDARD_FENCE_ID,\n\s*\);/);
  });

  it("keys the pay to the real ball count, never the multiplier", () => {
    // Chain Reaction inflates simultaneousMultiplier. Reading that would let a
    // set bonus push a three-ball pass into the four-ball bracket for free.
    const src = read("src/lib/physics/checkBallWonState.ts");
    expect(src).toMatch(/qualifiedHoursFor\(\s*getFenceType\(sealingFenceTypeId\), newlyLocked, lockValue\)/);
    expect(src, "the pay is keyed to the inflated multiplier")
      .not.toMatch(/qualifiedHoursFor\([^)]*simultaneousMultiplier/);
  });

  it("resets the bank with the rest of the per-map state", () => {
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/game\.qualifiedOvertime = 0/);
  });
});

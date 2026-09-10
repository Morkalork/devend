/**
 * `splitLocks`: the win clause that asks WHERE a ball was sealed.
 *
 * Added because maps 2 to 4 played the same however different they looked.
 * Every other lock clause counts balls, so on a two-ball map "lock 2" is
 * satisfied by whichever pocket is convenient, twice, and the furniture an
 * author adds does not change the decision the player is making. This one
 * cannot be paid twice from the same half of the board.
 */
import { describe, it, expect } from "vitest";
import {
  createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { LADDER } from "@/test/fixtures/maps";
import { resolveWinSpec, isWinMet, evaluateWinCondition, winSpecProblems } from "@/lib/winSpec";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { WinSnapshot } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockedBySide: { left: 0, right: 0 },
  delivered: 0, smashed: 0, terminals: 0, harvested: 0,
  bossDefeated: false, allLocked: false, cuts: 0, par: 4, activeSeconds: 0,
  ...over,
});

const CLAUSE = { kind: "splitLocks", count: 1 } as const;

describe("splitLocks counts sides, not balls", () => {
  it("is unmet with nothing locked", () => {
    expect(evaluateWinCondition(CLAUSE, snap())).toMatchObject({ current: 0, target: 2, met: false });
  });

  it("reads one of two once either half has paid", () => {
    for (const side of [{ left: 1, right: 0 }, { left: 0, right: 1 }]) {
      expect(evaluateWinCondition(CLAUSE, snap({ lockedBySide: side })))
        .toMatchObject({ current: 1, target: 2, met: false });
    }
  });

  it("does NOT advance when the second lock lands on the side already paid", () => {
    // The whole point of the clause. A ball tally would call this 2 of 2 and
    // report a map as winnable that can no longer be won.
    expect(evaluateWinCondition(CLAUSE, snap({ lockedBySide: { left: 2, right: 0 } })))
      .toMatchObject({ current: 1, target: 2, met: false });
  });

  it("is met with one on each side", () => {
    expect(evaluateWinCondition(CLAUSE, snap({ lockedBySide: { left: 1, right: 1 } })))
      .toMatchObject({ current: 2, target: 2, met: true });
  });

  it("takes its count as a per-side figure", () => {
    const two = { kind: "splitLocks", count: 2 } as const;
    expect(evaluateWinCondition(two, snap({ lockedBySide: { left: 2, right: 1 } })).met).toBe(false);
    expect(evaluateWinCondition(two, snap({ lockedBySide: { left: 2, right: 2 } })).met).toBe(true);
  });
});

describe("splitLocks is checked against the map that asks for it", () => {
  const level = (maxBalls: number): LevelConfig => ({
    id: "l", level: 2, sizeThreshold: 20, expectedCuts: 4, points: 20,
    balls: [], maxBalls,
  } as LevelConfig);
  const spec = (count: number) =>
    ({ require: [{ kind: "splitLocks", count } as const], alsoWinIf: [], authored: true });

  it("flags a map that cannot spawn both sides' worth", () => {
    expect(winSpecProblems(spec(1), level(1)).join(" ")).toMatch(/needing 2 balls/);
    expect(winSpecProblems(spec(2), level(2)).join(" ")).toMatch(/needing 4 balls/);
  });

  it("passes a map that can", () => {
    expect(winSpecProblems(spec(1), level(2))).toEqual([]);
    expect(winSpecProblems(spec(2), level(4))).toEqual([]);
  });
});

describe("level 2 asks for it", () => {
  const level = LADDER.find(l => l.id === "level-2")!;

  it("authors the clause instead of a plain lock count", () => {
    const spec = resolveWinSpec(level);
    expect(spec.authored).toBe(true);
    expect(spec.require.map(c => c.kind).sort()).toEqual(["space", "splitLocks"]);
    // Not kept alongside `locks`, which on a two-ball map would say the same
    // thing twice and put two rows in the goal list for one requirement.
    expect(spec.require.some(c => c.kind === "locks")).toBe(false);
  });

  it("is a map the clause can actually be satisfied on", () => {
    expect(winSpecProblems(resolveWinSpec(level), level)).toEqual([]);
  });
});

describe("the runtime credits a lock to the half it happened in", () => {
  /**
   * Played through the real physics rather than asserted on a snapshot: the
   * side tally is written in checkBallWonState from the ball's position at the
   * moment its pocket closes, and a unit test of the evaluator would pass
   * whatever that code did.
   */
  function playLevel2(park: { a: { x: number; y: number }; b: { x: number; y: number } }) {
    const level = LADDER.find(l => l.id === "level-2")!;
    const ctx = createBotGame(level, 2, plainModifiers());
    const g = ctx.game as never as {
      balls: { position: { x: number; y: number }; velocity: { x: number; y: number };
               speed: number; state: string }[];
      levelComplete: boolean; gameOver: boolean;
    };
    for (let i = 0; i < 30; i++) stepBot(ctx);
    g.balls[0].position = { ...park.a };
    g.balls[1].position = { ...park.b };
    for (const b of g.balls) { b.velocity = { x: 4, y: 3 }; b.speed = 5; }

    const settle = () => { for (let i = 0; i < 500; i++) stepBot(ctx); };
    // Seal whichever ball is parked in the left half first, then chase the
    // other down: it roams, so fixed coordinates go stale after one cut.
    tryCut(ctx, { x: 250, y: 500 }, { x: 0, y: 1 });
    settle();
    for (let n = 0; n < 12 && !g.levelComplete && !g.gameOver; n++) {
      const ball = g.balls.find(x => x.state === "active");
      if (!ball) break;
      const vertical = n % 2 === 0;
      const ox = vertical ? (ball.position.x > 650 ? -150 : 150) : 0;
      const oy = vertical ? 0 : (ball.position.y > 450 ? -150 : 150);
      tryCut(ctx, { x: ball.position.x + ox, y: ball.position.y + oy },
             { x: vertical ? 0 : 1, y: vertical ? 1 : 0 });
      settle();
    }
    return { ctx, level, snapshot: readWinSnapshot(ctx.game, level) };
  }

  it("wins level 2 when the two balls are sealed in opposite halves", () => {
    installClock();
    const { level, snapshot } = playLevel2({ a: { x: 120, y: 780 }, b: { x: 780, y: 120 } });
    releaseClock();
    expect(snapshot.lockedBySide.left).toBeGreaterThan(0);
    expect(snapshot.lockedBySide.right).toBeGreaterThan(0);
    expect(snapshot.lockedBySide.left + snapshot.lockedBySide.right).toBe(snapshot.lockedBalls);
    expect(isWinMet(resolveWinSpec(level), snapshot)).toBe(true);
  });

  it("credits by the board midline, so the tally can only ever be a real split", () => {
    installClock();
    const { snapshot } = playLevel2({ a: { x: 120, y: 780 }, b: { x: 780, y: 120 } });
    releaseClock();
    // Nothing here asserts WHICH side each ball took - the balls move and the
    // chase is adaptive - only that the halves are the board's own and that
    // every lock landed in exactly one of them.
    expect(BOARD_WIDTH / 2).toBe(450);
    expect(snapshot.lockedBySide.left + snapshot.lockedBySide.right)
      .toBe(snapshot.lockedBalls);
  });
});

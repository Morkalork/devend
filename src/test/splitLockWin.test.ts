/**
 * `splitLocks`: the win clause that asks WHERE a ball was sealed.
 *
 * Added because maps 2 to 4 played the same however different they looked.
 * Every other lock clause counts balls, so on a two-ball map "lock 2" is
 * satisfied by whichever pocket is convenient, twice, and the furniture an
 * author adds changes the scenery around that decision without changing the
 * decision. This one cannot be paid twice from the same side.
 *
 * The clause is deliberately not about level 2, which is merely the first map
 * to ask for it: the dividing line is the map's to choose, in axis and in
 * position, and the tests below are mostly about that rather than about the
 * ladder.
 */
import { describe, it, expect } from "vitest";
import {
  createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { LADDER } from "@/test/fixtures/maps";
import {
  resolveWinSpec, isWinMet, evaluateWinCondition, winSpecProblems,
  splitLine, splitLockCounts,
} from "@/lib/winSpec";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { WinCondition, WinSnapshot } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [],
  delivered: 0, smashed: 0, terminals: 0, harvested: 0,
  bossDefeated: false, allLocked: false, cuts: 0, par: 4, activeSeconds: 0,
  ...over,
});

type Split = Extract<WinCondition, { kind: "splitLocks" }>;
const clause = (over: Partial<Split> = {}): Split =>
  ({ kind: "splitLocks", count: 1, ...over });

const at = (x: number, y: number) => ({ x, y });
const progress = (c: Split, points: { x: number; y: number }[]) =>
  evaluateWinCondition(c, snap({ lockPoints: points }));

describe("splitLocks counts sides, not balls", () => {
  it("is unmet with nothing locked", () => {
    expect(progress(clause(), [])).toMatchObject({ current: 0, target: 2, met: false });
  });

  it("reads one of two once either side has paid", () => {
    expect(progress(clause(), [at(100, 400)])).toMatchObject({ current: 1, met: false });
    expect(progress(clause(), [at(800, 400)])).toMatchObject({ current: 1, met: false });
  });

  it("does NOT advance when the second lock lands on the side already paid", () => {
    // The whole point of the clause. A ball tally would call this 2 of 2 and
    // report a map as winnable that can no longer be won.
    expect(progress(clause(), [at(100, 400), at(200, 700)]))
      .toMatchObject({ current: 1, target: 2, met: false });
  });

  it("is met with one on each side", () => {
    expect(progress(clause(), [at(100, 400), at(800, 400)]))
      .toMatchObject({ current: 2, target: 2, met: true });
  });

  it("takes its count as a per-side figure", () => {
    const two = clause({ count: 2 });
    expect(progress(two, [at(100, 1), at(200, 1), at(800, 1)]).met).toBe(false);
    expect(progress(two, [at(100, 1), at(200, 1), at(800, 1), at(700, 1)]).met).toBe(true);
  });
});

describe("the dividing line belongs to the map", () => {
  it("defaults to the board's own centre on the chosen axis", () => {
    expect(splitLine(clause())).toBe(BOARD_WIDTH / 2);
    expect(splitLine(clause({ axis: "vertical" }))).toBe(BOARD_WIDTH / 2);
    expect(splitLine(clause({ axis: "horizontal" }))).toBe(BOARD_HEIGHT / 2);
  });

  it("divides top from bottom on the horizontal axis", () => {
    const h = clause({ axis: "horizontal" });
    // The same two points that are a split left-to-right are NOT one
    // top-to-bottom, which is the whole reason the axis is a parameter.
    const sameRow = [at(100, 400), at(800, 400)];
    expect(progress(clause(), sameRow).met).toBe(true);
    expect(progress(h, sameRow).met).toBe(false);
    expect(progress(h, [at(400, 100), at(400, 800)]).met).toBe(true);
  });

  it("honours an off-centre line", () => {
    // Two locks either side of x = 450, but both left of a line at 700.
    const points = [at(300, 400), at(600, 400)];
    expect(progress(clause(), points).met).toBe(true);
    expect(progress(clause({ at: 700 }), points).met).toBe(false);
    expect(progress(clause({ at: 700 }), [at(300, 400), at(800, 400)]).met).toBe(true);
  });

  it("puts a lock exactly on the line on one side only, and always the same one", () => {
    const [before, after] = splitLockCounts(clause(), [at(BOARD_WIDTH / 2, 400)]);
    expect(before + after).toBe(1);
    expect(after).toBe(1);
  });

  it("divides every recorded lock and invents none", () => {
    const points = [at(10, 10), at(450, 450), at(880, 880), at(200, 700)];
    for (const c of [clause(), clause({ axis: "horizontal" }), clause({ at: 120 })]) {
      const [a, b] = splitLockCounts(c, points);
      expect(a + b).toBe(points.length);
    }
  });
});

describe("splitLocks is checked against the map that asks for it", () => {
  const level = (over: Partial<LevelConfig> = {}): LevelConfig => ({
    id: "l", level: 2, sizeThreshold: 20, expectedCuts: 4, points: 20,
    balls: [], maxBalls: 2, ...over,
  } as LevelConfig);
  const spec = (c: Split) => ({ require: [c], alsoWinIf: [], authored: true });
  const problems = (c: Split, over: Partial<LevelConfig> = {}) =>
    winSpecProblems(spec(c), level(over)).join(" ");

  it("flags a map that cannot spawn both sides' worth", () => {
    expect(problems(clause(), { maxBalls: 1 })).toMatch(/needing 2 balls/);
    expect(problems(clause({ count: 2 }))).toMatch(/needing 4 balls/);
  });

  it("flags a line outside the play area, where every lock lands on one side", () => {
    expect(problems(clause({ at: 10 }))).toMatch(/outside the play area/);
    expect(problems(clause({ at: BOARD_WIDTH - 10 }))).toMatch(/outside the play area/);
    // And it measures the RIGHT axis: 700 is a fine x and a fine y here, but a
    // line only makes sense against the span it divides.
    expect(problems(clause({ axis: "horizontal", at: 890 }))).toMatch(/outside the play area/);
  });

  it("passes a sane clause on a map that can pay it", () => {
    expect(winSpecProblems(spec(clause()), level())).toEqual([]);
    expect(winSpecProblems(spec(clause({ axis: "horizontal" })), level())).toEqual([]);
    expect(winSpecProblems(spec(clause({ at: 300 })), level())).toEqual([]);
    expect(winSpecProblems(spec(clause({ count: 2 })), level({ maxBalls: 4 }))).toEqual([]);
  });
});

describe("level 2, the first map to ask for it", () => {
  const level = LADDER.find(l => l.id === "level-2")!;

  it("authors the clause instead of a plain lock count", () => {
    const spec = resolveWinSpec(level);
    expect(spec.authored).toBe(true);
    expect(spec.require.map(c => c.kind).sort()).toEqual(["space", "splitLocks"]);
    // Not kept alongside `locks`, which on a two-ball map would say the same
    // thing twice and put two rows in the goal list for one requirement.
    expect(spec.require.some(c => c.kind === "locks")).toBe(false);
  });

  it("leans on the default line rather than restating it", () => {
    const c = resolveWinSpec(level).require.find(x => x.kind === "splitLocks") as Split;
    expect(c.axis).toBeUndefined();
    expect(c.at).toBeUndefined();
    // Because the map's own divider is already there: the jamb column at
    // x = 437 is 26 wide, so its centre is the board midline.
    const jamb = (level.entities ?? []).find(e => e.id === "jamb-top");
    expect(jamb, "level 2 should still have the jamb this clause divides at").toBeDefined();
    const rect = jamb as { x: number; width: number };
    expect(rect.x + rect.width / 2).toBe(splitLine(c));
  });

  it("is a map the clause can actually be satisfied on", () => {
    expect(winSpecProblems(resolveWinSpec(level), level)).toEqual([]);
  });
});

describe("the runtime records where a lock happened", () => {
  /**
   * Played through the real physics rather than asserted on a snapshot: the
   * lock point is written in checkBallWonState from the ball's position at the
   * moment its pocket closes, and a unit test of the evaluator would pass
   * whatever that code did.
   */
  function playLevel2() {
    const level = LADDER.find(l => l.id === "level-2")!;
    const ctx = createBotGame(level, 2, plainModifiers());
    const g = ctx.game as never as {
      balls: { position: { x: number; y: number }; velocity: { x: number; y: number };
               speed: number; state: string }[];
      levelComplete: boolean; gameOver: boolean;
    };
    for (let i = 0; i < 30; i++) stepBot(ctx);
    g.balls[0].position = { x: 120, y: 780 };   // parked left
    g.balls[1].position = { x: 780, y: 120 };   // parked right
    for (const b of g.balls) { b.velocity = { x: 4, y: 3 }; b.speed = 5; }

    const settle = () => { for (let i = 0; i < 500; i++) stepBot(ctx); };
    tryCut(ctx, { x: 250, y: 500 }, { x: 0, y: 1 });
    settle();
    // The surviving ball roams, so chase it: fixed coordinates go stale after
    // one cut captures the space they were aimed at.
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
    return { level, snapshot: readWinSnapshot(ctx.game, level) };
  }

  it("wins level 2 when the two balls are sealed in opposite halves", () => {
    installClock();
    const { level, snapshot } = playLevel2();
    releaseClock();
    expect(snapshot.lockPoints).toHaveLength(snapshot.lockedBalls);
    expect(snapshot.lockedBalls).toBe(2);
    const [left, right] = splitLockCounts(clause(), snapshot.lockPoints);
    expect(left).toBe(1);
    expect(right).toBe(1);
    expect(isWinMet(resolveWinSpec(level), snapshot)).toBe(true);
  });

  it("records a point per lock, inside the board, and no more", () => {
    installClock();
    const { snapshot } = playLevel2();
    releaseClock();
    // One entry per locked ball: the list is what every position question is
    // answered from, so a missing or duplicated entry is a silently wrong win.
    expect(snapshot.lockPoints).toHaveLength(snapshot.lockedBalls);
    for (const p of snapshot.lockPoints) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(BOARD_WIDTH);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(BOARD_HEIGHT);
    }
  });
});

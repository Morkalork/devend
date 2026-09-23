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
  splitLine, splitAxis, dealtSplit, splitLockCounts, NO_RUN_RULES } from "@/lib/winSpec";
import { rotatePoint, rotateSplitLine, ROTATION_MIN_LEVEL, type MapRotation } from "@/lib/mapRotation";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { WinCondition, WinSnapshot } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";
import { noSmashes } from "@/lib/destructibleClass";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [], mapRotation: 0,
  delivered: 0, smashed: noSmashes(), terminals: 0, harvested: 0,
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
    const spec = resolveWinSpec(level, NO_RUN_RULES);
    expect(spec.authored).toBe(true);
    expect(spec.require.map(c => c.kind).sort()).toEqual(["space", "splitLocks"]);
    // Not kept alongside `locks`, which on a two-ball map would say the same
    // thing twice and put two rows in the goal list for one requirement.
    expect(spec.require.some(c => c.kind === "locks")).toBe(false);
  });

  it("leans on the default line rather than restating it", () => {
    const c = resolveWinSpec(level, NO_RUN_RULES).require.find(x => x.kind === "splitLocks") as Split;
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
    expect(winSpecProblems(resolveWinSpec(level, NO_RUN_RULES), level)).toEqual([]);
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
    expect(isWinMet(resolveWinSpec(level, NO_RUN_RULES), snapshot)).toBe(true);
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

describe("the line turns with the board", () => {
  /**
   * Why this clause shipped on one map and could not leave it.
   *
   * From level 4 up a map is dealt in one of four rotations and initGame turns
   * all of its geometry into that deal. A win clause is not geometry, so
   * nothing turned it - and this is the one clause that names a PLACE. Two
   * deals in four put a map's vertical divider on the horizontal, while the
   * clause went on splitting left from right: a rule the player could only
   * learn by losing, on every map above the tutorial band.
   */
  const ROTATIONS: MapRotation[] = [0, 1, 2, 3];

  it("puts the turned line exactly where the turned points are", () => {
    // The property, rather than four hand-copied cases: a point ON the authored
    // line must land ON the dealt line, whichever way the board went.
    for (const r of ROTATIONS) {
      for (const axis of ["vertical", "horizontal"] as const) {
        const AT = 437;
        const dealt = rotateSplitLine(axis, AT, r);
        for (const t of [0, 120, 450, 830, 900]) {
          const p = axis === "vertical" ? { x: AT, y: t } : { x: t, y: AT };
          const q = rotatePoint(p.x, p.y, r);
          const along = dealt.axis === "vertical" ? q.x : q.y;
          expect(along, `${axis}@${AT} under rotation ${r}`).toBeCloseTo(dealt.at, 6);
        }
      }
    }
  });

  it("swaps the axis on a quarter turn and keeps it on a half", () => {
    expect(rotateSplitLine("vertical", 450, 0)).toEqual({ axis: "vertical", at: 450 });
    expect(rotateSplitLine("vertical", 450, 2)).toEqual({ axis: "vertical", at: 450 });
    expect(rotateSplitLine("vertical", 450, 1).axis).toBe("horizontal");
    expect(rotateSplitLine("vertical", 450, 3).axis).toBe("horizontal");
    // ... and a quarter turn twice is the half turn.
    const once = rotateSplitLine("vertical", 300, 1);
    expect(rotateSplitLine(once.axis, once.at, 1)).toEqual(rotateSplitLine("vertical", 300, 2));
  });

  it("keeps two locks apart in every deal, as the authored board had them", () => {
    const c = clause();                       // vertical, at the board centre
    // One ball in each authored half, carried into each deal with the board.
    for (const r of ROTATIONS) {
      const points = [rotatePoint(150, 200, r), rotatePoint(750, 200, r)];
      // Which side is WHICH is deliberately not tracked - a deal can swap left
      // and right, and both sides of the clause owe the same count, so a
      // "near/far" that flipped per deal would be a distinction with nothing
      // behind it. What must survive every deal is that they are apart.
      expect(splitLockCounts(c, points, r).sort(), `rotation ${r}`).toEqual([1, 1]);
      expect(evaluateWinCondition(c, snap({ lockPoints: points, mapRotation: r })).met,
        `rotation ${r} did not read as both sides paid`).toBe(true);
    }
  });

  it("reads two locks in ONE authored half as one side, in every deal", () => {
    const c = clause();
    for (const r of ROTATIONS) {
      const points = [rotatePoint(150, 200, r), rotatePoint(150, 700, r)];
      expect(splitLockCounts(c, points, r).sort(), `rotation ${r}`).toEqual([0, 2]);
      expect(evaluateWinCondition(c, snap({ lockPoints: points, mapRotation: r })).met,
        `rotation ${r} let one side be paid twice`).toBe(false);
    }
  });

  it("is unsatisfiable on a turned board when the line is not turned", () => {
    // The bug, stated as a test: one lock in each authored half, read against
    // the authored line on a quarter-turned deal, both land on the same side.
    const c = clause();
    const left = rotatePoint(150, 200, 1);
    const right = rotatePoint(750, 200, 1);
    expect(splitLockCounts(c, [left, right], 0)).toEqual([2, 0]);  // read raw: both "before"
    expect(splitLockCounts(c, [left, right], 1)).toEqual([1, 1]);  // read as dealt: one each
  });

  it("leaves the map's own words alone", () => {
    // splitLine and splitAxis answer what the MAP says, for the authoring
    // tools, which have no deal to read. Only dealtSplit knows about a deal.
    const c = clause({ axis: "horizontal", at: 300 });
    expect(splitLine(c)).toBe(300);
    expect(splitAxis(c)).toBe("horizontal");
    expect(dealtSplit(c, 0)).toEqual({ axis: "horizontal", at: 300 });
    expect(dealtSplit(c, 1)).toEqual({ axis: "vertical", at: 300 });
  });

  it("refuses a horizontal split on a map that turns", () => {
    // Not a restriction on the geometry - dealtSplit handles either axis - but
    // on the WORDING, which is written before any deal exists. "Lock a ball on
    // each side" is true of a board split either way; "top and bottom" is true
    // of one deal in two.
    const turning = {
      id: "l", level: ROTATION_MIN_LEVEL, sizeThreshold: 20, expectedCuts: 4,
      points: 20, balls: [], maxBalls: 2,
    } as unknown as LevelConfig;
    const spec = { require: [clause({ axis: "horizontal" })], alsoWinIf: [], authored: true };
    expect(winSpecProblems(spec, turning).join(" ")).toContain("never turns");
    // Allowed where it can be read: the tutorial band, and anything pinned.
    expect(winSpecProblems(spec, { ...turning, level: 2 } as LevelConfig)).toEqual([]);
    expect(winSpecProblems(spec, { ...turning, neverRotates: true } as LevelConfig)).toEqual([]);
    // The default axis is fine anywhere.
    expect(winSpecProblems(
      { require: [clause()], alsoWinIf: [], authored: true }, turning)).toEqual([]);
  });
});

describe("the three maps that ask it", () => {
  /**
   * One per act-and-a-bit, and each asks the question against a different kind
   * of divider: masonry you can plan around, a doorway somebody else is
   * standing in, and a column that is only there some of the time.
   */
  const MAPS = [
    { id: "level-2", divider: "jamb-top" },
    { id: "level-4", divider: "jamb-top" },
    { id: "level-16", divider: "the-slab" },
  ];

  for (const { id, divider } of MAPS) {
    const lvl = () => LADDER.find(l => l.id === id)!;

    it(`${id} authors the clause, not a plain lock count`, () => {
      const spec = resolveWinSpec(lvl(), NO_RUN_RULES);
      expect(spec.require.some(c => c.kind === "splitLocks")).toBe(true);
      // Never both: on a two-ball map they are the same demand, and on a
      // three-ball one a lock tally beside it is a second row for one idea.
      expect(spec.require.some(c => c.kind === "locks")).toBe(false);
    });

    it(`${id} splits where its own divider stands`, () => {
      // The clause's own rule: the line goes where the map is visibly divided,
      // or it is a rule nobody can see.
      const c = resolveWinSpec(lvl(), NO_RUN_RULES)
        .require.find(x => x.kind === "splitLocks") as Split;
      const d = (lvl().entities ?? []).find(e => e.id === divider) as { x: number; width: number };
      expect(d, `${id} should still have the divider this clause splits at`).toBeDefined();
      expect(Math.abs((d.x + d.width / 2) - splitLine(c)))
        .toBeLessThanOrEqual(1);
    });

    it(`${id} is a map the clause can be satisfied on`, () => {
      expect(winSpecProblems(resolveWinSpec(lvl(), NO_RUN_RULES), lvl())).toEqual([]);
    });
  }

  it("spends the clause across the ladder rather than on one map", () => {
    // The reason this went from one map to three: a mechanic that appears once
    // is a mechanic nobody learns. One in the tutorial band, one later in it,
    // one in act II.
    const carriers = LADDER
      .filter(l => resolveWinSpec(l, NO_RUN_RULES).require.some(c => c.kind === "splitLocks"))
      .map(l => l.level)
      .sort((a, b) => a - b);
    expect(carriers).toEqual([2, 4, 16]);
  });
});

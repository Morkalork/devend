/**
 * Act IV: Crunch (31-35), rebuilt. The budget: every cut is priced.
 *
 * The old act IV was the ladder's one real regression, and a measured one. It
 * sat at 70-72% clear with 4-5 cuts while act III asked for 86-93% and 9, so
 * level 31 demanded LESS of the player than level 4 did. The act-wide rules
 * below are the ones that regression wrote; they held the old maps and they
 * hold the new ones.
 *
 * What the rebuilt act adds is family D's last three rules, each priced: the
 * thread lock (31 and 34: the win counts sealed balls, not just ground), the
 * WIP limit (32 and 34: a fixed number of fences) and the ball gate (33: a wall
 * only one ball may cross). Each landed on an older mechanic's second map, and
 * the pins further down hold the structure each map is built on, because every
 * one of them fails silently when it drifts.
 */
import { describe, it, expect } from "vitest";
import { resolveWinSpec, winSpecProblems, NO_RUN_RULES } from "@/lib/winSpec";
import type { LevelConfig, WallEntity } from "@/types/level";

import { LADDER } from "./fixtures/maps";

const at = (n: number) => LADDER.find(l => l.level === n)!;
const ACT_IV = [31, 32, 33, 34, 35].map(at);
const PLAYABLE = ACT_IV.filter(l => !l.boss);
const entity = (l: LevelConfig, id: string) =>
  (l.entities ?? []).find(e => e.id === id) as (WallEntity & { x: number; y: number; width: number; height: number }) | undefined;

describe("the act exists and is the right shape", () => {
  it("has all five maps, closed by a boss", () => {
    for (const l of ACT_IV) expect(l, "a map is missing").toBeTruthy();
    expect(at(35).boss, "35 closes the act").toBeTruthy();
  });

  /** The regression, stated as a number: the old 31 asked for less than 4 did. */
  it("asks more of the player than act I", () => {
    const clear = (l: LevelConfig) => 100 - l.sizeThreshold;
    for (const l of PLAYABLE) {
      expect(clear(l), `level ${l.level}`).toBeGreaterThan(clear(at(4)));
    }
  });

  it("sits above act III's peak, which it follows", () => {
    const clear = (l: LevelConfig) => 100 - l.sizeThreshold;
    const actIIIPeak = Math.max(...[21, 22, 23, 24, 25, 26, 27, 28, 29].map(n => clear(at(n))));
    // Only the LAST playable map has to beat the previous act outright; the
    // first is the post-boss breather and may sit a point under the peak.
    expect(clear(at(34))).toBeGreaterThan(actIIIPeak);
    expect(clear(at(31))).toBeGreaterThanOrEqual(actIIIPeak - 1);
  });

  it("does not collapse its cut count the way the old act did", () => {
    // 9 cuts at level 19 and then 4 at 31-33 was the shape of the collapse.
    for (const l of PLAYABLE) expect(l.expectedCuts, `level ${l.level}`).toBeGreaterThanOrEqual(9);
  });
});

describe("the win conditions it states", () => {
  it("authors a win on every playable map", () => {
    for (const l of PLAYABLE) {
      expect(resolveWinSpec(l, NO_RUN_RULES).authored, `level ${l.level}`).toBe(true);
    }
  });

  it("flags none of them as unwinnable", () => {
    for (const l of ACT_IV) {
      expect(winSpecProblems(resolveWinSpec(l, NO_RUN_RULES), l), `level ${l.level}`).toEqual([]);
    }
  });

  it("still requires the clear on every playable map", () => {
    // The old 34 dropped it and became a map finished without clearing much
    // board. Every ask in this act is a second thing to do while clearing.
    for (const l of PLAYABLE) {
      expect(resolveWinSpec(l, NO_RUN_RULES).require.some(c => c.kind === "space"), `level ${l.level}`).toBe(true);
    }
  });

  /**
   * No all-locked back door. Sealing every ball writes the rest of the board
   * off as unreachable, so the alternative is not "seal everything at 5%
   * remaining", it is "seal everything, whenever": on 33 that walks round the
   * gate, and on 32 round the plug.
   */
  it("gives no map in the act an all-locked back door", () => {
    for (const l of PLAYABLE) {
      expect(resolveWinSpec(l, NO_RUN_RULES).alsoWinIf, `level ${l.level}`).toEqual([]);
    }
  });
});

describe("what the act charges for its asks", () => {
  const premiums = PLAYABLE.flatMap(l =>
    resolveWinSpec(l, NO_RUN_RULES).require.map(c => ({ level: l.level, kind: c.kind, pct: c.bonusPercent ?? 0 })));

  it("prices every extra ask, and never the clear", () => {
    const extra = premiums.filter(p => p.kind !== "space");
    expect(extra.length).toBeGreaterThanOrEqual(4);
    for (const p of extra) expect(p.pct, `level ${p.level} ${p.kind} is free`).toBeGreaterThan(0);
    expect(premiums.filter(p => p.kind === "space").every(p => p.pct === 0)).toBe(true);
  });

  it("keeps every premium inside what the economy is tuned for", () => {
    for (const p of premiums) expect(p.pct, `level ${p.level} ${p.kind}`).toBeLessThanOrEqual(50);
  });
});

/**
 * How busy the act is, which the Lamp (src/lib/lampBall.ts) makes a rule: one
 * ball at a time lights the board and sealing it pays a premium, and on a
 * two-ball map "another ball is picked" means the other one, a coin flip
 * rather than a choice.
 */
describe("act IV is busy enough for the Lamp to be a choice", () => {
  it("gives every playable map three balls or more", () => {
    for (const l of PLAYABLE) expect(l.maxBalls ?? 1, l.id).toBeGreaterThanOrEqual(3);
  });

  it("leaves the boss map alone", () => {
    expect(at(35).maxBalls).toBe(1);
  });

  it("pins every roster, so the gate's ball is always dealt", () => {
    for (const l of PLAYABLE) {
      expect(l.ballTypeIds, `${l.id} rolls its balls`).toBeTruthy();
      expect(l.ballTypeIds!.length, `${l.id} roster vs count`).toBe(l.maxBalls);
    }
  });
});

describe("31 drains into the ward", () => {
  const l = at(31);

  it("has a membrane in a wall that otherwise divides the board", () => {
    const m = entity(l, "membrane")!;
    expect(m.oneWay).toBe("left");
    const top = entity(l, "divider-top")!, bottom = entity(l, "divider-bottom")!;
    // Top, membrane and bottom meet end to end: the only way left is through it.
    expect(top.y + top.height).toBe(m.y);
    expect(m.y + m.height).toBe(bottom.y);
    expect(top.y).toBe(45);
    expect(bottom.y + bottom.height).toBe(855);
  });

  it("drains toward the narrow side, so the intake holds the spawn", () => {
    // Balls spawn round the board's centre (initGame), so the side holding the
    // centre is the side that starts full. Drained the other way, every ball
    // started in the ward and the intake was empty before the first cut.
    const m = entity(l, "membrane")!;
    expect(m.x + m.width).toBeLessThan(450);
  });

  it("is the thread-lock map: two locks on top of the clear", () => {
    const locks = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "locks");
    expect(locks?.kind === "locks" && locks.count).toBe(2);
  });
});

describe("32 prices the vault in fences", () => {
  const l = at(32);

  it("has a budget above its par, and a plug in its win", () => {
    expect(l.fenceBudget ?? 0).toBeGreaterThan(l.expectedCuts);
    const smash = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "smashed");
    expect(smash?.kind === "smashed" && smash.of).toBe("monoliths");
  });

  it("seals the vault behind the plug, and the fuse blows that plug", () => {
    const plug = entity(l, "plug")!;
    expect(plug.reveals, "the vault opens when the plug goes").toBeTruthy();
    expect(plug.hitsToBreak ?? 0, "a plug no ball breaks by hand").toBeGreaterThanOrEqual(30);
    expect(l.charges?.map(c => c.targetId)).toEqual(["plug"]);
  });

  it("opens the vault on its own late, if the player never does", () => {
    // The plug is in the win and there is one of it, so a deadline breaks it:
    // the slack is in time, not in a second plug.
    const beat = (l.beats ?? []).find(b => b.breakId === "plug");
    expect(beat?.atSpaceRemaining).toBeGreaterThan(l.sizeThreshold);
  });
});

describe("33 sorts the balls at the gate", () => {
  const l = at(33);

  it("lets the compass alone through the gate, and deals the compass", () => {
    expect(entity(l, "compass-gate")?.passTypes).toEqual(["compass"]);
    expect(l.ballTypeIds).toContain("compass");
    // Not first: the first ball is the one a player herds by instinct.
    expect(l.ballTypeIds![0]).not.toBe("compass");
  });

  it("joins the upper board to the strip by a portal pair, for everyone else", () => {
    const mouths = (l.entities ?? []).filter(e => (e as WallEntity).portal === "down") as unknown as { cy: number }[];
    expect(mouths).toHaveLength(2);
    const gateY = entity(l, "compass-gate")!.y;
    expect(mouths.some(m => m.cy < gateY) && mouths.some(m => m.cy > gateY)).toBe(true);
  });

  it("puts the box below the gate, where only the gate and the portal lead", () => {
    const box = (l.coloredAreas ?? []).find(a => a.required !== false)!;
    expect(box.y).toBeGreaterThan(entity(l, "compass-gate")!.y);
  });
});

describe("34 lifts the bar at the first lock", () => {
  const l = at(34);

  it("latches the bar open on the first lock", () => {
    const bar = entity(l, "freeze-bar")!;
    expect(bar.latchAfter).toBe(1);
  });

  it("never divides the board with it: both ends stand clear of the frame", () => {
    // A latch that sealed a room would have the room captured as unreachable on
    // the first cut (nothing can get in until the latch goes), so the bar is an
    // anchor and never a wall.
    const bar = entity(l, "freeze-bar")!;
    expect(bar.x - 45).toBeGreaterThanOrEqual(60);
    expect(855 - (bar.x + bar.width)).toBeGreaterThanOrEqual(60);
  });

  it("asks for two locks under a fence budget", () => {
    expect(l.fenceBudget ?? 0).toBeGreaterThan(l.expectedCuts);
    const locks = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "locks");
    expect(locks?.kind === "locks" && locks.count).toBe(2);
  });
});

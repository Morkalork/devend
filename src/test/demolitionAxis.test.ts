/**
 * DEMOLITION: the map's own content, finally worth something.
 *
 * The report this axis answers: "for the first 9 maps you can just do two quick
 * locks and get full score." That was true, and it was not a tuning problem.
 * Smashing a breakable paid a flat 5h into `greedBonus`, and Greed's 25h pot is
 * shared with clearing past the requirement - so on any map where you also
 * cleared, the pot was already full and the hours evaporated. The overlay
 * rendered no row for them either. The map's content was, in the only sense
 * that matters, unpaid and invisible.
 *
 * So the fix is structural rather than a bigger number: demolition gets its own
 * lane, banked against what THIS map put on the board, the way every other axis
 * is banked against what this map could give.
 */
import { describe, it, expect } from "vitest";
import { bankAxes, demolitionRatio, AXIS_NAMES } from "@/lib/scoreAxes";
import { demolitionProgress } from "@/lib/physics/destructibles";
import { getAxisCeilings, DEFAULT_SCORING_CONFIG } from "@/lib/scoring";
import type { DestructibleState } from "@/types/game";

const CEIL = getAxisCeilings(DEFAULT_SCORING_CONFIG);

/** A run that locked everything and did nothing else: the "two quick locks". */
const base = (over: Record<string, number> = {}) => ({
  lockedCapacity: 100, totalCapacity: 100,
  premiumEarned: 0, premiumAvailable: 100,
  usedFences: 6, parFences: 6,
  actualRemovedRatio: 0.8, requiredRemovedRatio: 0.8,
  shipEarlyPercent: 0, shipEarlyMaxPercent: 30,
  thriftFullAtParFraction: CEIL.thriftFullAtParFraction,
  greedFullAtSlackFraction: CEIL.greedFullAtSlackFraction,
  ...over,
});

const brk = (maxHits: number, destroyed: boolean, kind = "breakable") =>
  ({ kind, maxHits, destroyed } as unknown as DestructibleState);

describe("what the axis is scored on", () => {
  it("is the share of the map's breakables actually taken apart", () => {
    expect(demolitionRatio(0, 10)).toBe(0);
    expect(demolitionRatio(5, 10)).toBe(0.5);
    expect(demolitionRatio(10, 10)).toBe(1);
  });

  it("weights by authored hits, so a slab outranks a cover", () => {
    // Counting objects would make a 2-hit chest cover worth as much as a
    // 40-hit slab, and the slab IS the map's demolition.
    const map = [brk(40, false), brk(2, true)];
    const cover = demolitionProgress(map);
    expect(cover.smashedHits / cover.totalSmashableHits).toBeCloseTo(2 / 42, 6);

    const slab = demolitionProgress([brk(40, true), brk(2, false)]);
    expect(slab.smashedHits / slab.totalSmashableHits).toBeCloseTo(40 / 42, 6);
    expect(slab.smashedHits).toBeGreaterThan(cover.smashedHits * 10);
  });

  it("counts breakables only, never mirrors or movers", () => {
    // Both are destructible, and both need the black ball, which unlocks at
    // level 25. Counting them would put a share of the axis behind a roster
    // roll on every earlier map.
    const p = demolitionProgress([brk(3, true), brk(3, false, "mirror"), brk(3, false, "mover")]);
    expect(p.totalSmashableHits).toBe(3);
    expect(p.smashedHits).toBe(3);
  });

  it("survives a game state that has no destructibles at all", () => {
    // The score path must not throw: a throw here loses the finished map.
    expect(demolitionProgress(undefined as never)).toEqual({ smashedHits: 0, totalSmashableHits: 0 });
    expect(demolitionProgress([])).toEqual({ smashedHits: 0, totalSmashableHits: 0 });
  });
});

describe("the lane pays, and cannot be declined", () => {
  it("pays nothing to a run that ignored the map's content", () => {
    const axes = bankAxes(base({ smashedHits: 0, totalSmashableHits: 40 }), CEIL);
    expect(axes.demolition).toBe(0);
  });

  it("pays the whole ceiling to a run that took it all apart", () => {
    const axes = bankAxes(base({ smashedHits: 40, totalSmashableHits: 40 }), CEIL);
    expect(axes.demolition).toBe(CEIL.demolition);
  });

  it("is about 30% of what a realistic run banks", () => {
    // The sizing claim, checked rather than asserted in a comment. A good run
    // banks Delivery, Demolition and about two of the four tactical axes - the
    // ring is built so all four are not reachable together.
    const full = bankAxes(base({
      smashedHits: 40, totalSmashableHits: 40,
      premiumEarned: 100,                       // Craft
      shipEarlyPercent: 30,                     // Tempo
    }), CEIL);
    const share = full.demolition / full.total;
    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.36);
  });

  it("does not scale with how the LOCKING went", () => {
    // Not gated by delivery and not multiplied by the lock payout multiplier:
    // a run that smashed everything and lost a ball still took everything
    // apart. Tempo/Thrift/Greed are gated; this is a baseline like Delivery.
    const lostABall = bankAxes(base({
      lockedCapacity: 50, totalCapacity: 100,
      smashedHits: 40, totalSmashableHits: 40,
    }), CEIL);
    expect(lostABall.demolition).toBe(CEIL.demolition);
  });

  it("makes two quick locks NOT a full score on a map with content", () => {
    // The report, as an assertion. Same run, same locks; the only difference
    // is whether the map's breakables were touched.
    const ignored = bankAxes(base({ smashedHits: 0, totalSmashableHits: 40 }), CEIL);
    const smashed = bankAxes(base({ smashedHits: 40, totalSmashableHits: 40 }), CEIL);
    expect(smashed.total - ignored.total).toBe(CEIL.demolition);
    expect(ignored.total).toBeLessThan(smashed.total * 0.75);
  });
});

describe("a map with nothing to smash does not show the lane", () => {
  it("reports a zero ceiling, which is what the overlay hides on", () => {
    // An empty bar on a map that offered no demolition would read as hours left
    // on the table. There were none, and no play would have banked them.
    const axes = bankAxes(base({ smashedHits: 0, totalSmashableHits: 0 }), CEIL);
    expect(axes.ceilings.demolition).toBe(0);
    expect(axes.demolition).toBe(0);
    // ...while a map that HAS content reports the real ceiling even at zero
    // earned, because those hours were genuinely available and declined.
    const offered = bankAxes(base({ smashedHits: 0, totalSmashableHits: 40 }), CEIL);
    expect(offered.ceilings.demolition).toBe(CEIL.demolition);
  });

  it("leaves every other lane untouched by its presence or absence", () => {
    // The founding rule of the axis economy: maxing one never spends another's
    // headroom. A new lane must not quietly change what the old five pay.
    const without = bankAxes(base({ smashedHits: 0, totalSmashableHits: 0 }), CEIL);
    const with_ = bankAxes(base({ smashedHits: 40, totalSmashableHits: 40 }), CEIL);
    for (const name of AXIS_NAMES) {
      if (name === "demolition") continue;
      expect(with_[name], name).toBe(without[name]);
    }
  });
});

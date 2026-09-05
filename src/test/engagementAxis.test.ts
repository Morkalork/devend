/**
 * ENGAGEMENT: the map's own features, finally worth operating.
 *
 * The report this axis answers: "for the first 9 maps you can just do two quick
 * locks and get full score... there needs to be something more than just
 * locking on each map", and then: "it is not just destructables, it can be
 * coloured areas or whatever causes a different type of play."
 *
 * The five original axes measure how you LOCKED and what the clock and the
 * fences cost you doing it. Not one of them looks at the map. A board with a
 * vault, a marked zone and a wired circuit scored exactly the same as an empty
 * room at equal efficiency, so every mechanic the ladder introduces was, to the
 * scorer, decoration. Breakables did pay - a flat 5h into Greed, whose 25h pot
 * is shared with clearing, so on any map where you also cleared it was already
 * full and they evaporated.
 */
import { describe, it, expect } from "vitest";
import { bankAxes, AXIS_NAMES } from "@/lib/scoreAxes";
import { engagementProgress, breakableProgress } from "@/lib/scoreEngagement";
import { getAxisCeilings, DEFAULT_SCORING_CONFIG } from "@/lib/scoring";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";

const CEIL = getAxisCeilings(DEFAULT_SCORING_CONFIG);

/** A run that locked everything and did nothing else: the "two quick locks". */
const base = (over: Record<string, unknown> = {}) => ({
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
const state = (over: Partial<CanvasGameState> = {}) => over as Partial<CanvasGameState>;

describe("which families a map offers", () => {
  it("counts a family only when the map actually has one", () => {
    // "This map has no circuit" and "you ignored the circuit" are different
    // facts. Averaging the first as a zero would punish a map for what it does
    // not contain.
    const empty = engagementProgress(state({ destructibles: [], coloredAreas: [] }));
    expect(empty.offered).toBe(false);
    expect(empty.families).toEqual([]);
    expect(empty.ratio).toBe(0);
  });

  it("takes breakables, zones, circuits, streams and boxes", () => {
    const p = engagementProgress(state({
      destructibles: [brk(4, true)],
      coloredAreas: [{ kind: "var", x: 0, y: 0, width: 1, height: 1 }] as never,
      zoneLockCount: 1,
      circuit: { terminals: [{ lit: true }, { lit: false }] } as never,
      dataStream: { harvested: [true, false, false, false] } as never,
      deliveryBoxes: [{ delivered: 1 }] as never,
    }));
    expect(p.families.map(f => f.key).sort())
      .toEqual(["boxes", "breakables", "circuit", "stream", "zones"]);
  });

  it("leaves terrain out: a mover or a well is not something you operate", () => {
    // There is no state that says whether you "engaged" with a wall that
    // bounced a ball, so counting them would mean paying for weather.
    const p = engagementProgress(state({
      destructibles: [],
      movers: [{}, {}] as never,
      gravityWells: [{}] as never,
    }));
    expect(p.offered).toBe(false);
  });
});

describe("how a family is scored", () => {
  it("weights breakables by authored hits, so a slab outranks a cover", () => {
    // Counting objects would make a 2-hit chest cover worth as much as a
    // 40-hit slab, and the slab IS the map's demolition.
    const cover = breakableProgress([brk(40, false), brk(2, true)]);
    expect(cover.done / cover.offered).toBeCloseTo(2 / 42, 6);
    const slab = breakableProgress([brk(40, true), brk(2, false)]);
    expect(slab.done / slab.offered).toBeCloseTo(40 / 42, 6);
  });

  it("counts breakables only, never mirrors or movers", () => {
    // Both need the black ball, which unlocks at level 25: counting them would
    // put part of the axis behind a roster roll on every earlier map.
    const p = breakableProgress([brk(3, true), brk(3, false, "mirror"), brk(3, false, "mover")]);
    expect(p.offered).toBe(3);
    expect(p.done).toBe(3);
  });

  it("caps zones per area, so one box cannot be farmed for another", () => {
    const p = engagementProgress(state({
      coloredAreas: [{}, {}] as never, zoneLockCount: 4, destructibles: [],
    }));
    expect(p.families.find(f => f.key === "zones")).toEqual({ key: "zones", done: 2, offered: 2 });
  });

  it("averages families rather than pooling their units", () => {
    // Pooled, level 25's 40-hit slab would be worth thirteen terminals and a
    // map's score would be decided by which mechanic it happened to draw.
    // Everything smashed, nothing wired: half, not 40/43.
    const p = engagementProgress(state({
      destructibles: [brk(40, true)],
      circuit: { terminals: [{ lit: false }, { lit: false }, { lit: false }] } as never,
    }));
    expect(p.ratio).toBeCloseTo(0.5, 6);
  });

  it("survives a game state with nothing on it", () => {
    // The score path must not throw: a throw here loses the finished map.
    expect(() => engagementProgress({})).not.toThrow();
    expect(engagementProgress({}).offered).toBe(false);
    expect(breakableProgress(undefined)).toEqual({ key: "breakables", done: 0, offered: 0 });
  });
});

describe("the lane pays, and cannot be declined", () => {
  it("pays nothing to a run that ignored the map", () => {
    expect(bankAxes(base({ engagementRatio: 0, engagementOffered: true }), CEIL).engagement).toBe(0);
  });

  it("pays the whole ceiling to a run that operated all of it", () => {
    expect(bankAxes(base({ engagementRatio: 1, engagementOffered: true }), CEIL).engagement)
      .toBe(CEIL.engagement);
  });

  it("is about 30% of what a realistic run banks", () => {
    // The sizing claim, checked rather than asserted in a comment. A good run
    // banks Delivery, Engagement and about two of the four tactical axes - the
    // ring is built so all four are not reachable together.
    const full = bankAxes(base({
      engagementRatio: 1, engagementOffered: true,
      premiumEarned: 100,      // Craft
      shipEarlyPercent: 30,    // Tempo
    }), CEIL);
    const share = full.engagement / full.total;
    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.36);
  });

  it("does not scale with how the LOCKING went", () => {
    // Not gated by delivery, not multiplied by the lock payout multiplier: a
    // run that operated everything and lost a ball still operated everything.
    const lostABall = bankAxes(base({
      lockedCapacity: 50, totalCapacity: 100,
      engagementRatio: 1, engagementOffered: true,
    }), CEIL);
    expect(lostABall.engagement).toBe(CEIL.engagement);
  });

  it("makes two quick locks NOT a full score on a map with features", () => {
    // The report, as an assertion. Same run, same locks; the only difference is
    // whether the map's own content was touched.
    const ignored = bankAxes(base({ engagementRatio: 0, engagementOffered: true }), CEIL);
    const operated = bankAxes(base({ engagementRatio: 1, engagementOffered: true }), CEIL);
    expect(operated.total - ignored.total).toBe(CEIL.engagement);
    expect(ignored.total).toBeLessThan(operated.total * 0.75);
  });
});

describe("a featureless map does not show the lane", () => {
  it("reports a zero ceiling, which is what the overlay hides on", () => {
    const none = bankAxes(base({ engagementRatio: 0, engagementOffered: false }), CEIL);
    expect(none.ceilings.engagement).toBe(0);
    // ...while a map that HAS features reports the real ceiling even at zero
    // earned, because those hours were genuinely available and declined.
    const offered = bankAxes(base({ engagementRatio: 0, engagementOffered: true }), CEIL);
    expect(offered.ceilings.engagement).toBe(CEIL.engagement);
  });

  it("leaves every other lane untouched by its presence or absence", () => {
    // The founding rule of the axis economy: maxing one never spends another's
    // headroom. A new lane must not quietly change what the old five pay.
    const without = bankAxes(base({ engagementOffered: false }), CEIL);
    const with_ = bankAxes(base({ engagementRatio: 1, engagementOffered: true }), CEIL);
    for (const name of AXIS_NAMES) {
      if (name === "engagement") continue;
      expect(with_[name], name).toBe(without[name]);
    }
  });
});

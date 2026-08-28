/**
 * The results screen reads as what you LEFT, not only what you took.
 *
 * The ask was an economy overhaul: give every map a set value and deduct for
 * what you miss, "to inspire perfection ahead of speed and simplicity". The
 * mechanic was already that - every axis banks `ceiling x ratio`, which is the
 * same arithmetic as `ceiling minus what you missed`, and Craft's denominator
 * is literally "every lock superior". Archetypes on a 3-ball map put a perfect
 * run at 92h against 73h for fast-and-sloppy, so the economy already rewards
 * care over speed.
 *
 * What did NOT exist was any of that being visible. The axis rows read
 * "18/30h", which the eye takes as eighteen earned rather than twelve lost, and
 * nothing on the screen ever said a run had been perfect. So this is the same
 * economy, read the other way round.
 *
 * Two things are deliberately NOT here, and both are the interesting part:
 *
 *   NO GRAND DEFICIT. The tactical axes fight each other by construction, so
 *     about two are reachable per run and the sum of all five ceilings is not a
 *     score anyone can get. "You missed 45h" against an impossible 129 would
 *     make every run read as a failure.
 *   NO ALL-FIVE BADGE, for the same reason. Flawless is the perfection the
 *     economy actually offers: the whole roster delivered, cleanly.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/i18n";
import { PerformanceReviewAxes } from "@/components/game/PerformanceReviewAxes";
import type { BankedAxes } from "@/types/scoring";
import { isFlawlessRun } from "@/lib/scoreAxes";

afterEach(cleanup);

const CEILINGS = { delivery: 30, craft: 30, tempo: 24, thrift: 20, greed: 25 };

type Axis = keyof typeof CEILINGS;

function axes(
  over: Partial<Record<Axis, number>> = {},
  ceilingOver: Partial<Record<Axis, number>> = {},
): BankedAxes {
  const banked = { delivery: 30, craft: 18, tempo: 0, thrift: 20, greed: 5, ...over };
  return {
    ...banked,
    total: Object.values(banked).reduce((a, b) => a + b, 0),
    ceilings: { ...CEILINGS, ...ceilingOver },
    ratios: { delivery: 1, craft: 0.6, tempo: 0, thrift: 1, greed: 0.2 },
  } as unknown as BankedAxes;
}

describe("the axis readout", () => {
  it("names what each axis cost you rather than what it paid", () => {
    // THE change. "18/30h" is read as eighteen earned; "-12h" is read as twelve
    // lost, and the second is what makes a player chase a full axis next time.
    render(<PerformanceReviewAxes axes={axes({ craft: 18 })} />);
    expect(screen.getByText("-12h"), "the shortfall is not shown").toBeTruthy();
  });

  it("marks a full axis rather than showing it as a loss of nothing", () => {
    // "-0h" on a maxed axis would be absurd and would bury the one thing worth
    // celebrating in the row.
    render(<PerformanceReviewAxes axes={axes({ delivery: 30 })} />);
    expect(screen.getByText("30h ✓")).toBeTruthy();
  });

  it("shows an untouched axis as its whole ceiling lost", () => {
    // An axis at zero is the most useful row on the readout: it is the hours
    // that were on the table and left there.
    render(<PerformanceReviewAxes axes={axes({ tempo: 0 })} />);
    expect(screen.getByText("-24h")).toBeTruthy();
  });

  it("says nothing rather than a deficit when the map never offered the axis", () => {
    // A ceiling of zero means this map had no such play available. Reporting
    // "-0h" would invent a failure out of a map that never asked.
    render(<PerformanceReviewAxes axes={axes({ greed: 0 }, { greed: 0 })} />);
    expect(screen.queryByText("-0h")).toBeNull();
  });

  it("makes the shortfalls and the banked hours add up on screen", () => {
    // Derived from the rounded axis rather than from the raw ratio, so a player
    // adding the two numbers gets the ceiling instead of 18 + 13 = 30.
    render(<PerformanceReviewAxes axes={axes({ greed: 5 })} />);
    expect(screen.getByText("-20h")).toBeTruthy(); // 25 ceiling - 5 banked
  });

  it("never reports a total the ring makes unreachable", () => {
    // The four tactical axes fight each other, so all five full is not a score.
    // A single "you missed Nh" would be measured against a fiction.
    render(<PerformanceReviewAxes axes={axes()} />);
    const combined = CEILINGS.delivery + CEILINGS.craft + CEILINGS.tempo
      + CEILINGS.thrift + CEILINGS.greed;
    expect(screen.queryByText(new RegExp(String(combined)))).toBeNull();
  });
});

describe("what counts as a flawless run", () => {
  it("wants every ball on the map, sealed tight", () => {
    expect(isFlawlessRun(3, 3, 1)).toBe(true);
  });

  it("refuses a run that left a ball in play", () => {
    // Two of three sealed perfectly is a good run, not a flawless one. The
    // delivery ratio is what knows about the ball you never caught.
    expect(isFlawlessRun(2, 2, 2 / 3)).toBe(false);
  });

  it("refuses a run with a sloppy lock in it", () => {
    expect(isFlawlessRun(3, 2, 1)).toBe(false);
  });

  it("cannot be bought with a zone multiplier", () => {
    // THE reason this is defined on counts. Craft can be pushed past a full
    // axis by zone and simultaneous multipliers, so a SLOPPY lock inside a
    // const area fills the axis - and a ratio-based test would have called
    // that flawless. A full Craft axis is offered here and still refused.
    expect(isFlawlessRun(3, 1, 1)).toBe(false);
  });

  it("refuses a map where nothing was locked at all", () => {
    // A map with no lock capacity reports a delivery ratio of 1 because it
    // cannot mark you down for a roster it never had. That must not read as
    // perfection.
    expect(isFlawlessRun(0, 0, 1)).toBe(false);
  });

  it("survives missing numbers rather than awarding on them", () => {
    expect(isFlawlessRun(NaN, 3, 1)).toBe(false);
    expect(isFlawlessRun(3, NaN, 1)).toBe(false);
    expect(isFlawlessRun(3, 3, NaN)).toBe(false);
  });
});

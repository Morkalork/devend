/**
 * The perf HUD's hitch statistics.
 *
 * Written after two field readings in a row froze the SAME frame: loading a map
 * costs a ~170ms frame, and because WORST is an all-time maximum, that startup
 * spike won permanently. Both screenshots dutifully reported it, the recurring
 * 3-4 second dip we were hunting could never displace it, and the second reading
 * looked like fresh evidence when it was the first one again.
 *
 * A running maximum is simply the wrong summary for a PERIODIC event. These tests
 * pin the two properties that make the HUD able to answer the question asked:
 * the most recent hitch stays current, and the rate is reported.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordFrame, resetWorstFrame, perfLines, formatGap } from "@/lib/rendering/perfStats";

/** A frame at or over the 32ms threshold; anything under is ordinary. */
const hitch = (ms: number) => recordFrame(ms, 0.2, 5, 1, 2);
const ok = () => recordFrame(16, 0.2, 5, 1, 2);

/** Detail lines are indented in the HUD; the indent is layout, not content. */
const line = (prefix: string): string =>
  perfLines().map(l => l.trim()).find(l => l.startsWith(prefix)) ?? "";

beforeEach(() => {
  resetWorstFrame();
});

describe("hitch rate", () => {
  it("reports nothing before anything has hitched", () => {
    ok();
    ok();
    expect(line("hitch")).toBe("hitch n=0");
    expect(line("last")).toBe("");
    expect(line("WORST")).toBe("");
  });

  it("counts hitches and ignores ordinary frames", () => {
    ok();
    hitch(40);
    ok();
    hitch(45);
    ok();
    expect(line("hitch")).toMatch(/^hitch n=2/);
  });

  it("does not count a frame just under the threshold", () => {
    hitch(31.9);
    expect(line("hitch")).toBe("hitch n=0");
  });
});

describe("the most recent hitch", () => {
  /**
   * The regression that started all this. The startup spike must stay visible as
   * WORST - it is a real cost - while `last` moves on to the dip being hunted.
   */
  it("keeps refreshing while WORST stays pinned to the biggest", () => {
    hitch(170); // map load
    hitch(40);  // the recurring dip
    hitch(38);

    expect(line("WORST")).toMatch(/^WORST 170\.0ms/);
    expect(line("last")).toMatch(/^last 38\.0ms/);
  });

  it("attributes the recent hitch, not just its duration", () => {
    recordFrame(50, 0.2, 5, 1, 2);
    // other = 50 - 0.2 - 5
    expect(line("last")).toMatch(/ot 44\.8/);
    expect(line("last")).toMatch(/rd 5\.0/);
  });

  // Long-task correlation is the whole diagnostic: no observed task means the
  // time went to style, layout, paint or compositing.
  it("marks a hitch with no long task before it", () => {
    hitch(40);
    expect(line("last")).toMatch(/tk-/);
  });

});

/**
 * The field's entire value is separating "a long task caused this frame" (single
 * digit ms) from "one happened a minute ago" (tens of seconds). Printed as raw
 * milliseconds those read "tk8" and "tk69704", distinguishable only by counting
 * digits - and a misread here points the whole investigation the wrong way.
 */
describe("gap formatting", () => {
  it("keeps a causal gap in milliseconds", () => {
    expect(formatGap(8)).toBe("8ms");
    expect(formatGap(12.9)).toBe("13ms");
    expect(formatGap(999)).toBe("999ms");
  });

  it("switches a stale gap to seconds rather than five digits", () => {
    expect(formatGap(1000)).toBe("1s");
    expect(formatGap(49481.2)).toBe("49s");
    expect(formatGap(69704)).toBe("70s");
  });
});

describe("dating a hitch within the session", () => {
  // A worst frame at @0s is the map loading; the same number at @40s is the bug.
  // Without this the two are indistinguishable, which is exactly what happened.
  it("stamps how far into the session the worst frame landed", () => {
    hitch(170);
    expect(line("WORST")).toMatch(/@\d+s$/);
  });
});

describe("resetting", () => {
  it("clears the rate and the recent hitch, not only the worst frame", () => {
    hitch(170);
    hitch(40);
    resetWorstFrame();
    expect(line("hitch")).toBe("hitch n=0");
    expect(line("last")).toBe("");
    expect(line("WORST")).toBe("");
  });
});

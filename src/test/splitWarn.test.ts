/**
 * A `splitLocks` map tints the half that already has its lock, gently red,
 * while a ball that could still be sealed is standing in it (lib/splitWarn.ts).
 *
 * A second lock on a side that is paid for is worth nothing, and on a two-ball
 * map it loses the map outright: the ball sealed there was the one the other
 * side needed. The tint says so on the board, where the mistake is made.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  splitWarnSides, splitClauseOf, splitWarnAlpha, stepSplitWarnFade, splitHalfQuad,
  SPLIT_WARN_ALPHA_MAX, SPLIT_WARN_FADE_MS,
} from "@/lib/splitWarn";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import type { WinCondition } from "@/types/winSpec";
import { LADDER } from "./fixtures/maps";

type Split = Extract<WinCondition, { kind: "splitLocks" }>;
const leftRight: Split = { kind: "splitLocks", count: 1 };
const topBottom: Split = { kind: "splitLocks", count: 1, axis: "horizontal" };

const ball = (x: number, y: number, state = "active") => ({ state, position: { x, y } });

describe("which half warns", () => {
  it("warns on the done half while a live ball is in it", () => {
    const sides = splitWarnSides(leftRight, 0, [{ x: 200, y: 400 }], [ball(300, 500), ball(700, 200)]);
    expect(sides).toEqual({ before: true, after: false });
  });

  it("stays quiet while no ball is on the done half", () => {
    expect(splitWarnSides(leftRight, 0, [{ x: 200, y: 400 }], [ball(700, 200)]))
      .toEqual({ before: false, after: false });
  });

  it("does not count a ball that is already locked, or one still asleep", () => {
    expect(splitWarnSides(leftRight, 0, [{ x: 200, y: 400 }], [ball(210, 400, "locked"), ball(300, 300, "dormant")]))
      .toEqual({ before: false, after: false });
  });

  it("says nothing before either half is done, or once both are", () => {
    expect(splitWarnSides(leftRight, 0, [], [ball(100, 100), ball(800, 800)]))
      .toEqual({ before: false, after: false });
    expect(splitWarnSides(leftRight, 0, [{ x: 100, y: 100 }, { x: 800, y: 100 }], [ball(100, 500), ball(800, 500)]))
      .toEqual({ before: false, after: false });
  });

  it("needs the clause's whole count on a half before calling it done", () => {
    const two: Split = { ...leftRight, count: 2 };
    expect(splitWarnSides(two, 0, [{ x: 200, y: 400 }], [ball(300, 500)]).before).toBe(false);
    expect(splitWarnSides(two, 0, [{ x: 200, y: 400 }, { x: 250, y: 100 }], [ball(300, 500)]).before).toBe(true);
  });

  it("splits top from bottom on a horizontal line", () => {
    expect(splitWarnSides(topBottom, 0, [{ x: 400, y: 800 }], [ball(400, 700), ball(400, 100)]))
      .toEqual({ before: false, after: true });
  });

  it("follows the line as the DEALT board has it", () => {
    // Dealt a quarter turn, the authored left/right divider runs across the
    // board, so a lock at the bottom is on a different half from a ball at
    // the top whatever their x.
    const sides = splitWarnSides(leftRight, 1, [{ x: 450, y: 800 }], [ball(450, 700), ball(450, 100)]);
    expect(sides.before !== sides.after, "one half warns, not both and not neither").toBe(true);
  });
});

describe("how it looks", () => {
  it("is gentle: faint at its strongest, and one slow breath rather than a blink", () => {
    let peak = 0, reversals = 0, prevDelta = 0, prev = splitWarnAlpha(1, 0);
    for (let t = 16; t < 10_000; t += 16) {
      const a = splitWarnAlpha(1, t);
      peak = Math.max(peak, a);
      const d = a - prev;
      if (d * prevDelta < 0) reversals++;
      if (d !== 0) prevDelta = d;
      prev = a;
    }
    expect(peak).toBeLessThanOrEqual(SPLIT_WARN_ALPHA_MAX + 1e-9);
    expect(peak).toBeLessThanOrEqual(0.2);
    // Ten seconds: a breath every ~1.8s turns round about eleven times. A
    // blink at the rate the board was once reported for would turn round
    // sixty-odd times.
    expect(reversals).toBeLessThanOrEqual(12);
    expect(splitWarnAlpha(0, 900), "a faded-out half draws nothing").toBe(0);
  });

  it("fades in and out instead of switching", () => {
    const half = stepSplitWarnFade(0, true, SPLIT_WARN_FADE_MS / 2);
    expect(half).toBeCloseTo(0.5, 5);
    expect(stepSplitWarnFade(half, false, SPLIT_WARN_FADE_MS)).toBe(0);
  });

  it("covers exactly the half it names", () => {
    const b = { minX: 0, minY: 0, maxX: 900, maxY: 900 };
    expect(splitHalfQuad("before", "vertical", 450, b).map(p => p.x)).toEqual([0, 450, 450, 0]);
    expect(splitHalfQuad("after", "horizontal", 300, b).map(p => p.y)).toEqual([300, 300, 900, 900]);
  });

  it("is drawn into the live-ground plane, so captured ground never tints", () => {
    const src = readFileSync("src/lib/rendering/sleek/SleekRenderer.ts", "utf8");
    const clear = src.indexOf("this.shadowPlane.clear();");
    const draw = src.indexOf("this.drawSplitWarn(game, w2s, now);");
    expect(clear).toBeGreaterThan(-1);
    expect(draw, "the tint is drawn before the plane is cleared, so it never shows").toBeGreaterThan(clear);
    expect(src).toMatch(/this\.shadowPlane\.poly\([^)]*\)\)\.fill\(\{ color: SPLIT_WARN_COLOR/);
  });
});

describe("the maps that ask for it", () => {
  it("level 2 has a split clause for the tint to answer to", () => {
    const level2 = LADDER.find(l => l.level === 2)!;
    expect(splitClauseOf(resolveWinSpec(level2, NO_RUN_RULES))?.kind).toBe("splitLocks");
  });

  it("a map with no split clause has nothing to tint", () => {
    const level1 = LADDER.find(l => l.level === 1)!;
    expect(splitClauseOf(resolveWinSpec(level1, NO_RUN_RULES))).toBeNull();
  });

  it("the run-wide split rule (the Playground's knob) gets the tint too", () => {
    // Every map the run rule reaches, not one that may or may not accept it.
    const reached = LADDER.filter(l => !splitClauseOf(resolveWinSpec(l, NO_RUN_RULES)))
      .map(l => splitClauseOf(resolveWinSpec(l, { winRequiresSplitLocks: 1 })))
      .filter(Boolean);
    expect(reached.length, "the run rule reached no map, so this proves nothing").toBeGreaterThan(0);
    for (const c of reached) expect(c!.count).toBe(1);
  });
});

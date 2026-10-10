/**
 * The canvas MapFailedOverlay's copy and timing
 * (src/ui/game/MapFailedOverlayModel.ts), carrying over runEndingLossExplained.test.tsx:
 * the last life gets a reason too, says the run is over instead of promising a
 * retry, and is not hurried away at the between-attempts speed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { MapFailure } from "@/lib/mapFailure";
import {
  MAP_FAILED_MS, MAP_FAILED_RUN_OVER_MS, mapFailedCopy, mapFailedDelay,
} from "@/ui/game/MapFailedOverlayModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The exact failure from the report: the last ball sealed, the job unfinished. */
const LOCKED_OUT: MapFailure = {
  kind: "lockedOut",
  unmet: [{
    condition: { kind: "smashed", count: 2 },
    current: 0, target: 2, met: false, mode: "accumulate",
  }],
};

const shown = (c: ReturnType<typeof mapFailedCopy>) => [c.headline, ...c.lines, c.stakes, c.tapLine].join("\n");

describe("the overlay on the last life (canvas)", () => {
  it("names what ended the map and what was still missing", () => {
    const c = mapFailedCopy(t, LOCKED_OUT, 0, true);
    expect(c.headline).toMatch(/nothing on the board can change/i);
    expect(c.lines.join("\n")).toMatch(/Smash 2 breakables/i);
  });

  it("says the run is over instead of promising a retry it cannot give", () => {
    const text = shown(mapFailedCopy(t, LOCKED_OUT, 0, true));
    expect(text).toMatch(/No lives left/i);
    expect(text, "offered a retry on a finished run").not.toMatch(/try again/i);
  });

  it("still promises the retry when a life remains", () => {
    const text = shown(mapFailedCopy(t, LOCKED_OUT, 2, false));
    expect(text).toMatch(/try again/i);
    expect(text).toMatch(/2 lives left/i);
    expect(text).not.toMatch(/No lives left/i);
  });

  it("does not hurry the run away at the between-attempts speed", () => {
    expect(mapFailedDelay(false)).toBe(MAP_FAILED_MS);
    expect(mapFailedDelay(true)).toBe(MAP_FAILED_RUN_OVER_MS);
  });

  it("keeps the backstop far longer than the retry timer, not merely different", () => {
    expect(MAP_FAILED_RUN_OVER_MS).toBeGreaterThan(MAP_FAILED_MS * 4);
  });

  it("keeps the same timers as the DOM overlay it replaces", () => {
    const dom = read("src/components/game/MapFailedOverlay.tsx");
    expect(dom).toContain(`MAP_FAILED_MS = ${MAP_FAILED_MS}`);
    expect(dom).toContain(`MAP_FAILED_RUN_OVER_MS = ${MAP_FAILED_RUN_OVER_MS}`);
  });

  it("dismisses on a tap anywhere and on its own timer", () => {
    // A render needs a canvas; the wiring is checked at the source.
    const src = read("src/ui/game/MapFailedOverlay.tsx");
    expect(src).toMatch(/<Pressable\s+onTap=\{onDismiss\}/);
    expect(src).toMatch(/setTimeout\(onDismiss, mapFailedDelay\(runOver\)\)/);
  });
});

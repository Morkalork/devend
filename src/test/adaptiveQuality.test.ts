/**
 * Auto quality learns, and remembers, what this device can hold.
 *
 * Reported as "lagging something awful" on a Samsung A33: the board, not the
 * menus. The frame-time governor (quality.ts) already stepped a tier down when
 * a map ran slow, but the renderer is rebuilt every time the store opens, so
 * every new board started again from the device guess ("medium" on an A33)
 * and lagged through the opening of every map. Now the step is stored, a
 * board starts no higher than it, a badly slow map drops its 3D resolution at
 * once, and below the cheapest 3D tier the 2D board takes over.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEARNED_KEY, QUALITY_SETTINGS, autoStartTier, cheaperTier, getBoardRenderer, getLearnedLimit,
  setLearnedLimit, setQualitySetting, setRendererChoice,
} from "@/lib/rendering/render3dSettings";
import {
  clearQualitySteps, diagText, getQualitySteps, qualityStepText, recordQualityStep,
} from "@/lib/rendering/rendererDiag";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  localStorage.clear();
});

describe("what auto has learned", () => {
  it("is nothing on a fresh device, and keeps what it is told", () => {
    expect(getLearnedLimit()).toBeNull();
    setLearnedLimit("low");
    expect(getLearnedLimit()).toBe("low");
    setLearnedLimit("2d");
    expect(getLearnedLimit()).toBe("2d");
    setLearnedLimit(null);
    expect(localStorage.getItem(LEARNED_KEY)).toBeNull();
  });

  it("ignores a value it does not know", () => {
    localStorage.setItem(LEARNED_KEY, "ultra");
    expect(getLearnedLimit()).toBeNull();
  });

  it("caps where a board starts, never raises it", () => {
    expect(autoStartTier("medium", null)).toBe("medium");
    expect(autoStartTier("medium", "low")).toBe("low");
    expect(autoStartTier("low", "high")).toBe("low"); // learned is a ceiling, not a target
    expect(autoStartTier("high", "2d")).toBe("minimal");
    expect(cheaperTier("minimal", "high")).toBe("minimal");
  });

  it("offers the minimal tier in Admin's picker", () => {
    expect(QUALITY_SETTINGS).toContain("minimal");
  });
});

describe("the 2D board as the last step", () => {
  it("takes over only on auto quality with the 3D board chosen", () => {
    setLearnedLimit("2d");
    expect(getBoardRenderer()).toBe("sleek");
    // A pinned tier is a tester comparing: it gets the 3D board it asked for.
    setQualitySetting("medium");
    expect(getBoardRenderer()).toBe("three");
    setQualitySetting("auto");
    setRendererChoice("sleek");
    expect(getBoardRenderer()).toBe("sleek");
    setRendererChoice("three");
    setLearnedLimit("low");
    expect(getBoardRenderer()).toBe("three");
  });

  it("is what the board reads when it mounts", () => {
    expect(read("src/components/game/GameCanvas.tsx")).toContain("useState<RendererChoice>(getBoardRenderer)");
  });
});

describe("the renderer", () => {
  const src = read("src/lib/rendering/three/ThreeRenderer.ts");
  const step = src.slice(src.indexOf("private stepDownForSlowFrames"), src.indexOf("presentEmpty(): void"));

  it("starts auto at the guess capped by what was learned", () => {
    // Resolved in the settings, where the board canvas's resolution cap reads
    // the same tier (boardPixelRatioCap), so the two can never disagree.
    expect(src).toContain("this.tier = resolvedTier();");
    const settings = readFileSync(resolve(process.cwd(), "src/lib/rendering/render3dSettings.ts"), "utf8");
    expect(settings).toMatch(/autoStartTier\(autoTier\(\{[\s\S]*?\}\), getLearnedLimit\(\)\)/);
  });

  it("stores each step down the moment it decides it, and logs why", () => {
    expect(step).toContain("setLearnedLimit(next);");
    expect(step).toContain("recordQualityStep(this.tier, next, medianMs);");
    expect(step).toContain('setLearnedLimit("2d");');
  });

  it("drops the 3D resolution at once when frames are badly slow, without a rebuild", () => {
    // Badly slow: straight to one pixel per CSS pixel. Merely over budget: a
    // quarter off, also at once, so the rest of the map is not spent slow.
    expect(step).toContain("const ratioNext = medianMs > SEVERE_FRAME_MS ? 1 : Math.max(1, ratioNow * 0.75);");
    expect(step).toContain("this.emergencyRatio = ratioNext;");
    expect(src).toContain("const ratio = Math.min(preset.maxPixelRatio, this.emergencyRatio);");
    // A rebuild lifts the cap, so the next tier is measured on its own.
    expect(src).toMatch(/this\.governor\.reset\(performance\.now\(\)\);\s*this\.emergencyRatio = Number\.POSITIVE_INFINITY;/);
  });

  it("learns on auto only: a pinned tier is never second-guessed", () => {
    expect(src).toContain("if (this.auto && !this.pendingTier && !this.exhausted && this.governor.frame(performance.now())) {");
  });
});

describe("the step log", () => {
  it("keeps the last eight steps, newest last, with the frame rate they ran at", () => {
    for (let i = 0; i < 10; i++) recordQualityStep("medium", "low", 40 + i);
    const steps = getQualitySteps();
    expect(steps).toHaveLength(8);
    expect(steps[7].medianMs).toBe(49);
    expect(qualityStepText(steps[0])).toMatch(/^medium -> low at 42ms \(24 fps\)/);
    clearQualitySteps();
    expect(getQualitySteps()).toEqual([]);
  });

  it("goes into the copied report with what was learned", () => {
    recordQualityStep("medium", "low", 41.24);
    const text = diagText("three", null, null, getQualitySteps(), "low");
    expect(text).toContain("auto has learned: low");
    expect(text).toContain("quality step: medium -> low at 41.2ms (24 fps)");
  });

  it("is shown and resettable in Admin", () => {
    const card = read("src/components/admin/RendererDiagCard.tsx");
    expect(card).toContain("setLearnedLimit(null); clearQualitySteps();");
    expect(card).toContain("qualityStepText(s)");
  });
});

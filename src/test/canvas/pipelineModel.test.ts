/**
 * The between-map pipeline's plan (src/ui/screens/pipelineModel.ts): which
 * stages stand between two maps, what each Continue button promises, and
 * that the three stage screens actually draw in the shared frame.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import {
  PIPELINE_MAX_WIDTH, continueLabel, nextStage, pipelineColumnWidth, pipelineStages, samplePlan, stageIds, type BetweenMapPlan,
} from "@/ui/screens/pipelineModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const plan = (over: Partial<BetweenMapPlan> = {}): BetweenMapPlan => ({ ...samplePlan(10), ...over });

describe("stageIds", () => {
  it("lists every stage when a Promotion and the store are both due", () => {
    expect(stageIds(plan())).toEqual(["debrief", "promotion", "store", "next"]);
  });

  it("leaves out the stages this map skips", () => {
    expect(stageIds(plan({ promotion: false }))).toEqual(["debrief", "store", "next"]);
    // Hiring Freeze closes the store on some levels.
    expect(stageIds(plan({ promotion: false, store: false }))).toEqual(["debrief", "next"]);
  });

  // The last map goes straight from the Debrief to the run's finish.
  it("goes straight to the finale after the last map", () => {
    expect(stageIds(plan({ last: true }))).toEqual(["debrief", "next"]);
  });
});

describe("the Continue buttons name where they go", () => {
  it("follows the plan stage by stage", () => {
    expect(nextStage(plan(), "debrief")).toBe("promotion");
    expect(nextStage(plan(), "promotion")).toBe("store");
    expect(nextStage(plan(), "store")).toBe("next");
    expect(nextStage(plan({ promotion: false }), "debrief")).toBe("store");
  });

  it("says the destination in words", () => {
    expect(continueLabel(plan(), "debrief", t)).toBe("Choose your promotion");
    expect(continueLabel(plan({ promotion: false }), "debrief", t)).toBe("Open the store");
    expect(continueLabel(plan(), "store", t)).toBe("Start level 11");
    expect(continueLabel(plan({ last: true }), "debrief", t)).toBe("Finish the run");
  });
});

describe("pipelineStages", () => {
  it("marks the stages before as done and those after as to do", () => {
    const stages = pipelineStages(plan(), "store", t);
    expect(stages.map(s => s.state)).toEqual(["done", "done", "now", "todo"]);
    expect(stages.map(s => s.title)).toEqual(["Debrief", "Promotion", "Store", "Level 11"]);
  });

  it("ends the strip at the run's finish after the last map", () => {
    expect(pipelineStages(plan({ last: true }), "debrief", t).at(-1)?.title).toBe("Finish");
  });
});

describe("the column", () => {
  it("keeps a phone's margin and stops growing on a tablet", () => {
    expect(pipelineColumnWidth(390)).toBe(358);
    expect(pipelineColumnWidth(1200)).toBe(PIPELINE_MAX_WIDTH);
  });
});

describe("the three stages share one frame", () => {
  it.each([
    ["src/ui/screens/LevelCompleteOverlay.tsx", "debrief"],
    ["src/ui/screens/CapstoneDraftScreen.tsx", "promotion"],
    ["src/ui/screens/UpgradeShop.tsx", "store"],
  ])("%s draws in PipelineFrame at %s", (file, at) => {
    const src = read(file);
    expect(src).toContain("<PipelineFrame");
    expect(src).toContain(`at="${at}"`);
  });

  // A live plan would drop the Promotion from the store's strip the moment
  // the pick sets the capstone, so the session freezes it once the debrief closes.
  it("is fed one plan from the session, frozen after the debrief", () => {
    const session = read("src/hooks/useGameSession.ts");
    expect(session).toContain("frozenBetweenMapPlan");
    const index = read("src/pages/Index.tsx");
    expect(index.match(/pipeline=\{session\.betweenMapPlan\}/g)?.length).toBe(3);
  });

  it("has a gallery entry for a map with no Promotion and for the last map", () => {
    const g = read("src/ui/dev/gallery/between.tsx");
    expect(g).toContain('id: "LevelCompleteOverlay-storeOnly"');
    expect(g).toContain('id: "LevelCompleteOverlay-last"');
  });
});

describe("motion (phase 5)", () => {
  // Only two things move on their own: the figure counts, and a stage slides in.
  it("counts the headline figure rather than printing it", () => {
    const kit = read("src/ui/kit/pipeline.tsx");
    expect(kit).toContain("const counted = useCountTo(typeof value === \"number\" ? value : 0);");
    expect(read("src/ui/screens/UpgradeShop.tsx")).toContain("value: remainingBudget,");
  });

  it("slides each stage's content in under a strip that stays put", () => {
    const frame = read("src/ui/screens/PipelineFrame.tsx");
    const strip = frame.indexOf("<StageStrip");
    const slide = frame.indexOf("<Appear fromX={STAGE_SLIDE}");
    expect(strip).toBeGreaterThan(0);
    expect(slide, "the strip slides with the content").toBeGreaterThan(strip);
  });
});

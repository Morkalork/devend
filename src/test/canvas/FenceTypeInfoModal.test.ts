/**
 * The canvas FenceTypeInfoModal (src/ui/game/FenceTypeInfoModal.tsx), carried
 * over from fenceSlotBar.test.tsx's explainer checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fenceSpeedLine, FENCE_INFO_FOOTER_KEY, HOW_TO_USE_KEY } from "@/ui/game/bottomModel";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SRC = read("src/ui/game/FenceTypeInfoModal.tsx");

describe("it names what the type COSTS", () => {
  it("says slower or faster, by how much", () => {
    expect(fenceSpeedLine(0.7)).toEqual({ key: "fenceTypes.buildsSlower", percent: 30 });
    expect(fenceSpeedLine(1.4)).toEqual({ key: "fenceTypes.buildsFaster", percent: 40 });
  });

  it("claims no cost for the standard fence", () => {
    expect(fenceSpeedLine(1)).toBeNull();
  });

  it("is the line the card draws", () => {
    expect(SRC).toMatch(/fenceSpeedLine\(fence\.buildSpeed\)/);
  });
});

describe("the card", () => {
  it("says the choice stays selected", () => {
    expect(FENCE_INFO_FOOTER_KEY).toBe("fenceTypes.staysSelected");
    expect(SRC).toMatch(/t\(FENCE_INFO_FOOTER_KEY\)/);
  });

  it("is the kit's Modal, full screen", () => {
    expect(SRC).toMatch(/<Modal screen=\{screen\}/);
    expect(SRC).toMatch(/useUiScreen\(\)/);
  });

  it("has words in all three locales for every key it reads", () => {
    for (const lang of ["en", "es", "sv"]) {
      const d = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      for (const key of ["fenceTypes.buildsSlower", "fenceTypes.buildsFaster", FENCE_INFO_FOOTER_KEY, HOW_TO_USE_KEY]) {
        const v = key.split(".").reduce((o: Record<string, unknown> | undefined, k) => o?.[k] as Record<string, unknown> | undefined, d);
        expect(v, `${lang} is missing ${key}`).toBeTruthy();
      }
    }
  });
});

/**
 * The canvas AbilityInfoModal (src/ui/game/AbilityInfoModal.tsx), carried over
 * from abilityInfoCopy.test.tsx: the card says what the ability does and how to
 * use it, and no longer says how it was obtained.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { getAbility } from "@/lib/abilities";
import { abilityInfoLines, HOW_TO_USE_KEY } from "@/ui/game/bottomModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/AbilityInfoModal.tsx"), "utf8");

describe("the acquisition footer", () => {
  it("is gone from the card", () => {
    const lines = abilityInfoLines(getAbility("slowAll")!);
    expect(Object.keys(lines).sort()).toEqual(["description", "howTo"]);
    const all = `${lines.description} ${lines.howTo}`;
    expect(all).not.toMatch(/smash a box/i);
    expect(all).not.toMatch(/\bgem\b/i);
    expect(SRC, "the card reads the retired hint again").not.toMatch(/collectHint/);
  });

  it("leaves the card saying what it does and how to use it", () => {
    const lines = abilityInfoLines(getAbility("slowAll")!);
    expect(lines.description).toMatch(/Slows every ball/i);
    expect(lines.howTo).toMatch(/line up your cuts/i);
    expect(i18n.getFixedT("en")(HOW_TO_USE_KEY)).toMatch(/HOW TO USE/i);
    expect(SRC).toMatch(/t\(HOW_TO_USE_KEY\)/);
  });
});

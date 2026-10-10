/** The canvas condition pill (ConditionChip). The DOM one had no test of its own. */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { COLOR } from "@/ui/theme";
import { conditionChipLook, conditionChipText } from "@/ui/game/tagChipModel";

const t = i18n.t.bind(i18n);

describe("the condition pill", () => {
  it("says the condition in words", () => {
    expect(conditionChipText(t, { kind: "livesAtMost", value: 1 }, true).text).toBe("On your last life");
    expect(conditionChipText(t, { kind: "bankedAtLeast", value: 5 }, false).text).toContain("5h");
  });

  it("says whether it is live on the next map", () => {
    expect(conditionChipText(t, { kind: "levelAtLeast", value: 3 }, true).title).toBe(t("upgradeConditions.liveNow"));
    expect(conditionChipText(t, { kind: "levelAtLeast", value: 3 }, false).title).toBe(t("upgradeConditions.notNow"));
  });

  it("is success green when live and muted when not", () => {
    expect(conditionChipLook(true).color).toBe(COLOR.primary);
    expect(conditionChipLook(false).color).toBe(COLOR.mutedForeground);
  });
});

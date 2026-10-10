/**
 * The canvas tag pill. The DOM TagChip had no test of its own; this guards the
 * one thing the port added, reading TAG_COLORS' Tailwind classes as colours.
 */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { TAG_COLORS, type UpgradeTag } from "@/types/upgrade";
import { tagChipLook, tagChipText, textSizeOfClass, twColor } from "@/ui/game/tagChipModel";

const t = i18n.t.bind(i18n);

describe("the tag pill", () => {
  it("has a colour for every tag in the shared table", () => {
    for (const tag of Object.keys(TAG_COLORS) as UpgradeTag[]) {
      expect(tagChipLook(tag), `${tag} lost its colours on the canvas`).not.toBeNull();
    }
  });

  it("reads the table's classes rather than its own copy", () => {
    expect(tagChipLook("lock")).toEqual({ text: 0x6ee7b7, background: 0x10b981, backgroundAlpha: 0.15 });
  });

  it("renders nothing for a tag the table does not know", () => {
    expect(tagChipLook("nope" as UpgradeTag)).toBeNull();
  });

  it("labels the tag, with its suffix after a space", () => {
    expect(tagChipText(t, "lock")).toBe("Lock");
    expect(tagChipText(t, "lock", "2/3")).toBe("Lock 2/3");
  });
});

describe("Tailwind classes as canvas values", () => {
  it("parses a colour with and without an opacity", () => {
    expect(twColor("bg-cyan-500/15")).toEqual({ color: 0x06b6d4, alpha: 0.15 });
    expect(twColor("text-red-300")).toEqual({ color: 0xfca5a5, alpha: 1 });
    expect(twColor("text-muted-foreground")).toBeNull();
  });

  it("reads a text-size class in px", () => {
    expect(textSizeOfClass("text-[9px]", 1)).toBe(9);
    expect(textSizeOfClass("text-xs", 1)).toBe(12);
    expect(textSizeOfClass("font-bold text-sm", 1)).toBe(14);
    expect(textSizeOfClass(undefined, 10)).toBe(10);
  });
});

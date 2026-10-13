/**
 * The canvas DraftCard and the screens that share it, carried over from
 * draftCardConsistency.test.tsx. The DOM test read class names; these read
 * the canvas sources and the card's look rules (draftModel.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { draftCardLook, draftCardShowsHoldHint, toggleSelection } from "@/ui/screens/draftModel";

const SCREENS = resolve(process.cwd(), "src/ui/screens");
const CARD = readFileSync(join(SCREENS, "DraftCard.tsx"), "utf8");

function draftScreens(): { name: string; text: string }[] {
  return readdirSync(SCREENS)
    .filter(f => /DraftScreen\.tsx$/.test(f))
    .map(f => ({ name: f, text: readFileSync(join(SCREENS, f), "utf8") }));
}

describe("the between-map draft screens", () => {
  it("are all present, or this guard is looking at nothing", () => {
    expect(draftScreens().length).toBeGreaterThanOrEqual(3);
  });

  it("all offer their choices through the shared card", () => {
    const missing = draftScreens().filter(s => !/<DraftCard/.test(s.text)).map(s => s.name);
    expect(missing, "draft screens not using DraftCard").toEqual([]);
  });

  it("none of them hand-rolls a selectable card of its own", () => {
    // A selected/unselected treatment written out inline is a copy of DraftCard.
    const bespoke = draftScreens().filter(s => /selected \? tint\(/.test(s.text)).map(s => s.name);
    expect(bespoke).toEqual([]);
  });
});

describe("the card everything shares", () => {
  it("is as big as an upgrade card: 20px padding, rounded-xl, a text-xl name", () => {
    expect(CARD).toMatch(/padding: 20/);
    expect(CARD).toMatch(/borderRadius: RADIUS\.xl/);
    expect(CARD).toMatch(/size=\{TEXT\.xl\}/);
  });

  it("has room for the big leading glyph", () => {
    expect(CARD).toMatch(/\{icon\}/);
  });

  it("still selects on a plain tap", () => {
    expect(CARD).toMatch(/onTap=\{onClick\}/);
  });

  it("shows an Info hint only where holding actually does something", () => {
    expect(draftCardShowsHoldHint(() => {})).toBe(true);
    expect(draftCardShowsHoldHint(undefined)).toBe(false);
    expect(CARD).toMatch(/onHold=\{onLongPress\}/);
  });

  it("tells selected from unselected by ground, border and glow", () => {
    const on = draftCardLook(0x00ff88, true);
    const off = draftCardLook(0x00ff88, false);
    expect(on.background).not.toEqual(off.background);
    expect(on.border).toBe(0x00ff88);
    expect(off.border).not.toEqual(on.border);
    expect(on.glow).toBeGreaterThan(0);
    expect(off.glow).toBe(0);
  });

  it("deselects on a second tap and moves the selection on a different one", () => {
    expect(toggleSelection(null, "a")).toBe("a");
    expect(toggleSelection("a", "a")).toBeNull();
    expect(toggleSelection("a", "b")).toBe("b");
  });
});

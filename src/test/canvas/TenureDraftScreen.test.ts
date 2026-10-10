/**
 * The canvas TenureDraftScreen, carried over from tenureDraftScreen.test.tsx:
 * the pick contract (confirm hands back the head id, and only once something
 * is picked) and what the cards show.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toggleSelection } from "@/ui/screens/draftModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/TenureDraftScreen.tsx"), "utf8");

describe("picking a chain", () => {
  it("cannot confirm before anything is selected", () => {
    expect(SRC).toMatch(/disabled=\{!selectedId\}/);
    expect(SRC).toMatch(/onTap=\{\(\) => selectedId && onConfirm\(selectedId\)\}/);
  });

  it("confirms the selected chain by its head id", () => {
    expect(SRC).toMatch(/setSelectedId\(toggleSelection\(selectedId, offer\.headId\)\)/);
    expect(toggleSelection(null, "beta")).toBe("beta");
  });

  it("lets the player change their mind before confirming", () => {
    expect(toggleSelection(toggleSelection(null, "alpha"), "gamma")).toBe("gamma");
  });

  it("deselects when the same card is tapped twice", () => {
    expect(toggleSelection(toggleSelection(null, "alpha"), "alpha")).toBeNull();
  });

  it("the button says pick-to-start until something is chosen", () => {
    expect(SRC).toMatch(/selectedId \? t\("tenure\.confirmButton"\) : t\("tenure\.pickToStart"\)/);
  });
});

describe("what the cards show", () => {
  it("lists every tier that will be granted, not just the head", () => {
    expect(SRC).toMatch(/offer\.upgrades\.map\(u =>/);
    expect(SRC).toMatch(/contentText\.upgradeDesc\(t, u\)/);
  });

  it("renders one card per offer, named for the chain's head", () => {
    expect(SRC).toMatch(/offers\.map\(\(offer, i\)/);
    expect(SRC).toMatch(/name=\{contentText\.upgradeName\(t, offer\.upgrades\[0\]\)\}/);
  });

  it("names the level the reward was earned at", () => {
    expect(SRC).toMatch(/t\("tenure\.subtitle", \{ level: earnedAtLevel \}\)/);
  });
});

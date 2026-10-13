/**
 * The canvas ChainPickScreen (grown out of the Tenure draft): the pick
 * contract (confirm hands back the head id, and only once something is
 * picked) and what the cards show.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toggleSelection } from "@/ui/screens/draftModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/ChainPickScreen.tsx"), "utf8");

describe("picking a chain", () => {
  it("cannot confirm before anything is selected", () => {
    expect(SRC).toMatch(/disabled=\{!selectedId\}/);
    expect(SRC).toMatch(/onTap=\{\(\) => selectedId && onConfirm\(selectedId\)\}/);
  });

  it("confirms the selected chain by its head id", () => {
    expect(SRC).toMatch(/setSelectedId\(toggleSelection\(selectedId, choice\.headId\)\)/);
    expect(toggleSelection(null, "beta")).toBe("beta");
  });

  it("lets the player change their mind before confirming", () => {
    expect(toggleSelection(toggleSelection(null, "alpha"), "gamma")).toBe("gamma");
  });

  it("the button says pick-to-start until something is chosen", () => {
    expect(SRC).toMatch(/selectedId \? t\("chainPick\.confirmButton"\) : t\("chainPick\.pickToStart"\)/);
  });

  it("has no skip: the offer was already taken", () => {
    expect(SRC).not.toMatch(/onConfirm\(null\)/);
  });
});

describe("what the cards show", () => {
  it("lists every tier that will be granted, not just the head", () => {
    expect(SRC).toMatch(/choice\.upgrades\.map\(u =>/);
    expect(SRC).toMatch(/contentText\.upgradeDesc\(t, u\)/);
  });

  it("renders one card per choice, named for the chain's head", () => {
    expect(SRC).toMatch(/choices\.map\(\(choice, i\)/);
    expect(SRC).toMatch(/name=\{contentText\.upgradeName\(t, choice\.upgrades\[0\]\)\}/);
  });

  it("names the offer that was taken", () => {
    expect(SRC).toMatch(/title=\{contentText\.offerName\(t, offer\)\}/);
  });
});

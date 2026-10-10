/**
 * Whose turn it is, on the canvas board (carried over from pairTurn.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import { turnColor, turnGlowAlpha, turnSplashes } from "@/ui/game/overlayModel";

const src = readFileSync("src/ui/game/PairTurnOverlay.tsx", "utf8");

describe("the board says whose turn it is", () => {
  it("lights up in your colour and offers Pass on your turn", () => {
    expect(turnColor("yours", "#00ff88", "#ffb347")).toBe("#00ff88");
    expect(turnColor("yoursSpent", "#00ff88", "#ffb347")).toBe("#00ff88");
    expect(i18n.t("pair.turn.yours")).toMatch(/Your turn/);
    expect(i18n.t("pair.turn.pass")).toBe("Pass");
    // The glow is drawn only while it is yours, and Pass only with a handler.
    expect(src).toMatch(/\{mine && <TurnGlow/);
    expect(src).toMatch(/\{onPass && \(\s*<Pressable onTap=\{onPass\}/);
  });

  it("breathes while the fence is still to draw, and holds once drawn", () => {
    expect(turnGlowAlpha("yours", 0)).toBeCloseTo(0.55);
    expect(turnGlowAlpha("yours", 1)).toBeCloseTo(1);
    expect(turnGlowAlpha("yoursSpent", 0.3)).toBe(0.6);
  });

  it("dims the board and says you are spectating on theirs", () => {
    expect(turnColor("theirs", "#00ff88", "#ffb347")).toBe("#ffb347");
    expect(i18n.t("pair.turn.spectating")).toMatch(/Spectating/);
    expect(i18n.t("pair.turn.theirs", { name: "Ada" })).toMatch(/Ada's turn/);
    expect(src).toMatch(/useTween\(mine \? 0 : 1, 0\.35\)/);
  });

  it("splashes every change of hands, not the spent fence", () => {
    expect(turnSplashes("yours")).toBe(true);
    expect(turnSplashes("theirs")).toBe(true);
    expect(turnSplashes("yoursSpent")).toBe(false);
    expect(src).toMatch(/<TurnSplash key=\{turn\.seq\}/);
  });

  it("shows nothing in solo play", () => {
    expect(src).toMatch(/if \(!turn\) return null;/);
  });
});

/**
 * The board's "not a normal clear" frame on the canvas (carried over from
 * goalReadouts.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { glowFalloff } from "@/ui/game/boardDraw";
import { OUTSTANDING } from "@/ui/game/overlayModel";

const raw = readFileSync("src/ui/game/WinGateFrame.tsx", "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => l.split("//")[0]).join("\n");

describe("the board frame", () => {
  it("is not drawn at all on an ordinary map", () => {
    expect(code).toMatch(/if \(!present\) return null;/);
  });

  it("is never the accent colour", () => {
    // The accent means "done" everywhere else in the HUD; a frame in that
    // colour, drawn precisely when the map is NOT complete, says the opposite.
    expect(OUTSTANDING).toBe(0xffb347);
    expect(OUTSTANDING).not.toBe(0x00ff88);
    expect(code).toContain("color={OUTSTANDING}");
  });

  it("never swallows a tap meant for the board", () => {
    expect(code).toMatch(/<Inert/);
    expect(code).not.toMatch(/Pressable|Blocker|eventMode="static"/);
  });

  it("fades with the requirement rather than blinking away", () => {
    expect(code).toMatch(/useTween\(outstanding \? 1 : 0, 0\.45\)/);
  });
});

describe("the frame stays one state", () => {
  it("has no per-condition colour table", () => {
    const hexes = new Set(code.match(/#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}/g) ?? []);
    expect([...hexes], "the frame grew a colour of its own").toHaveLength(0);
    for (const kind of ["superiorLocks", "area", "lockType", "speedClear"]) {
      expect(code, `the frame started branching on ${kind}`).not.toContain(kind);
    }
  });
});

describe("the frames' glow", () => {
  // CSS defines a blur radius as a gaussian with sigma = blur / 2; the glow
  // must reach about as far, or it reads as a thin hard band (it did).
  it("is half strength at the spread's edge and fades over the blur", () => {
    expect(glowFalloff(10, 10, 20)).toBeCloseTo(0.5, 3);
    expect(glowFalloff(0, 10, 20)).toBeGreaterThan(0.8);
    expect(glowFalloff(10 + 10, 10, 20)).toBeCloseTo(0.159, 2); // one sigma out
    expect(glowFalloff(10 + 25, 10, 20)).toBeLessThan(0.01);
  });

  it("is a hard edge with no blur", () => {
    expect(glowFalloff(3, 4, 0)).toBe(1);
    expect(glowFalloff(5, 4, 0)).toBe(0);
  });
});

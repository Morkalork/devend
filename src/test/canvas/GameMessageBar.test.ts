/**
 * The canvas GameMessageBar (src/ui/game/GameMessageBar.tsx), carried over from
 * gameMessages.test.ts's placement checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gameMessageKey } from "@/ui/game/bottomModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/GameMessageBar.tsx"), "utf8");

describe("the message bar", () => {
  it("reads the message's words from gameMessages", () => {
    expect(gameMessageKey({ id: "fenceLimit", at: 0, seq: 1 })).toBe("gameMessages.fenceLimit");
  });

  it("never eats a tap meant for the board", () => {
    // The DOM's pointer-events-none: nothing in it is pressable.
    expect(SRC).not.toMatch(/<Pressable|import \{[^}]*Pressable/);
  });

  it("animates a DIFFERENT message, not a repeat of the same one", () => {
    expect(SRC).toMatch(/key=\{shown\.seq\}/);
    expect(SRC).toMatch(/messageExpired\(current, Date\.now\(\)\)/);
  });

  it("is exactly the context lane tall whether or not a message is up", () => {
    expect(SRC).toMatch(/height: HUD\.contextLane/);
  });
});

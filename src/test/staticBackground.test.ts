/**
 * The frozen background (perfStats.isStaticBgEnabled): on by default on a
 * touch device, where the scrolling CRT text and the parallax canvas were two
 * full-screen layers composited under the board every frame.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STATIC_BG_KEY, setStaticBgEnabled, staticBgDefault } from "@/lib/rendering/perfStats";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the frozen background", () => {
  beforeEach(() => localStorage.clear());

  it("defaults on for a touch device and off for a desktop", () => {
    expect(staticBgDefault(true)).toBe(true);
    expect(staticBgDefault(false)).toBe(false);
  });

  it("stores an explicit choice either way, so a tester can override the default", () => {
    setStaticBgEnabled(false);
    expect(localStorage.getItem(STATIC_BG_KEY)).toBe("0");
    setStaticBgEnabled(true);
    expect(localStorage.getItem(STATIC_BG_KEY)).toBe("1");
  });

  it("does not mount the parallax canvas when frozen, so the loop skips its tick", () => {
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("{!staticBg && <MemoryParallaxLayer");
    expect(screen).toContain("paused={mapComplete || staticBg}");
  });
});

/**
 * The page stays inside the safe area (Android 15+ edge-to-edge, notched
 * phones): nothing in the interface reads safe-area insets, so it must never
 * ask to draw under the system bars.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VIEWPORT_META_CONTENT } from "@/lib/viewportZoom";

const read = (p: string) => readFileSync(p, "utf8");

describe("edge to edge", () => {
  it("never asks for viewport-fit=cover, in the page or when the viewport is re-asserted", () => {
    expect(VIEWPORT_META_CONTENT).not.toContain("viewport-fit");
    const meta = read("index.html").match(/<meta name="viewport" content="([^"]+)"/)?.[1];
    expect(meta).toBe(VIEWPORT_META_CONTENT);
  });

  it("keeps the bars on the game's dark background with light icons on Android", () => {
    expect(read("capacitor.config.ts")).toMatch(/SystemBars: \{\s*style: 'DARK',/);
    expect(read("android/app/src/main/res/values/styles.xml"))
      .toMatch(/<style name="AppTheme\.NoActionBar"[\s\S]*?<item name="android:windowBackground">@color\/splash_background<\/item>/);
  });
});

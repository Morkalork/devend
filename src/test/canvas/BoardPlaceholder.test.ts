/**
 * The board's loading outline on the canvas (carried over from
 * boardPlaceholder.test.tsx; its board-size tests read the shared constants and
 * still hold as they are).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import type { BoardFrameCss } from "@/components/game/BoardPlaceholder";
import { PLACEHOLDER_FADE_MS, PLACEHOLDER_GRID_CELLS, placeholderGeometry } from "@/ui/game/overlayModel";

const FRAME: BoardFrameCss = { left: 6, top: 40, width: 388, height: 388, frame: 6 };
const src = readFileSync("src/ui/game/BoardPlaceholder.tsx", "utf8");

describe("the loading outline", () => {
  it("sits exactly on the frame the canvas hands it", () => {
    expect(src).toContain("left: origin.x + frame.left, top: origin.y + frame.top, width: frame.width, height: frame.height");
    const g = placeholderGeometry(FRAME);
    // The arena sits exactly inside the frame band.
    expect(g.inner).toEqual({ x: 6, y: 6, width: 376, height: 376 });
    expect(g.cell).toBeCloseTo(376 / PLACEHOLDER_GRID_CELLS);
  });

  it("sweeps a scan line down the whole arena", () => {
    const g = placeholderGeometry(FRAME);
    expect(g.scanHeight).toBeCloseTo(Math.max(24, 376 * 0.12));
    expect(g.scanFrom).toBeCloseTo(-376 * 0.12);
    expect(g.scanTo).toBe(376);
  });

  it("says it is loading", () => {
    expect(src).toContain('t("common.loading")');
    expect(i18n.t("common.loading")).toMatch(/loading/i);
  });

  it("draws nothing until the canvas has been sized, and leaves after its fade", () => {
    expect(src).toMatch(/if \(gone \|\| !frame \|\| !geo\) return null;/);
    expect(PLACEHOLDER_FADE_MS).toBe(500);
  });
});

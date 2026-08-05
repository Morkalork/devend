import { describe, it, expect } from "vitest";
import {
  AREA_KINDS,
  areaStyle,
  pointInArea,
  coloredAreaAt,
  coloredAreaMultiplierAt,
  regionWithinAreas,
  regionCoversAreas,
} from "@/lib/coloredAreas";
import { rotateColoredArea } from "@/lib/mapRotation";
import { createSpaceGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { ColoredArea } from "@/types/level";

const area = (x: number, y: number, w: number, h: number, kind: ColoredArea["kind"]): ColoredArea => ({
  x, y, width: w, height: h, kind,
});

describe("area kinds", () => {
  it("map var/let/const to 1.5 / 2 / 3 with the keyword as label", () => {
    expect(areaStyle("var").multiplier).toBe(1.5);
    expect(areaStyle("let").multiplier).toBe(2);
    expect(areaStyle("const").multiplier).toBe(3);
    expect(AREA_KINDS.var.label).toBe("var");
    expect(AREA_KINDS.const.label).toBe("const");
    // Ordering reflects "var easier (lower reward) than const".
    expect(areaStyle("var").multiplier).toBeLessThan(areaStyle("const").multiplier);
  });
});

describe("pointInArea / coloredAreaAt", () => {
  const a = area(500, 45, 355, 335, "var");
  it("detects inside, outside, and the boundary", () => {
    expect(pointInArea(600, 200, a)).toBe(true);
    expect(pointInArea(400, 200, a)).toBe(false); // left of it
    expect(pointInArea(500, 45, a)).toBe(true);    // top-left corner
    expect(pointInArea(855, 380, a)).toBe(true);   // bottom-right corner
  });
  it("coloredAreaAt returns the containing area or null", () => {
    expect(coloredAreaAt(600, 200, [a])?.kind).toBe("var");
    expect(coloredAreaAt(100, 100, [a])).toBeNull();
  });
});

describe("coloredAreaMultiplierAt", () => {
  it("returns the kind multiplier inside, 1 outside, max when overlapping", () => {
    expect(coloredAreaMultiplierAt(600, 200, [area(500, 45, 355, 335, "var")])).toBe(1.5);
    expect(coloredAreaMultiplierAt(100, 100, [area(500, 45, 355, 335, "var")])).toBe(1);
    const overlap = [area(0, 0, 300, 300, "let"), area(100, 100, 300, 300, "const")];
    expect(coloredAreaMultiplierAt(150, 150, overlap)).toBe(3); // inside both -> max (const)
  });
});

describe("regionWithinAreas (boss fenced-into-area win, level-10 fix)", () => {
  // A 900x900 board grid; a var area filling the top-right quadrant.
  const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
  const a = area(450, 0, 450, 450, "var");
  const cellsAt = (pts: Array<[number, number]>) => pts.map(([x, y]) => worldToGridIndex(grid, x, y));

  it("is true when every region cell sits inside the area", () => {
    const region = cellsAt([[600, 100], [700, 200], [500, 400], [850, 50]]);
    expect(regionWithinAreas(grid, region, [a])).toBe(true);
  });

  it("is false when any region cell pokes outside the area", () => {
    const region = cellsAt([[600, 100], [700, 200], [400, 400]]); // last is left of the area
    expect(regionWithinAreas(grid, region, [a])).toBe(false);
  });

  it("is false for an empty region or with no areas", () => {
    expect(regionWithinAreas(grid, [], [a])).toBe(false);
    expect(regionWithinAreas(grid, cellsAt([[600, 100]]), [])).toBe(false);
  });
});

describe("regionCoversAreas (win gate: cover >=70% of the AREA, not 70% of the pocket)", () => {
  const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
  const a = area(0, 0, 60, 60, "var"); // 4x4 = 16 cells (centres 7.5, 22.5, 37.5, 52.5)
  const centres = [7.5, 22.5, 37.5, 52.5];
  const areaCells: number[] = [];
  for (const y of centres) for (const x of centres) areaCells.push(worldToGridIndex(grid, x, y));

  it("true when the pocket covers the whole area, even spilling far outside it", () => {
    const region = [...areaCells, worldToGridIndex(grid, 500, 500), worldToGridIndex(grid, 820, 820)];
    expect(regionCoversAreas(grid, region, [a], 0.7)).toBe(true);
  });

  it("true at >=70% coverage of the area (12 of 16 cells)", () => {
    expect(regionCoversAreas(grid, areaCells.slice(0, 12), [a], 0.7)).toBe(true);
  });

  it("false below 70% coverage of the area (8 of 16 cells)", () => {
    expect(regionCoversAreas(grid, areaCells.slice(0, 8), [a], 0.7)).toBe(false);
  });

  it("a mostly-non-area pocket still passes if it covers the area (denominator is the AREA)", () => {
    const outside: number[] = [];
    for (let i = 0; i < 100; i++) outside.push(worldToGridIndex(grid, 200 + (i % 10) * 15, 300 + Math.floor(i / 10) * 15));
    // ~14% of this pocket is area cells, but it covers 100% of the area -> passes.
    expect(regionCoversAreas(grid, [...areaCells, ...outside], [a], 0.7)).toBe(true);
  });

  it("false for an empty region or with no areas", () => {
    expect(regionCoversAreas(grid, [], [a], 0.7)).toBe(false);
    expect(regionCoversAreas(grid, areaCells, [], 0.7)).toBe(false);
  });
});

describe("rotateColoredArea", () => {
  it("is a no-op at rotation 0", () => {
    const a = area(500, 45, 355, 335, "var");
    expect(rotateColoredArea(a, 0)).toBe(a);
  });
  it("rotates the rect and keeps the kind", () => {
    const a = area(500, 0, 300, 40, "const");
    const r = rotateColoredArea(a, 1); // 90 left: width/height swap
    expect(r.kind).toBe("const");
    expect(r.width).toBeCloseTo(40);
    expect(r.height).toBeCloseTo(300);
  });
});

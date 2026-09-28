import { describe, it, expect } from "vitest";
import {
  AREA_KINDS,
  AREA_MIN_SIZE,
  areaSnippet,
  areaStyle,
  normalizeAreaKind,
  gateAreas,
  isGateArea,
  makeColoredArea,
  pointInArea,
  coloredAreaAt,
  coloredAreaMultiplierAt,
  regionWithinAreas,
  regionCoversAreas,
} from "@/lib/coloredAreas";
import { rotateColoredArea } from "@/lib/mapRotation";
import { createSpaceGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { ColoredArea } from "@/types/level";

const area = (x: number, y: number, w: number, h: number, kind: ColoredArea["kind"]): ColoredArea => ({
  x, y, width: w, height: h, kind,
});

describe("area kinds", () => {
  it("has exactly two tiers: light 1.5x and dark 2x", () => {
    expect(Object.keys(AREA_KINDS).sort()).toEqual(["dark", "light"]);
    expect(areaStyle("light").multiplier).toBe(1.5);
    expect(areaStyle("dark").multiplier).toBe(2);
    expect(AREA_KINDS.light.label).toBe("light");
    expect(AREA_KINDS.dark.label).toBe("dark");
    // Light is the easy, low-pay tier; dark the high one.
    expect(areaStyle("light").multiplier).toBeLessThan(areaStyle("dark").multiplier);
  });

  it("reads the retired keyword kinds: var as light, let and const as dark", () => {
    expect(normalizeAreaKind("light")).toBe("light");
    expect(normalizeAreaKind("dark")).toBe("dark");
    expect(normalizeAreaKind("dark")).toBe("dark");
    expect(normalizeAreaKind("light")).toBe("light");
    expect(normalizeAreaKind("dark")).toBe("dark");
    // A map still carrying a 3x const box pays dark's 2x, not a crash or a 1x.
    expect(areaStyle("dark").multiplier).toBe(2);
    expect(areaStyle("light").multiplier).toBe(1.5);
  });

  it("gives each tier a snippet that says to lock a ball, with its own pay", () => {
    for (const kind of ["light", "dark"] as const) {
      const lines = areaSnippet(kind);
      const text = lines.map(l => l.map(tok => tok.text).join("")).join("\n");
      expect(text).toContain("<lock ball=\"1\">");
      expect(text).toContain("</lock>");
      expect(text).toContain(`x="${AREA_KINDS[kind].multiplier}"`);
      // Every token, waiting or locked, names a colour the kind's theme defines.
      for (const tok of [...lines.flat(), ...areaSnippet(kind, true).flat()]) {
        expect(AREA_KINDS[kind].theme[tok.role]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // Light is a light editor, dark a dark one.
    expect(AREA_KINDS.light.theme.background).toBe("#f6f8fa");
    expect(AREA_KINDS.dark.theme.background).toBe("#1e1e1e");
  });
});

describe("pointInArea / coloredAreaAt", () => {
  const a = area(500, 45, 355, 335, "light");
  it("detects inside, outside, and the boundary", () => {
    expect(pointInArea(600, 200, a)).toBe(true);
    expect(pointInArea(400, 200, a)).toBe(false); // left of it
    expect(pointInArea(500, 45, a)).toBe(true);    // top-left corner
    expect(pointInArea(855, 380, a)).toBe(true);   // bottom-right corner
  });
  it("coloredAreaAt returns the containing area or null", () => {
    expect(coloredAreaAt(600, 200, [a])?.kind).toBe("light");
    expect(coloredAreaAt(100, 100, [a])).toBeNull();
  });
});

describe("coloredAreaMultiplierAt", () => {
  it("returns the kind multiplier inside, 1 outside, max when overlapping", () => {
    expect(coloredAreaMultiplierAt(600, 200, [area(500, 45, 355, 335, "light")])).toBe(1.5);
    expect(coloredAreaMultiplierAt(100, 100, [area(500, 45, 355, 335, "light")])).toBe(1);
    const overlap = [area(0, 0, 300, 300, "light"), area(100, 100, 300, 300, "dark")];
    expect(coloredAreaMultiplierAt(150, 150, overlap)).toBe(2); // inside both -> max (dark)
  });
});

describe("regionWithinAreas (boss fenced-into-area win, level-10 fix)", () => {
  // A 900x900 board grid; a var area filling the top-right quadrant.
  const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
  const a = area(450, 0, 450, 450, "light");
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
  const a = area(0, 0, 60, 60, "light"); // 4x4 = 16 cells (centres 7.5, 22.5, 37.5, 52.5)
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

describe("gate vs bonus areas", () => {
  const gate = area(0, 0, 300, 300, "light");
  const bonus: ColoredArea = { ...area(400, 400, 200, 200, "dark"), required: false };

  it("treats an area as a win gate unless it opts out", () => {
    expect(isGateArea(gate)).toBe(true);
    expect(isGateArea({ ...gate, required: true })).toBe(true);
    expect(isGateArea(bonus)).toBe(false);
  });

  it("gateAreas drops bonus pockets, so a bonus-only map has no gate", () => {
    expect(gateAreas([gate, bonus])).toEqual([gate]);
    expect(gateAreas([bonus])).toEqual([]);
  });

  it("still pays the kind multiplier inside a bonus pocket", () => {
    // The greed hook: locking here pays 2x even though it gates nothing.
    expect(coloredAreaMultiplierAt(500, 500, [bonus])).toBe(2);
    expect(coloredAreaMultiplierAt(700, 700, [bonus])).toBe(1);
  });

  it("keeps the bonus flag through a rotation", () => {
    const r = rotateColoredArea(bonus, 1);
    expect(r.required).toBe(false);
    expect(r.kind).toBe("dark");
    expect(isGateArea(r)).toBe(false);
  });
});

describe("makeColoredArea (map-editor default)", () => {
  it("sizes light bigger than dark, never below the minimum", () => {
    const sizes = (["light", "dark"] as const).map(k => makeColoredArea(k).width);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThanOrEqual(AREA_MIN_SIZE);
  });

  it("keeps the rect on the board and offsets each additional area", () => {
    for (const kind of ["light", "dark"] as const) {
      for (let i = 0; i < 6; i++) {
        const a = makeColoredArea(kind, i);
        expect(a.kind).toBe(kind);
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width).toBeLessThanOrEqual(BOARD_WIDTH);
        expect(a.y + a.height).toBeLessThanOrEqual(BOARD_HEIGHT);
      }
    }
    // A second area doesn't land exactly on the first.
    const first = makeColoredArea("dark", 0);
    const second = makeColoredArea("dark", 1);
    expect(second.x !== first.x || second.y !== first.y).toBe(true);
  });
});

describe("rotateColoredArea", () => {
  it("is a no-op at rotation 0", () => {
    const a = area(500, 45, 355, 335, "light");
    expect(rotateColoredArea(a, 0)).toBe(a);
  });
  it("rotates the rect and keeps the kind", () => {
    const a = area(500, 0, 300, 40, "dark");
    const r = rotateColoredArea(a, 1); // 90 left: width/height swap
    expect(r.kind).toBe("dark");
    expect(r.width).toBeCloseTo(40);
    expect(r.height).toBeCloseTo(300);
  });
});

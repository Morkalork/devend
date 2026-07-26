import { describe, it, expect } from "vitest";
import {
  AREA_KINDS,
  areaStyle,
  pointInArea,
  coloredAreaAt,
  coloredAreaMultiplierAt,
} from "@/lib/coloredAreas";
import { rotateColoredArea } from "@/lib/mapRotation";
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

/**
 * The ability glyphs behind the canvas AbilityIcon (src/ui/game/AbilityIcon.tsx).
 * One map, exhaustive over every kind, with a placeholder for an unknown one.
 */
import { describe, it, expect } from "vitest";
import { Snowflake, Snail, Hourglass, Scissors, Eraser, Magnet, Spline, Shield, Sparkles } from "lucide-react";
import { ABILITY_KINDS } from "@/lib/abilities";
import { abilityGlyph } from "@/ui/game/bottomModel";
import { iconNodeOf } from "@/ui/kit/icons";

describe("every effect kind has a glyph", () => {
  it.each(ABILITY_KINDS.map(k => [k]))("%s draws something", (kind) => {
    const g = abilityGlyph(kind);
    expect(g, `${kind} fell through to the placeholder`).not.toBe(Sparkles);
    expect(iconNodeOf(g).length, `${kind} draws nothing`).toBeGreaterThan(0);
  });

  it("uses the same lucide choices as the DOM", () => {
    expect(abilityGlyph("freeze")).toBe(Snowflake);
    expect(abilityGlyph("slow")).toBe(Snail);
    expect(abilityGlyph("slowArea")).toBe(Hourglass);
    expect(abilityGlyph("descope")).toBe(Scissors);
    expect(abilityGlyph("clearFences")).toBe(Eraser);
    expect(abilityGlyph("magnet")).toBe(Magnet);
    expect(abilityGlyph("rubberBand")).toBe(Spline);
    expect(abilityGlyph("fenceShield")).toBe(Shield);
  });

  it("draws the two custom glyphs as SVG nodes", () => {
    expect(Array.isArray(abilityGlyph("shockwave"))).toBe(true);
    expect(Array.isArray(abilityGlyph("fenceRush"))).toBe(true);
  });

  it("falls back to a sparkle, not nothing, for a kind it does not know", () => {
    expect(abilityGlyph("noSuchKind")).toBe(Sparkles);
  });
});

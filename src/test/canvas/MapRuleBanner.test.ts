/**
 * The canvas map-rule banner states the rule the way the DOM one did
 * (mapRuleBanner.test.tsx), checked against its text model and its source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { ActiveMapMutator } from "@/types/mapMutator";
import { ANNOUNCE_MS, mapRuleText } from "@/ui/game/mapRuleModel";

const t = i18n.t.bind(i18n);

const GRAVITY: ActiveMapMutator = {
  id: "gravity_well",
  name: "Technical Gravity",
  description: "Everything is pulled one way, and the way keeps changing.",
  behavior: "gravity",
};

const CRUNCH: ActiveMapMutator = {
  id: "crunch", name: "Crunch", description: "The board speeds up per lock.", behavior: "crunch",
};

describe("the map rule banner", () => {
  it("names the rule and says what it DOES while announcing", () => {
    const r = mapRuleText(t, GRAVITY, true)!;
    expect(r.name).toBe("Technical Gravity");
    expect(r.detail).toMatch(/pulled one way/i);
  });

  it("renders nothing at all on an ordinary map", () => {
    expect(mapRuleText(t, null, true)).toBeNull();
    expect(mapRuleText(t, undefined, false)).toBeNull();
  });

  it("is named for a reader who cannot see the colour", () => {
    expect(mapRuleText(t, GRAVITY, true)!.ariaLabel).toMatch(/map rule/i);
  });

  it("works for any mutator, not just the one that caused the report", () => {
    const r = mapRuleText(t, CRUNCH, true)!;
    expect(r.name).toBe("Crunch");
    expect(r.detail).toMatch(/speeds up per lock/i);
  });

  it("never truncates the sentence it exists to deliver", () => {
    expect(mapRuleText(t, GRAVITY, true)!.detail).toBe(GRAVITY.description);
    // And the label that draws it wraps rather than running on one line.
    expect(readFileSync(resolve(process.cwd(), "src/ui/game/MapRuleBanner.tsx"), "utf8"))
      .toMatch(/<Label text=\{text\.detail\} wrap/);
  });

  it("collapses to the name alone once it has been read", () => {
    const r = mapRuleText(t, GRAVITY, false)!;
    expect(r.name, "the rule stopped being stated at all").toBe(GRAVITY.name);
    expect(r.detail, "the prose never collapsed").toBeNull();
  });

  it("announces for as long as the DOM banner did (5s)", () => {
    // The DOM original is gone; its value is pinned here instead.
    expect(ANNOUNCE_MS).toBe(5000);
  });
});

describe("the component", () => {
  const src = readFileSync(resolve(process.cwd(), "src/ui/game/MapRuleBanner.tsx"), "utf8");

  it("leads to the explanation in both states", () => {
    expect((src.match(/onTap=\{onExplain\}/g) ?? []).length).toBe(2);
  });

  it("announces again on the next map rather than starting collapsed", () => {
    // The announce timer is keyed on the mutator.
    expect(src).toMatch(/setAnnouncing\(true\);[\s\S]*?ANNOUNCE_MS\);[\s\S]*?\}, \[mutator\]\);/);
  });
});

/**
 * A gate area on a map that authored its own win, and the comment that a save
 * eats.
 *
 * Both came out of one phone edit: a second coloured area added to level 5 from
 * the in-browser builder, to make areas pay more.
 *
 * ── The gate that gates nothing ────────────────────────────────────────────
 *
 * `required` defaults to true, so an area added without the flag is a GATE. But
 * `resolveWinSpec` returns an authored `win:` BEFORE it looks at gate areas, so
 * on a map with a win block that gate decides nothing - and it is invisible in
 * both directions:
 *
 *   gates the win           no, the spec never asked for an `area` clause
 *   pays its multiplier     yes, areaForLock does not read the flag
 *   listed as a requirement no, correctly
 *   listed as a bonus       NO - the criteria filter bonuses on required === false
 *
 * A pay pocket the game never mentions, found only by accident, which defeats
 * the point of adding it. And a trap for later: delete that map's `win:` and the
 * area silently becomes the map's SOLE win condition, replacing space and smash
 * and everything else.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import { gateAreas } from "@/lib/coloredAreas";
import type { LevelConfig, LevelData } from "@/types/level";

const RAW = readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8");
const LEVELS = (yaml.load(RAW) as LevelData).levels as LevelConfig[];

describe("an area on a map that states its own win", () => {
  it("is a bonus unless the win block asks for an area", () => {
    const offenders = LEVELS.filter(lv => {
      if (!lv.win) return false;                       // derived specs gate legitimately
      if (gateAreas(lv.coloredAreas ?? []).length === 0) return false;
      return !(lv.win.require ?? []).some(c => c.kind === "area");
    }).map(lv => lv.id);

    expect(
      offenders,
      "these carry a gate area the win never asks for: it pays, gates nothing, "
      + "and is announced to the player as neither a requirement nor a bonus",
    ).toEqual([]);
  });

  it("is the rule, not an accident of today's ladder", () => {
    // The check above passes trivially if no map has areas at all.
    const withAreas = LEVELS.filter(lv => (lv.coloredAreas ?? []).length > 0);
    expect(withAreas.length, "no map has a coloured area, so nothing was checked")
      .toBeGreaterThan(3);
  });

  it("makes an area clause satisfiable: if the win asks for one, a gate exists", () => {
    // The other half of the pairing. The first test catches a gate with no
    // clause; this catches a clause with no gate, which is worse - `areaTargets`
    // only ever counts targets inside a GATE area, so an `area` clause on a map
    // whose areas are all `required: false` can never be met and the map is
    // unwinnable. Levels 8 and 34 are the two that state an area clause.
    for (const lv of LEVELS) {
      if (!resolveWinSpec(lv, NO_RUN_RULES).require.some(c => c.kind === "area")) continue;
      expect(gateAreas(lv.coloredAreas ?? []).length, lv.id).toBeGreaterThan(0);
    }
  });

  it("still gates on the area when a map states no win of its own", () => {
    // The derived gate branch, which today's ladder never reaches on a non-boss
    // map - so it is pinned against a real level rather than left to chance.
    // Level 8 with its `win:` removed is exactly the trap in the header: strip
    // the block and the area stops being one clause among two and becomes the
    // map's SOLE win, dropping the 19% space clear entirely.
    const l8 = LEVELS.find(lv => lv.id === "level-8")!;
    expect(gateAreas(l8.coloredAreas ?? []).length, "level 8 lost its gate area")
      .toBeGreaterThan(0);

    const authored = resolveWinSpec(l8, NO_RUN_RULES);
    expect(authored.require.map(c => c.kind)).toEqual(["space", "area"]);

    const derived = resolveWinSpec({ ...l8, win: undefined }, NO_RUN_RULES);
    expect(derived.authored).toBe(false);
    expect(derived.require).toEqual([{ kind: "area", count: 1 }]);
  });

  it("puts the boss before the gate, so a fenced boss is not a free win", () => {
    // The exclusion the derived branch above would otherwise need, and the
    // reason it is worth a test of its own: every boss is fenced into a var
    // zone, so the gate branch used to match first and every boss on the ladder
    // won through `area count 1` - which counts ANY target locked inside, not
    // the boss being beaten.
    for (const lv of LEVELS.filter(l => l.boss)) {
      expect(resolveWinSpec(lv, NO_RUN_RULES).require.some(c => c.kind === "boss"), lv.id).toBe(true);
    }
  });

  it("keeps an authored win authoritative, which is why the rule is needed", () => {
    const l5 = LEVELS.find(lv => lv.id === "level-5")!;
    const spec = resolveWinSpec(l5, NO_RUN_RULES);
    expect(spec.authored).toBe(true);
    expect(spec.require.some(c => c.kind === "area"), "level 5 grew an area clause").toBe(false);
  });
});

describe("rationale the builder would delete", () => {
  /**
   * The builder splices only the level it edited, re-dumping that entry from the
   * parsed object - so a comment inside a level's body does not survive an edit
   * to that level. It goes silently, because the game loads a comment-free
   * map.yml perfectly well.
   */
  it("lives in the guidelines, where no tool rewrites it", () => {
    const doc = readFileSync(resolve(process.cwd(), "MAP_DESIGN_GUIDELINES.md"), "utf8");
    expect(doc).toContain("The shape every content map uses");
    expect(doc).toContain("A gate area on a map that authored its own win");
    // The sentence a phone edit to level 5 actually deleted.
    expect(doc).toMatch(/a space\s*\n?clause is met as a CONSEQUENCE of the last lock/);
  });

  it("warns the next author where NOT to write it", () => {
    const doc = readFileSync(resolve(process.cwd(), "MAP_DESIGN_GUIDELINES.md"), "utf8");
    expect(doc).toMatch(/Write this rationale HERE, not in `map\.yml`/);
  });
});

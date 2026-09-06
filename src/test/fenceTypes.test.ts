/**
 * Step 1 of FENCE_TYPES_PLAN: a fence remembers what KIND it is.
 *
 * Nothing plays differently yet - no build speed, no speed step, no drill. This
 * is the plumbing, and the plumbing is where this feature can go quietly wrong:
 * a type that is read from the player's CURRENT selection instead of carried on
 * the fence would mean switching slots retroactively changed every fence on the
 * board, and a type lost at completion would mean the whole system worked right
 * up until the cut finished.
 *
 * The other half is the promise that owning none of this changes nothing. A
 * standard fence must render through the SAME expressions it always did, and a
 * wall from a save that predates the feature must read as standard rather than
 * as undefined.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  getAllFenceTypes, getFenceType, standardFenceType, isKnownFenceType,
  applyFenceCatalogue, STANDARD_FENCE_ID, FENCE_SLOTS, FENCE_SOURCES,
} from "@/lib/fences";
import { PALETTE } from "@/lib/rendering/sleek/palette";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the catalogue", () => {
  it("loads every type the YAML declares", () => {
    const raw = yaml.load(read("public/fences.yml")) as { fences: { id: string }[] };
    const ids = getAllFenceTypes().map(f => f.id);
    expect(ids.sort()).toEqual(raw.fences.map(f => f.id).sort());
  });

  it("puts standard first, always", () => {
    // Slot 1 holds it and cannot unequip it, so a catalogue that buried it
    // would put the ordinary fence somewhere the player has to go looking.
    expect(getAllFenceTypes()[0].id).toBe(STANDARD_FENCE_ID);
  });

  it("hoists standard even when the YAML lists it last", () => {
    // The version above passes on the shipped file no matter what the code
    // does, because the file happens to declare standard first - so it cannot
    // tell a guarantee from a coincidence. This can.
    applyFenceCatalogue([
      'fences:',
      '  - id: ice',
      '    color: "#7fd4ff"',
      '  - id: standard',
      '    color: "#00ff88"',
      '    buildSpeed: 1',
    ].join("\n"));
    expect(getAllFenceTypes().map(f => f.id)).toEqual([STANDARD_FENCE_ID, "ice"]);
    expect(getAllFenceTypes().filter(f => f.id === STANDARD_FENCE_ID),
      "standard was hoisted AND left in place, so it appears twice").toHaveLength(1);
    applyFenceCatalogue(read("public/fences.yml"));
  });

  it("never returns undefined, whatever it is asked", () => {
    // Every caller is on a path that HAS to draw a fence. A stale save, a slot
    // holding a retired type, a typo in a store card: all of them degrade to an
    // ordinary fence rather than to a crash or an invisible one.
    expect(getFenceType(undefined).id).toBe(STANDARD_FENCE_ID);
    expect(getFenceType(null).id).toBe(STANDARD_FENCE_ID);
    expect(getFenceType("").id).toBe(STANDARD_FENCE_ID);
    expect(getFenceType("no-such-fence").id).toBe(STANDARD_FENCE_ID);
    expect(isKnownFenceType("no-such-fence")).toBe(false);
  });

  it("survives a malformed catalogue", () => {
    // A bad fences.yml must cost the tuning it names, not the game.
    applyFenceCatalogue("this: is: not: valid: yaml:");
    expect(standardFenceType().id).toBe(STANDARD_FENCE_ID);
    applyFenceCatalogue("fences: []");
    expect(standardFenceType().id).toBe(STANDARD_FENCE_ID);
    // And a catalogue that simply forgets standard still has one.
    applyFenceCatalogue('fences:\n  - id: ice\n    color: "#7fd4ff"\n');
    expect(standardFenceType().id).toBe(STANDARD_FENCE_ID);
    expect(getFenceType("ice").id).toBe("ice");
    applyFenceCatalogue(read("public/fences.yml"));   // restore for the rest of the file
    expect(getAllFenceTypes().length).toBeGreaterThan(3);
  });

  it("clamps a build speed that would break a cut", () => {
    applyFenceCatalogue('fences:\n  - id: broken\n    color: "#ffffff"\n    buildSpeed: 0\n');
    expect(getFenceType("broken").buildSpeed, "a zero-speed fence never finishes")
      .toBeGreaterThan(0);
    applyFenceCatalogue('fences:\n  - id: broken\n    color: "#ffffff"\n    buildSpeed: -3\n');
    expect(getFenceType("broken").buildSpeed, "a negative-speed fence grows backwards")
      .toBeGreaterThan(0);
    applyFenceCatalogue(read("public/fences.yml"));
  });

  it("names a real source for every type", () => {
    for (const f of getAllFenceTypes()) {
      expect(FENCE_SOURCES, `${f.id} comes from nowhere`).toContain(f.source);
    }
    expect(standardFenceType().source, "standard has to be free").toBe("always");
  });

  it("has words for every type", () => {
    // The bar is long-pressable and the modal is the only place a type is
    // explained. A type with no description is a button with no meaning.
    for (const f of getAllFenceTypes()) {
      expect(f.description, `${f.id} has no description`).toBeTruthy();
      expect(f.howTo, `${f.id} has no howTo`).toBeTruthy();
    }
  });
});

describe("owning none of this changes nothing", () => {
  it("gives standard the colour the renderer already draws", () => {
    // This is what lets wallLayer treat standard as a no-op branch rather than
    // routing it through the tint path and hoping the result matches. If these
    // ever diverge, every existing fence quietly changes colour.
    const hex = Number.parseInt(standardFenceType().color.replace("#", ""), 16);
    expect(hex).toBe(PALETTE.accent);
  });

  it("renders standard through the untinted expressions", () => {
    const src = read("src/lib/rendering/sleek/wallLayer.ts");
    expect(src, "the standard fence lost its own path")
      .toMatch(/fenceTypeId === STANDARD_FENCE_ID\) return null/);
    expect(src, "the untinted accent core is gone")
      .toContain("mix(PALETTE.accentDim, PALETTE.accent, 0.3 * amb)");
  });

  it("costs standard nothing", () => {
    const s = standardFenceType();
    expect(s.buildSpeed, "the ordinary fence stopped building at full speed").toBe(1);
    expect(s.ballSpeedStep).toBe(0);
    expect(s.maxHits).toBeUndefined();
    expect(s.anchorOnBreakable).toBe(false);
    expect(s.drillDamage).toBe(0);
  });
});

describe("the type travels with the fence, not with the player", () => {
  it("is read once when the cut starts", () => {
    // Switching slots mid-growth must not change a fence already on its way, or
    // the thing you drew is not the thing you chose.
    const src = read("src/hooks/useGameInput.ts");
    expect(src).toMatch(/fenceTypeId:\s*game\.selectedFenceTypeId \?\? STANDARD_FENCE_ID/);
  });

  it("is copied onto every segment at completion", () => {
    // A cut becomes N walls. The GrowingWall is gone after that, so a type left
    // behind at completion is a type that worked until the fence finished.
    const src = read("src/lib/physics/applyCut.ts");
    const add = src.slice(src.indexOf("const addSegmentWalls"), src.indexOf("addSegmentWalls(wall.startWaypoints)"));
    expect(add, "segments no longer carry the type")
      .toMatch(/fenceTypeId: wall\.fenceTypeId \?\? STANDARD_FENCE_ID/);
  });

  it("lets a type's durability override the run's, and only when it states one", () => {
    // A type that says nothing about hits must not wipe out an Ascension
    // durability bonus the player earned.
    const src = read("src/lib/physics/applyCut.ts");
    expect(src).toMatch(/getFenceType\(wall\.fenceTypeId\)\.maxHits/);
    expect(src).toMatch(/typeHits \?\? game\.fenceDurability/);
  });
});

describe("the slot count", () => {
  it("is five, and is its own number", () => {
    // The same as MAX_ABILITY_SLOTS today and deliberately not shared with it:
    // two bars that happen to agree, and an ascension rule tightening one must
    // not silently tighten the other.
    expect(FENCE_SLOTS).toBe(5);
    // Checked as "does not IMPORT it". The doc comment names MAX_ABILITY_SLOTS
    // on purpose, to say why they are apart, so a whole-file grep would forbid
    // the explanation along with the coupling.
    const src = read("src/lib/fences.ts");
    expect(src, "the fence bar was coupled to the ability bar")
      .not.toMatch(/^import .*MAX_ABILITY_SLOTS/m);
    expect(src, "the fence bar imports from the ability catalogue at all")
      .not.toMatch(/^import .* from "@\/lib\/abilities"/m);
  });
});

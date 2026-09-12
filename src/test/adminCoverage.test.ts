/**
 * Whatever changes how the game plays must be reachable from Admin.
 *
 * The rule (CLAUDE.md, "Admin must be able to test it") exists because of how
 * things went without it: shifting gravity shipped behind a URL parameter
 * nobody knew to type, board edges and pinned mutators were authored straight
 * into map.yml with no editor, and a 5% mechanic could only be confirmed by
 * playing until it happened. Each of those was correct code that could not be
 * looked at.
 *
 * Source checks, on purpose: rendering the admin screens boots a game canvas,
 * and none of this is behaviour a render would show. It is "does a control for
 * this exist", which is exactly the class of gap that kept opening.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const PLAYGROUND = read("src/components/admin/PlaygroundScreen.tsx");
const ADMIN = read("src/components/admin/AdminScreen.tsx");
const LEVEL_PANEL = read("src/components/admin/LevelPanel.tsx");
const ENTITY_PANEL = read("src/components/admin/EntityPanel.tsx");
const DEV_FLAGS = read("src/lib/devFlags.ts");
const LEVEL_TYPES = read("src/types/level.ts");

describe("every modifier has a Playground knob", () => {
  // The MODIFIER_META table is typed Record<keyof GameModifiers, ...>, so a
  // missing key is a compile error. What the compiler cannot see is an entry
  // with nothing in it: a knob with no label or description is a knob nobody
  // can find or understand.
  const meta = PLAYGROUND.slice(PLAYGROUND.indexOf("const MODIFIER_META"));
  for (const key of Object.keys(DEFAULT_MODIFIERS)) {
    it(`${key} is labelled and described`, () => {
      const m = meta.match(new RegExp(`^\\s{2}${key}:\\s*\\{([^}]*)\\}`, "m"));
      expect(m, `${key} has no MODIFIER_META entry`).not.toBeNull();
      expect(m![1]).toMatch(/label:\s*'[^']+'/);
      expect(m![1]).toMatch(/description:\s*'[^']+'/);
    });
  }

  it("lets a chance-based mechanic be forced, not merely nudged", () => {
    // The knobs are plain number inputs with a min and no max, so 100 can be
    // typed. If someone ever adds a max, this is the one that must stay open.
    const entry = meta.match(/^\s{2}bugSquashChance:\s*\{([^}]*)\}/m)![1];
    expect(entry).not.toMatch(/max:/);
  });
});

describe("every URL dev flag has an admin control", () => {
  // A flag is a parse<Name>Param in devFlags.ts. Its live getter must be set
  // by something in Admin or the Playground - i.e. a session override setter
  // exists AND is called from one of the two screens.
  const flags = [...DEV_FLAGS.matchAll(/export function parse(\w+)Param\(/g)].map(m => m[1]);

  it("is checking a real set of flags", () => {
    expect(flags.length).toBeGreaterThanOrEqual(3);
  });

  for (const flag of flags) {
    it(`?${flag.toLowerCase()} can be set from a screen, not only the address bar`, () => {
      // Any set...Override naming the flag: setDebugMutatorOverride,
      // setForcedTiltsOverride, setDebugAscensionOverride.
      const setter = new RegExp(`set\\w*${flag}\\w*Override\\(`);
      expect(DEV_FLAGS, `no session override setter for ${flag}`).toMatch(setter);
      expect(PLAYGROUND + ADMIN, `nothing in Admin calls the ${flag} override`).toMatch(setter);
    });
  }
});

describe("every level field has a Map Builder editor", () => {
  /**
   * Structured fields with their own editor elsewhere, or authored in YAML by
   * design. Each carries the reason. This list may only SHRINK: a new scalar
   * field goes in LevelPanel, and a new structured one gets an EntityPanel
   * editor or an argued entry here.
   */
  const AUTHORED_ELSEWHERE: Record<string, string> = {
    level:            "assigned by position in the ladder, not edited",
    entities:         "EntityPanel",
    balls:            "legacy per-ball config; maxBalls + ballTypeIds replaced it",
    ballTypeIds:      "the Playground's Balls picker sets it as an override",
    coloredAreas:     "drawn on the MapCanvas",
    gravityWells:     "drawn on the MapCanvas",
    fenceZones:       "drawn on the MapCanvas",
    pickupSpots:      "curated spawn anchors; authored in YAML until a canvas tool exists",
    slots:            "procedural obstacle slots; authored in YAML",
    boss:             "boss maps are set pieces authored in YAML",
    beats:            "scripted turns; authored in YAML",
    circuit:          "terminals + wire; authored in YAML",
    charges:          "deploy charges; authored in YAML",
    dataStream:       "seam polyline; authored in YAML",
    win:              "WinConditionsPanel",
    threadLockRequired: "legacy: superseded by the win spec",
    fenceBudget:      "authored in YAML alongside the map's par",
  };

  const block = LEVEL_TYPES.slice(LEVEL_TYPES.indexOf("export interface LevelConfig"));
  const fields = [...block.slice(0, block.indexOf("\n}")).matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map(m => m[1]);

  it("is checking a real set of fields", () => {
    expect(fields.length).toBeGreaterThanOrEqual(25);
  });

  for (const field of fields) {
    it(`${field} is editable or accounted for`, () => {
      if (AUTHORED_ELSEWHERE[field]) return;
      // Read as level.<field>, written as `<field>:` in an update, or bound as
      // an OptionalNumber field - any of the three is an editor.
      const edited =
        new RegExp(`level\\.${field}\\b`).test(LEVEL_PANEL) ||
        new RegExp(`\\b${field}:`).test(LEVEL_PANEL) ||
        new RegExp(`field="${field}"`).test(LEVEL_PANEL) ||
        new RegExp(`level\\.${field}\\b`).test(ENTITY_PANEL);
      expect(edited, `LevelPanel has no editor for ${field}, and it is not in AUTHORED_ELSEWHERE`).toBe(true);
    });
  }

  it("keeps the exception list honest: every entry is a real field", () => {
    for (const name of Object.keys(AUTHORED_ELSEWHERE)) {
      expect(fields, `${name} is no longer a LevelConfig field; drop it from the list`).toContain(name);
    }
  });
});

describe("catalogue-driven pickers stay catalogue-driven", () => {
  it("the Map Builder's mutator picker reads mapMutators.yml, not a list", () => {
    expect(LEVEL_PANEL).toMatch(/getMapMutators\(\)/);
  });
  it("the Playground's mutator picker reads mapMutators.yml, not a list", () => {
    expect(PLAYGROUND).toMatch(/getMapMutators\(\)/);
  });
});

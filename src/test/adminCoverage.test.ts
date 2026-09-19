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
import { DEFAULT_LIGHT_LOOK } from "@/lib/lightLook";
import { DEFAULT_BALL_LOOK } from "@/lib/ballLook";

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

describe("every look dial has a Playground slider", () => {
  // A NEW CLASS of thing for this file, added with the four dials that made it
  // necessary. The rule in CLAUDE.md is about anything that changes how the
  // game plays, and a rendering dial does not - but the reason behind it does
  // apply: a light model with an unreachable term is a term nobody ever looks
  // at, which is how the ball gobo survived being obviously wrong for as long
  // as it did. Every dial must reach 0, so the before/after is a drag rather
  // than a rebuild, and every dial must be findable.
  //
  // The dials are the keys of the two look objects, so this cannot be
  // satisfied by remembering to update a list: adding a key to either
  // interface fails here until its slider exists.
  const dials: [string, string][] = [
    ...Object.keys(DEFAULT_LIGHT_LOOK).map(k => [k, `light-${kebab(k)}`] as [string, string]),
    ...Object.keys(DEFAULT_BALL_LOOK).filter(k => k !== "flicker")
      .map(k => [k, `ball-${kebab(k)}-strength`] as [string, string]),
  ];

  it("is checking a real set of dials", () => {
    expect(dials.length).toBeGreaterThanOrEqual(9);
  });

  for (const [key, id] of dials) {
    it(`${key} has a slider that reaches 0`, () => {
      expect(PLAYGROUND, `no input id="${id}"`).toContain(`id="${id}"`);
      // The setter must name this key, or the slider is wired to another dial.
      expect(PLAYGROUND).toMatch(new RegExp(`\\{\\s*${key}:\\s*Number\\(e\\.target\\.value\\)`));
      // min 0 on the input that owns this id: the block is written in one
      // shape throughout, so the id and its min sit within a few lines.
      const at = PLAYGROUND.indexOf(`id="${id}"`);
      expect(PLAYGROUND.slice(at, at + 220)).toMatch(/min=\{0\}/);
    });
  }

  it("the flicker is a toggle rather than a slider, and is still reachable", () => {
    expect(PLAYGROUND).toMatch(/setBallLook\(\{ flicker:/);
  });
});

/** `softShadows` -> `soft-shadows`, which is how the ids are spelled. */
function kebab(k: string): string {
  return k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

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

describe("a phone can reach the knobs", () => {
  // The Playground's dev controls collapse to one sheet below `lg`. The knobs
  // were unreachable from it whenever a level was selected, which is the
  // default, so on a phone the modifier table effectively did not exist.
  const start = PLAYGROUND.indexOf('aria-label="Playground controls"');
  const end = PLAYGROUND.indexOf("{/* Level picker modal */}", start);
  const sheet = PLAYGROUND.slice(start, end);

  it("opens the modifiers modal from the sheet, unconditionally", () => {
    expect(start).toBeGreaterThan(-1);
    expect(sheet).toContain("openModal()");
    const guard = sheet.indexOf("{!selectedLevel && (");
    if (guard >= 0) {
      const guarded = sheet.slice(guard, sheet.indexOf("\n              )}", guard));
      expect(guarded, "Modifiers is behind a level-selected guard").not.toContain("openModal()");
    }
  });

  it("lets a knob be found by name rather than by scrolling", () => {
    expect(PLAYGROUND).toMatch(/placeholder="Search modifiers"/);
    // The search reads label, description AND key, so "squash" finds Bug Squash
    // whichever of the three a tester remembers.
    expect(PLAYGROUND).toMatch(/meta\.label\.toLowerCase\(\)\.includes\(q\)/);
    expect(PLAYGROUND).toMatch(/meta\.description\.toLowerCase\(\)\.includes\(q\)/);
    expect(PLAYGROUND).toMatch(/key\.toLowerCase\(\)\.includes\(q\)/);
  });
});

/**
 * A new CLASS of thing appeared with two-player: something that only misbehaves
 * when there are two DEVICES, which is the one class the Playground's knobs
 * cannot reach. CLAUDE.md says to extend this file when that happens, so:
 *
 *   - anything that needs a second device gets a rig that fakes one, or a
 *     panel that says what the hardware is doing, and it is reachable from the
 *     admin screen;
 *   - because "did not desync" and "is not running" look identical from the
 *     outside, and so do "found nobody" and "was never allowed to look".
 */
describe("anything that needs a second device is testable without one", () => {
  const ADMIN = read("src/components/admin/AdminScreen.tsx");
  const LOOPBACK = read("src/components/admin/PairLoopbackPanel.tsx");
  const NEARBY = read("src/components/admin/NearbyDiagnosticsPanel.tsx");

  it("reaches both rigs from the admin screen", () => {
    expect(ADMIN, "Pair Loopback is not on the admin screen").toContain("onPairLoopback");
    expect(ADMIN, "Nearby Diagnostics is not on the admin screen").toContain("onNearbyDiagnostics");
  });

  it("runs two real simulations rather than a mock of one", () => {
    // A rig that faked the second board would pass whatever the first board
    // did, which is the opposite of the thing being tested.
    expect(LOOPBACK).toContain("createBotGame");
    expect(LOOPBACK).toContain("LockstepSession");
    expect(LOOPBACK).toContain("MemoryTransport");
  });

  it("can make the link bad on purpose", () => {
    // A mode that is only ever exercised on a perfect link is a mode whose
    // first real bug arrives in someone's living room.
    expect(LOOPBACK).toMatch(/latencyMs/);
    expect(LOOPBACK).toMatch(/jitterMs/);
    expect(LOOPBACK).toMatch(/loss/);
    expect(LOOPBACK, "there is no way to force a desync").toMatch(/forceDesync/);
  });

  it("shows whether the two boards still agree, and every repair", () => {
    expect(LOOPBACK).toContain("motionHash");
    expect(LOOPBACK).toContain("topologyHash");
    expect(LOOPBACK).toMatch(/BOARDS DISAGREE/);
    expect(LOOPBACK).toMatch(/resyncs/);
  });

  it("names the missing permission rather than just failing to find anyone", () => {
    expect(NEARBY).toContain("permissionState");
    expect(NEARBY, "the panel does not say which permission is missing")
      .toMatch(/bluetooth[\s\S]{0,200}wifi[\s\S]{0,200}location/);
    expect(NEARBY, "a build without the plugin looks the same as a failure")
      .toContain("isNearbyAvailable");
  });
});

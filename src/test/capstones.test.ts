import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { CapstoneConfig, CapstoneData } from "@/types/capstone";
import { drawCapstoneOffers, capstoneDueAfter, getCapstoneTriggerLevel } from "@/lib/capstones";
import { isAssignmentLevel, getDoorTriggerLevel } from "@/lib/doorDraft";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";

// Guard the capstone pool straight from the YAML source of truth.
const doc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/capstones.yml"), "utf8"),
) as CapstoneData;
const capstones = doc.capstones;

const VALID_KEYS = new Set(Object.keys(computeGameModifiers([], new Map())));
const VALID_TAGS = ["lock", "freeze", "bank", "tempo", "risk", "safety"];

describe("capstone pool integrity", () => {
  it("has at least 3 capstones (a 1-of-3 draft needs a full hand)", () => {
    expect(capstones.length).toBeGreaterThanOrEqual(3);
  });

  it("offers the draft at a sensible trigger level", () => {
    expect(doc.offeredAfterLevel).toBeGreaterThanOrEqual(2);
  });

  it("has unique ids", () => {
    const ids = capstones.map(c => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every capstone a name, description, valid tag and modifiers", () => {
    const offenders = capstones
      .filter(c =>
        !c.name || !c.description ||
        !c.modifiers || Object.keys(c.modifiers).length === 0 ||
        (c.tag != null && !VALID_TAGS.includes(c.tag)))
      .map(c => c.id);
    expect(offenders).toEqual([]);
  });

  it("gives every capstone a clarify blurb (shown in the hold-to-detail view)", () => {
    const offenders = capstones.filter(c => !c.clarify || c.clarify.trim().length === 0).map(c => c.id);
    expect(offenders).toEqual([]);
  });

  it("uses only known GameModifiers keys (typos would be silently ignored)", () => {
    const offenders: string[] = [];
    for (const c of capstones) {
      for (const key of Object.keys(c.modifiers)) {
        if (!VALID_KEYS.has(key)) offenders.push(`${c.id} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("covers every archetype so any build can find its crown", () => {
    // Deliberately uncrowned archetypes: tempo lost its capstone when Ghost
    // Protocol was cut. Listing an exception here is a design decision;
    // anything else missing is an accidental gap this test should catch.
    const UNCROWNED_TAGS = ["tempo"];
    const expected = VALID_TAGS.filter(t => !UNCROWNED_TAGS.includes(t)).sort();
    const tags = capstones.map(c => c.tag).filter(Boolean).sort();
    expect([...new Set(tags)]).toEqual(expected);
  });
});

describe("drawCapstoneOffers", () => {
  const mk = (id: string): CapstoneConfig => ({ id, name: id, description: "d", modifiers: { overtimeCapBonus: 1 } });
  const pool = ["a", "b", "c", "d", "e"].map(mk);

  it("draws n distinct capstones without mutating the pool", () => {
    const before = pool.map(c => c.id).join(",");
    for (let i = 0; i < 20; i++) {
      const drawn = drawCapstoneOffers(pool, 3);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn.map(c => c.id)).size).toBe(3);
    }
    expect(pool.map(c => c.id).join(",")).toBe(before);
  });

  it("clamps to the pool size", () => {
    expect(drawCapstoneOffers(pool, 10)).toHaveLength(5);
  });
});

/**
 * When the Promotion lands.
 *
 * Reported from a real session: finishing the level-10 boss handed the player a
 * score screen, a Feature Unlocked modal, the finished contract's summary, the
 * Promotion and the next contract, one after another - "it's too much bonus
 * stuff, they lose value". The Promotion is the rarest choice in the game (once
 * per run, the two you pass gone for good) and it was arriving fourth in a
 * queue, so it read as more confetti.
 *
 * It could not have been anywhere else: the draft was only reachable from
 * inside the assignment phase, so it was welded to an assignment level by
 * construction. It rides an ORDINARY level now, before that level's shop, and
 * that is what these pin. None of it was covered before - the whole reward
 * sequence moved without a single test noticing.
 */
describe("when the Promotion is offered", () => {
  const trigger = getCapstoneTriggerLevel();
  const LADDER = 40;

  it("is never due on an assignment level", () => {
    // The entire point. An assignment level already turns in one contract and
    // hands out the next; the Promotion has nothing to share it with.
    let checked = 0;
    for (let lv = 1; lv <= LADDER; lv++) {
      if (!isAssignmentLevel(lv)) continue;
      checked++;
      expect(capstoneDueAfter(lv), `level ${lv} is an assignment level`).toBe(false);
    }
    expect(checked, "no assignment levels exist, so this proved nothing").toBeGreaterThan(0);
  });

  it("is not due before the trigger level", () => {
    for (let lv = 1; lv < trigger; lv++) {
      expect(capstoneDueAfter(lv), `level ${lv} is before the trigger`).toBe(false);
    }
  });

  it("is due on the first ordinary level at or past the trigger", () => {
    let first = -1;
    for (let lv = trigger; lv <= LADDER && first < 0; lv++) {
      if (capstoneDueAfter(lv)) first = lv;
    }
    expect(first, "the draft is never offered at all").toBeGreaterThan(0);
    expect(isAssignmentLevel(first), `level ${first} is an assignment level`).toBe(false);
    // ...and nothing between the trigger and it was skipped for another reason.
    for (let lv = trigger; lv < first; lv++) {
      expect(isAssignmentLevel(lv), `level ${lv} was skipped but is ordinary`).toBe(true);
    }
  });

  it("stays due until it is taken, so a run can never miss it", () => {
    // offerCapstoneIfDue stops asking once a capstone is held; until then every
    // eligible level must still offer it, or a run that reached the trigger on
    // an odd cadence would silently never get one.
    const ordinary = [];
    for (let lv = trigger; lv <= LADDER; lv++) if (!isAssignmentLevel(lv)) ordinary.push(lv);
    expect(ordinary.length).toBeGreaterThan(0);
    for (const lv of ordinary) expect(capstoneDueAfter(lv), `level ${lv}`).toBe(true);
  });
});

describe("the authored trigger levels agree with each other", () => {
  const assignments = yaml.load(
    readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
  ) as { offeredAfterLevel: number };

  it("does not put the Promotion on an assignment level", () => {
    // capstoneDueAfter would push past it anyway, but then the authored number
    // would not be the level the draft actually appears on, and the next person
    // to tune it would be tuning a value the game ignores.
    const cadence = assignments.offeredAfterLevel;
    expect(cadence, "the assignment cadence is missing").toBeGreaterThan(0);
    expect(
      doc.offeredAfterLevel % cadence,
      `offeredAfterLevel ${doc.offeredAfterLevel} is a multiple of the ${cadence}-level assignment cadence`,
    ).not.toBe(0);
  });

  it("offers it after the first boss, not before", () => {
    // A run-defining perk drafted before the player has met a boss is drafted
    // blind: the build it is meant to crown does not exist yet.
    expect(doc.offeredAfterLevel).toBeGreaterThan(10);
  });
});

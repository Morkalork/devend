/**
 * Every id a map PINS has to name something.
 *
 * public/map.yml is loaded with js-yaml and cast to `LevelData`. That cast is
 * unchecked, so the type declaration is a statement of intent and nothing more:
 * a level can author any shape at all and TypeScript will agree with it.
 *
 * Level 34 is what that costs. It pinned `mutator: gravity` - the BEHAVIOR name
 * rather than the id of the entry that has that behavior (`gravity_well`) - and
 * the field was typed as a whole MapMutator, so the bare string was dropped
 * into `mapMutator` unresolved. Everything downstream reads properties off it:
 * the Specs card asked for `.id` and `.name` and got `undefined`, rendering its
 * violet border and wind icon above nothing at all, and GameCanvas asked
 * whether `.behavior === "gravity"` and got false, so the map authored around a
 * live pull never pulled. The map's own test asserted `.toBe("gravity")` and so
 * agreed with the bug rather than catching it.
 *
 * This is the check that survives all of that, because it resolves the id
 * instead of comparing it: an id is either in the catalogue or the pin is dead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { parseMutatorEntry } from "@/lib/mapMutators";
import { getBallType } from "@/lib/ballTypes";
import type { LevelData, LevelConfig } from "@/types/level";
import type { MapMutator } from "@/types/mapMutator";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

/**
 * The catalogue as the GAME would load it: the live pool is fetched at runtime
 * and so is empty here, and parsing by hand would accept entries the real
 * parser rejects.
 */
const CATALOGUE: MapMutator[] = (
  (yaml.load(
    readFileSync(resolve(process.cwd(), "public/mapMutators.yml"), "utf8"),
  ) as { mutators?: unknown[] }).mutators ?? []
).map(parseMutatorEntry).filter((m): m is MapMutator => !!m);

/** Every map that pins a mutator, plus every boss that forces one. */
const pinnedMutators: Array<{ level: LevelConfig; id: string; where: string }> = [];
for (const level of LEVELS) {
  if (level.mutator) pinnedMutators.push({ level, id: level.mutator, where: "mutator" });
  if (level.boss?.mutator) pinnedMutators.push({ level, id: level.boss.mutator, where: "boss.mutator" });
}

describe("a pinned mutator names a real one", () => {
  it("finds the pins it is meant to be checking", () => {
    // A sweep over an empty list passes forever, which is how the old assertion
    // stayed green. If nobody pins a mutator any more, this rule is dead code
    // and should be deleted rather than left looking like cover.
    expect(pinnedMutators.length, "no map pins a mutator any more").toBeGreaterThan(0);
  });

  it.each(pinnedMutators.map(p => [`${p.level.id} ${p.where}=${p.id}`, p] as const))(
    "%s resolves in mapMutators.yml",
    (_label, pin) => {
      const known = CATALOGUE.map(m => m.id);
      expect(known, `${pin.level.id} pins "${pin.id}", which is not a mutator id`)
        .toContain(pin.id);
    },
  );

  it("pins an id, never a behavior name", () => {
    // The exact confusion that produced the bug: the behaviors are crunch,
    // overclock and gravity; the ids are crunch, overclock and gravity_well.
    // Two of the three collide, so "it worked when I tried it" proves nothing.
    const behaviors = new Set<string>(CATALOGUE.map(m => m.behavior));
    const ids = new Set<string>(CATALOGUE.map(m => m.id));
    for (const pin of pinnedMutators) {
      if (behaviors.has(pin.id) && !ids.has(pin.id)) {
        throw new Error(
          `${pin.level.id} pins "${pin.id}", which is a behavior, not an id. `
          + `Use the id of the mutator that has it.`,
        );
      }
    }
  });

  it("is a string id, not an inline object", () => {
    // The type says string now; this is the part the type cannot enforce,
    // because the YAML cast is unchecked.
    for (const pin of pinnedMutators) {
      expect(typeof pin.id, `${pin.level.id} ${pin.where}`).toBe("string");
    }
  });
});

/**
 * The same class, for the other id a map can pin. `ballTypeIds` names entries
 * in balls.yml, and an id that resolves to nothing there silently shrinks the
 * roster - which on a map whose win condition names a ball makes it unwinnable.
 */
describe("a pinned ball roster names real ball types", () => {
  const rosters = LEVELS.filter(l => l.ballTypeIds?.length);

  it("finds the rosters it is meant to be checking", () => {
    expect(rosters.length, "no map pins a roster any more").toBeGreaterThan(0);
  });

  it.each(rosters.map(l => [l.id, l] as const))("%s resolves every ball it names", (_id, level) => {
    for (const ballId of level.ballTypeIds!) {
      expect(getBallType(ballId), `${level.id} names "${ballId}", which is not a ball type`)
        .toBeTruthy();
    }
  });
});

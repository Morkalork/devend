/**
 * Every map on the ladder states its own win.
 *
 * Act I was authored first and the other nineteen non-boss maps kept deriving
 * theirs, which left the LOCK RUSH open across most of the game: seal every
 * ball in the first few seconds and the map is over. A derived spec carries the
 * free `allLocked` alternative, and even without it sealing everything writes
 * the remaining board off as unreachable, so the space clause is satisfied by
 * the last lock rather than by any clearing. The rush is closed by asking for
 * something a lock cannot produce, and by nothing else.
 *
 * These are the act I guards widened to the whole ladder. They are about the
 * specs being HONEST rather than about difficulty: an unwinnable map is silent,
 * it simply never finishes, which is why winSpecProblems exists at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { resolveWinSpec, winSpecProblems } from "@/lib/winSpec";
import { gateAreas } from "@/lib/coloredAreas";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

/** Bosses state their win as the boss and are out of scope here. */
const PLAYABLE = LEVELS.filter(l => !l.boss && l.level != null);

const breakables = (l: LevelConfig) =>
  (l.entities ?? []).filter(e => e.kind === "wall" && e.breakable).length;
const terminals = (l: LevelConfig) => (l.circuit?.terminals ?? []).length;
const seams = (l: LevelConfig) => Math.max(0, (l.dataStream?.path?.length ?? 0) - 1);
const boxes = (l: LevelConfig) => (l.entities ?? []).filter(e => e.kind === "box").length;

describe("no map is left on the derivation", () => {
  it("covers every playable map", () => {
    expect(PLAYABLE.length, "the ladder shrank: is this reading the right file?")
      .toBeGreaterThan(25);
  });

  it.each(PLAYABLE.map(l => [l.level as number, l] as const))(
    "level %i authors its own win", (_n, level) => {
      expect(resolveWinSpec(level).authored, `${level.id} still derives its win`).toBe(true);
    });

  it.each(PLAYABLE.map(l => [l.level as number, l] as const))(
    "level %i keeps no free all-locked shortcut", (_n, level) => {
      // THE shortcut. An authored spec keeps no alternative unless it asks for
      // one, which is why authoring is the fix rather than a tidy-up.
      expect(resolveWinSpec(level).alsoWinIf, `${level.id} still offers a shortcut`)
        .toEqual([]);
    });

  it.each(PLAYABLE.map(l => [l.level as number, l] as const))(
    "level %i passes the authoring guard", (_n, level) => {
      expect(winSpecProblems(resolveWinSpec(level), level), level.id).toEqual([]);
    });
});

describe("the lock rush is closed everywhere it can be", () => {
  it.each(PLAYABLE.map(l => [l.level as number, l] as const))(
    "level %i asks for the content it carries", (_n, level) => {
      // Sealing every ball writes the whole board off as unreachable, so a
      // space clause is met as a CONSEQUENCE of the last lock, and a `locks`
      // count is met BY the rush. Only a clause a lock cannot produce closes
      // it, and a map can only ask for what it carries.
      //
      // A `required: false` area is a BONUS pocket by design and deliberately
      // not counted - misreading one must never cost anything.
      const offers =
        breakables(level) > 0 || gateAreas(level.coloredAreas ?? []).length > 0
        || terminals(level) > 0 || seams(level) > 0 || boxes(level) > 0;
      if (!offers) return;
      const uses = resolveWinSpec(level).require.some(c =>
        c.kind === "smashed" || c.kind === "area"
        || c.kind === "terminals" || c.kind === "harvested" || c.kind === "delivered");
      expect(uses, `${level.id} carries content its win never mentions`).toBe(true);
    });

  it.each(PLAYABLE.map(l => [l.level as number, l] as const))(
    "level %i does not price a clean clear out of a map that closes the rush",
    (_n, level) => {
      // The other direction, and the one that cost a shipped mission.
      //
      // Ship It pays for clearing a map without sealing a single ball, and
      // blockSpaceWinnableMaps drops the assignment from any block whose maps
      // all demand a lock. Adding `locks` to every map on the ladder made that
      // every block, so the mission could never be offered again - a whole
      // piece of content deleted by a clause that was closing nothing, because
      // the rush produces locks too.
      //
      // So a map that already closes the rush with content must not also carry
      // a lock count. The maps with nothing operable are exempt: `locks` is the
      // only ask they have, and the list below is what that costs.
      // Act IV is the priced-win act by design (actFour.test.ts pins it): its
      // maps combine, so they ask for the content AND a graded lock, and Ship
      // It is deliberately dropped from that block rather than offered as a
      // mission with one eligible map. That is a stated design position, so it
      // is exempted here by name instead of quietly satisfying the rule.
      if ((level.level as number) >= 31) return;
      const spec = resolveWinSpec(level);
      const closesTheRush = spec.require.some(c =>
        c.kind === "smashed" || c.kind === "terminals" || c.kind === "harvested");
      if (!closesTheRush) return;
      const pricesALock = spec.require.some(c =>
        (c.kind === "locks" && c.count > 0) || c.kind === "superiorLocks" || c.kind === "lockType");
      expect(pricesALock, `${level.id} closes the rush AND still bills a lock`).toBe(false);
    });
});

/**
 * The maps that CANNOT close the rush, listed rather than skipped silently.
 *
 * Their only content is a bonus pocket plus terrain - mirrors, wells, fence
 * grounds - and terrain deliberately has no clause: there is no state saying
 * whether you engaged with a wall that bounced a ball. They ask for locks,
 * which closes blind clearing, and that is all a map with nothing operable can
 * honestly ask.
 *
 * Pinned as a LIST so the number can only come down. Giving one of them
 * something to operate, or promoting its bonus pocket to a gate, is a design
 * decision that should show up here rather than drift in.
 */
describe("the maps with nothing a lock cannot produce", () => {
  it("is this exact set", () => {
    const bare = PLAYABLE.filter(l =>
      breakables(l) === 0 && gateAreas(l.coloredAreas ?? []).length === 0
      && terminals(l) === 0 && seams(l) === 0 && boxes(l) === 0
    ).map(l => l.level as number);
    expect(bare.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 14, 17, 21, 22, 24, 28, 33]);
  });
});

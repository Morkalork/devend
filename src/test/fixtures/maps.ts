/**
 * The map sets a test can read, and the rule for choosing.
 *
 * The ladder was started over for the brick pivot (BRICKS_PLAN.md), so
 * `public/map.yml` is a handful of maps and almost every mechanic the engine
 * has is on no shipped map. The engine still has those mechanics, and their
 * tests need a board to run on. The archived maps are that board.
 *
 *   LADDER       what the game actually loads and a player actually plays
 *   ARCHIVE      the 45 maps before the pivot (public/maps-archive.yml): not
 *                played in a run, but served, and opened in the Playground
 *   RETIRED      maps 11-35 of an earlier rebuild, kept only as engine fixtures
 *   ENGINE_MAPS  the archive and the retired maps, archive first
 *
 * A test about a MECHANIC ("does a one-way wall hold a ball in") reads
 * ENGINE_MAPS or ARCHIVE: it is asking about physics, and physics does not
 * care which file the board came from. A test about how the archived ladder
 * was DESIGNED ("every act closes with a boss") reads ARCHIVE, and keeps those
 * maps sound for as long as they can be opened. A test about what a player is
 * dealt reads LADDER.
 *
 * ENGINE_MAPS deliberately leaves the new ladder out: its level numbers start
 * again at 1, and `byLevel(ENGINE_MAPS, 2)` has to keep meaning the map those
 * tests were written against.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { LevelConfig, LevelData } from "@/types/level";

const HERE = dirname(fileURLToPath(import.meta.url));

function load(path: string): LevelConfig[] {
  const doc = yaml.load(readFileSync(path, "utf8")) as LevelData;
  return doc.levels as LevelConfig[];
}

/** The shipped ladder: what `useLevelManager` builds a run out of. */
export const LADDER: LevelConfig[] = load(resolve(HERE, "../../../public/map.yml"));

/** The 45 maps before the brick pivot: the Playground's archive, and the engine's test boards. */
export const ARCHIVE: LevelConfig[] = load(resolve(HERE, "../../../public/maps-archive.yml"));

/** Maps 11-35 before the rebuild. Not content, not playable, not a plan. */
export const RETIRED: LevelConfig[] = load(resolve(HERE, "retired-maps.yml"));

/** The highest level number the ladder currently reaches; it climbs as maps land. */
export const LADDER_END: number = Math.max(...LADDER.map(l => l.level ?? 0));

/** The highest level number in the archive. */
export const ARCHIVE_END: number = Math.max(...ARCHIVE.map(l => l.level ?? 0));

/** Every board an engine test may legitimately run against. */
export const ENGINE_MAPS: LevelConfig[] = [...ARCHIVE, ...RETIRED];

/** A map by its level number, from whichever set was passed. */
export function byLevel(levels: LevelConfig[], n: number): LevelConfig | undefined {
  return levels.find(l => l.level === n);
}

/** A map by id, or a thrown error naming the id - a silent undefined is worse. */
export function byId(levels: LevelConfig[], id: string): LevelConfig {
  const found = levels.find(l => l.id === id);
  if (!found) throw new Error(`no map "${id}" in this set (${levels.length} maps)`);
  return found;
}

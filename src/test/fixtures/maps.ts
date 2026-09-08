/**
 * The two map sets a test can read, and the rule for choosing.
 *
 * Act II onwards was scrapped for a rebuild, so `public/map.yml` is ten maps
 * and every mechanic that debuted above level 10 is on no shipped map at all.
 * The engine still has those mechanics, and the rebuild will use them, so their
 * tests need a board to run on. The retired maps are that board.
 *
 *   LADDER       what the game actually loads and a player actually plays
 *   RETIRED      maps 11-35 as they were, kept only as engine fixtures
 *   ENGINE_MAPS  both, ladder first
 *
 * A test about a MECHANIC ("does a one-way wall hold a ball in") reads
 * ENGINE_MAPS: it is asking about physics, and physics does not care which file
 * the board came from. A test about the LADDER ("every act closes with a boss",
 * "no mechanic debuts before its gate") reads LADDER, because a retired map
 * would answer it wrongly and hide the very gap the rebuild has to fill.
 *
 * Reading the wrong one fails quietly in both directions, which is why they are
 * separate exports rather than one default: a ladder test on ENGINE_MAPS passes
 * on a map nobody can play, and an engine test on LADDER goes vacuous the
 * moment its map is deleted - which is exactly what happened here.
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

/** Maps 11-35 before the rebuild. Not content, not playable, not a plan. */
export const RETIRED: LevelConfig[] = load(resolve(HERE, "retired-maps.yml"));

/**
 * The highest level number the ladder currently reaches.
 *
 * Not a constant to hardcode: act II onwards is being rebuilt one map at a
 * time, so this climbs. A ladder test that scopes itself with this re-arms by
 * itself as each map lands, instead of being edited twice per map.
 */
export const LADDER_END: number = Math.max(...LADDER.map(l => l.level ?? 0));

/** Every board an engine test may legitimately run against. */
export const ENGINE_MAPS: LevelConfig[] = [...LADDER, ...RETIRED];

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

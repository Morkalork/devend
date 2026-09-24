/**
 * Every map offers a superior pocket by design, and room to draw everywhere.
 *
 * Two items the authoring checklist used to leave to the eye, measured by
 * lib/admin/pocketProbe on the authored geometry: every straight fence a
 * player could start, traced as the game traces it, and the pockets it closes.
 *
 * THE POCKET. A superior lock is the lock economy's precision reward, and a map
 * offers one BY DESIGN when some nook closes with a single fence into a pocket
 * a ball fits in and that grades superior. (Two fences can box any corner of
 * any map; the one-fence pocket is the one the map authored.) Pinned at the
 * START of the map, where the lock rule's denominator is the whole board. The
 * checklist asked for the worst denominator (the board over the ball count,
 * late in a map), and when this was first measured only levels 1, 2, 6 and 8
 * met it: a three-ball map would need a nook under 1.33% of the board, which is
 * barely wider than a ball. The start is where a player can actually claim one.
 *
 * Maps without one are listed by name with their reason, and the list may only
 * shrink: a map whose precision reward lives somewhere else says so here.
 */
import { describe, it, expect } from "vitest";
import { LADDER } from "./fixtures/maps";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { probePockets, LANE_MIN_LENGTH } from "@/lib/admin/pocketProbe";
import type { LevelConfig } from "@/types/level";

const probe = (l: LevelConfig) =>
  probePockets(createInitialGameData({ ...l, neverRotates: true }, l.level, DEFAULT_MODIFIERS), l.maxBalls ?? 2);

/** Maps with no one-fence superior pocket, and where their precision reward is instead. */
const NO_SUPERIOR_NOOK: Record<string, string> = {
  "level-5": "the shard column is the whole subject; its smallest nook measured 4.58%",
  "level-10": "boss map: the pink box is the target, not a lock",
  "level-12": "the bumpers' bank is the map's reward, not a pocket",
  "level-13": "the box behind the mirror is the precision ask",
  "level-14": "bare by design, so the fall is the only thing to read",
  "level-16": "the divider is the map; nothing is meant to be sealed against a pillar",
  "level-17": "the demolition wall and the vault chest are its rewards",
  "level-18": "the windmill room pays triple, which is its precision reward",
  "level-19": "the pinwheel's four-fold symmetry leaves no nook by design",
};

describe("every map's authored pocket and lanes", () => {
  const results = LADDER.map(l => ({ l, p: probe(l) }));

  it("offers a one-fence superior pocket, or says where its reward is instead", () => {
    const missing = results
      .filter(({ l, p }) => !NO_SUPERIOR_NOOK[l.id]
        && !(p.smallestPocketPercent !== null && p.smallestPocketPercent <= p.superiorAtStartPercent))
      .map(({ l, p }) => `${l.id}: smallest one-fence pocket ${p.smallestPocketPercent?.toFixed(2) ?? "none"}%`);
    expect(missing).toEqual([]);
  });

  it("keeps the exception list honest: every listed map still lacks one", () => {
    // A map that gains a nook comes OFF the list, so the list only ever shrinks.
    for (const { l, p } of results.filter(({ l }) => NO_SUPERIOR_NOOK[l.id])) {
      const has = p.smallestPocketPercent !== null && p.smallestPocketPercent <= p.superiorAtStartPercent;
      expect(has, `${l.id} has a superior nook now; take it off the list`).toBe(false);
    }
    for (const id of Object.keys(NO_SUPERIOR_NOOK)) {
      expect(LADDER.some(l => l.id === id), `${id} is gone; take it off the list`).toBe(true);
    }
  });

  it(`leaves room to draw: a fence of ${LANE_MIN_LENGTH}+ through nearly all open ground`, () => {
    // Every map measured 99.9% or more when this was written. The floor is for
    // the map that turns into a maze of walls no fence can shape.
    const cramped = results.filter(({ p }) => p.lanePercent < 95)
      .map(({ l, p }) => `${l.id}: ${p.lanePercent.toFixed(1)}%`);
    expect(cramped).toEqual([]);
  });
});

/**
 * Everything a map puts in front of the player is either in its win, or is
 * named here as that map's greed hook.
 *
 * The rule a play review of the ladder came down to. The maps rated weakest
 * all showed something the win never asked for: a pink box on level 3 ("map 2
 * with a var area that isn't in the win condition"), two on level 5 ("weird
 * signals"), a chest on level 7 ("only shards in the AC, so why go for the
 * monolith"), a box and a chest on the level 9 skill check ("weird win
 * conditions"). A bright object on the board reads as an objective. When the
 * win ignores it, the map has made a promise with nothing behind it.
 *
 * The exception is a greed hook: something that pays for being taken and costs
 * nothing to skip, which is a real decision (MAP_DESIGN_GUIDELINES section
 * 6.2). Those are listed by name rather than allowed by rule, so a new one is a
 * decision someone made and not something an edit did quietly. Both lists may
 * only shrink, or grow with a reason written beside the entry.
 */
import { describe, it, expect } from "vitest";
import { LADDER } from "./fixtures/maps";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import type { LevelConfig } from "@/types/level";

type E = { id: string; brittle?: boolean; breakable?: boolean; chest?: boolean; reveals?: unknown };
const entities = (l: LevelConfig) => (l.entities ?? []) as unknown as E[];

/**
 * Breakables left out of the win on purpose, by map, with the reason.
 *
 * level-17's vault: a lone chest across the wall of shards, paying loot. Asked
 * about directly ("would it not make sense to have one monolith destroyed as an
 * acceptance criteria?") and kept out, because one monolith has no spare: the
 * sweep went from 5 of 8 to 1 of 8 with it required, every loss a buried
 * objective. It stays the map's greed hook.
 */
const GREED_BREAKABLES: Record<string, string[]> = {
  "level-17": ["vault"],
};

/**
 * Bonus zones (required: false). Only these two survive the review, and each
 * is its map's greed hook rather than decoration: 11's pocket is behind the
 * curtain the launcher's shot opens, and 18's is the room the windmill turns in.
 */
const GREED_ZONES = ["level-11", "level-18"];

describe("every object is a promise", () => {
  it("counts every kind of breakable a map shows", () => {
    const problems: string[] = [];
    for (const l of LADDER) {
      const spec = resolveWinSpec(l, NO_RUN_RULES);
      const asks = new Set(spec.require
        .filter(c => c.kind === "smashed")
        .map(c => (c.kind === "smashed" ? c.of ?? "any" : "")));
      const exempt = new Set(GREED_BREAKABLES[l.id] ?? []);
      // A reveal is a door: breaking it is how the zone behind it is reached,
      // so the zone's own line already asks for it.
      const shown = entities(l).filter(e => !exempt.has(e.id) && !e.reveals);
      const shards = shown.some(e => e.brittle);
      const monoliths = shown.some(e => (e.breakable || e.chest) && !e.brittle);
      if (shards && !asks.has("shards") && !asks.has("any")) problems.push(`${l.id} shows shards its win ignores`);
      if (monoliths && !asks.has("monoliths") && !asks.has("any")) problems.push(`${l.id} shows a monolith its win ignores`);
    }
    expect(problems).toEqual([]);
  });

  it("keeps every exempted breakable on the board, so the list cannot rot", () => {
    for (const [id, names] of Object.entries(GREED_BREAKABLES)) {
      const l = LADDER.find(x => x.id === id);
      expect(l, `${id} is gone; take it off the list`).toBeDefined();
      for (const n of names) {
        expect(entities(l!).some(e => e.id === n), `${id} no longer has ${n}`).toBe(true);
      }
    }
  });

  it("allows a bonus zone only where it is the map's greed hook", () => {
    const bonus = LADDER
      .filter(l => (l.coloredAreas ?? []).some(a => a.required === false))
      .map(l => l.id)
      .sort();
    expect(bonus).toEqual([...GREED_ZONES].sort());
  });
});

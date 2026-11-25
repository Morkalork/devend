/**
 * The map checklist (BOT_PLAYERS.md): what a sweep of the six bot players
 * says about each map, against the targets a ladder map is designed to.
 *
 *   BAND       the Casual player wins 50% to 80% of its attempts. Below, the
 *              map is a wall; above, it teaches nothing.
 *   BUILD      some player beats Casual by 15 points or more. If none does,
 *              no build is tested here: the map is decided by the hands alone.
 *   LOSSES     no single cause takes more than 70% of the losses. One cause
 *              is one knob, and usually the clock.
 *   PAY        a map harder than an earlier one (Casual wins less) does not
 *              pay less than it. Pay follows difficulty.
 *
 * A boss is held to a lower band, BOSS_BAND: it is the act's exam, and a
 * Casual player should lose it about as often as it wins (BOSS_PLAN.md).
 *
 * The first map is the tutorial: it is meant to be won and to test nothing,
 * so BAND and BUILD are not asked of it (TUTORIAL_MAPS).
 *
 * Pay here is what the bot was paid, and the bot finishes most maps well over
 * par, which cuts the base: sweep with ARCHETYPE_PAR to read a tidier
 * player's pay. The win shares carry about 14 points of luck at 12 runs and 9
 * at 30, so a near miss on BAND or BUILD is a reason to sweep again, not a
 * verdict.
 */
import type { CampaignResult } from "./runCampaign";

export const CASUAL_BAND: readonly [number, number] = [0.5, 0.8];
/** A boss's band for the Casual player (BOSS_PLAN.md). */
export const BOSS_BAND: readonly [number, number] = [0.3, 0.6];
export const BUILD_GAP = 0.15;
export const ONE_CAUSE_MAX = 0.7;
/** Maps that teach the loop and are held to no band: the ladder's first. */
export const TUTORIAL_MAPS: readonly number[] = [1];

export interface MapCheck {
  level: number;
  /** Share of the Casual player's attempts won. */
  casual: number;
  /** The player that won the largest share of its attempts, and that share. */
  best: { id: string; share: number };
  /** The commonest loss and its share of all losses. */
  topLoss: { kind: string; share: number } | null;
  /** Median pay of a winning attempt, all players. */
  pay: number;
  /** The targets this map misses, in words; empty when it meets them all. */
  flags: string[];
}

const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Check every map of a sweep, map 1 first. `results` is per player id. */
export function checkMaps(
  results: Record<string, CampaignResult[]>,
  maps: number,
  /** Map numbers that are bosses, held to BOSS_BAND. */
  bossMaps: readonly number[] = [],
): MapCheck[] {
  const ids = Object.keys(results);
  const shareOf = (id: string, level: number): number => {
    const tries = results[id].flatMap(r => r.attempts).filter(a => a.level === level);
    return tries.length === 0 ? 0 : tries.filter(a => a.won).length / tries.length;
  };

  const out: MapCheck[] = [];
  for (let level = 1; level <= maps; level++) {
    const all = ids.flatMap(id => results[id].flatMap(r => r.attempts)).filter(a => a.level === level);
    if (all.length === 0) {
      continue;
    }
    const casual = ids.includes("casual") ? shareOf("casual", level) : NaN;
    const best = ids
      .map(id => ({ id, share: shareOf(id, level) }))
      .sort((a, b) => b.share - a.share)[0];
    const losses = all.filter(a => !a.won);
    const byKind = new Map<string, number>();
    for (const l of losses) {
      const k = l.failKind ?? "none";
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    const top = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
    const topLoss = top ? { kind: top[0], share: top[1] / losses.length } : null;
    const pay = median(all.filter(a => a.won).map(a => a.pay));

    const flags: string[] = [];
    if (Number.isFinite(casual) && !TUTORIAL_MAPS.includes(level)) {
      const band = bossMaps.includes(level) ? BOSS_BAND : CASUAL_BAND;
      if (casual < band[0]) {
        flags.push(`too hard: Casual wins ${Math.round(casual * 100)}%`);
      } else if (casual > band[1]) {
        flags.push(`too easy: Casual wins ${Math.round(casual * 100)}%`);
      }
      if (best.share - casual < BUILD_GAP) {
        flags.push(`no build tested: best (${best.id}) is ${Math.round((best.share - casual) * 100)} points over Casual`);
      }
    }
    if (topLoss && losses.length >= 5 && topLoss.share > ONE_CAUSE_MAX) {
      flags.push(`one knob: ${topLoss.kind} is ${Math.round(topLoss.share * 100)}% of losses`);
    }
    out.push({ level, casual, best, topLoss, pay, flags });
  }

  // Pay follows difficulty: a map Casual finds harder than an earlier one
  // should not pay less than that one did.
  for (const m of out) {
    const easierButRicher = out.find(e => e.level < m.level && e.casual > m.casual + 0.1 && e.pay > m.pay);
    if (easierButRicher) {
      m.flags.push(`pays ${m.pay}h, less than easier map ${easierButRicher.level} (${easierButRicher.pay}h)`);
    }
  }
  return out;
}

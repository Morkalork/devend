/**
 * The roster: the player's balls (BALL_TREE_PLAN.md).
 *
 * Under the tree rule set a map brings no balls. What rolls onto the board is
 * this list, one to ROSTER_MAX balls, each with a slot number, a name and its
 * rungs: the rules it has gained from the tree (weight, worth, frost, pace,
 * sight, grace), each at rank one to three. The roster is the run's and is
 * saved with it; balls always return, whatever happened on the last map.
 *
 * Module state, like the active rule set and the live pricing, because
 * initGame reads it outside React: the session sets it when a run starts or
 * resumes and whenever the roster changes, and the Playground sets it from
 * its roster editor.
 *
 * Phase 1 carries the roster onto the board and draws it; the rungs' rules
 * are phase 2, so a rung here is a mark and a number until then.
 */

/** The six per-ball ladders, in the order the tree and the ball's marks show them. */
export type RungId = "weight" | "worth" | "frost" | "pace" | "sight" | "grace";
export const RUNG_IDS: readonly RungId[] = ["weight", "worth", "frost", "pace", "sight", "grace"];

export type RungRank = 1 | 2 | 3;
export const RUNG_MAX_RANK: RungRank = 3;

export interface RungMeta {
  label: string;
  /** What each rank does, rank one first. The plan's sentences; the engine's in phase 2. */
  ranks: readonly [string, string, string];
  /** The mark's colour on the ball, as a hex number. */
  color: number;
}

export const RUNG_META: Record<RungId, RungMeta> = {
  weight: {
    label: "Weight",
    ranks: [
      "Twice the mass: dents deformables and breaks a brick in a hit or two.",
      "Four times the mass: wears mirrors and movers down, and Ice cannot slow it.",
      "Six times the mass: shoves a mover off its patrol for 2s, and pays triple when locked.",
    ],
    color: 0x8d99ae,
  },
  worth: {
    label: "Worth",
    ranks: [
      "Locks pay double.",
      "Locks pay triple.",
      "Locks pay triple, and locking it triples every later lock this map.",
    ],
    color: 0xf2c14e,
  },
  frost: {
    label: "Frost",
    ranks: [
      "Freezes for 2s on every third bounce.",
      "Also freezes the ball it collides with, for 2s.",
      "Also freezes for 4s on touching an Ice fence.",
    ],
    color: 0x7fd4ff,
  },
  pace: {
    label: "Pace",
    ranks: [
      "20% slower.",
      "20% slower, and holds a steady speed: no fence, bumper or ball changes it.",
      "20% slower, steady, and starts every map frozen for 5s.",
    ],
    color: 0x9be36d,
  },
  sight: {
    label: "Sight",
    ranks: [
      "Its next bounce is drawn.",
      "Its next three bounces are drawn.",
      "Its next five bounces are drawn.",
    ],
    color: 0xffffff,
  },
  grace: {
    label: "Grace",
    ranks: [
      "A growing fence passes through it for its first quarter second.",
      "Also: the first fence it cuts each map costs the fence, not the life.",
      "Also: every fence it cuts costs the fence, never the life.",
    ],
    color: 0xb8a1ff,
  },
};

export interface RosterBall {
  /** 1-based; the badge the player sees. */
  slot: number;
  /** The player's name for it, if any; the stage shows "Ball N" otherwise. */
  name?: string;
  rungs: Partial<Record<RungId, RungRank>>;
}

export type Roster = RosterBall[];

/** How many balls a run may carry. Three keeps every ball readable on a phone. */
export const ROSTER_MAX = 3;

/** A new run's roster: one plain ball. The run-start trait is phase 4's. */
export function defaultRoster(): Roster {
  return [{ slot: 1, rungs: {} }];
}

/** The balls that roll onto a map: the roster, trimmed to the map's cap when it has one. */
export function rosterForMap(roster: Roster, cap?: number | null): RosterBall[] {
  if (cap === undefined || cap === null || !(cap >= 0)) {
    return roster;
  }
  return roster.slice(0, Math.max(0, Math.floor(cap)));
}

/** How many rungs a ball holds, all ranks counted: what its next rung is priced on. */
export function rungCount(ball: RosterBall): number {
  let n = 0;
  for (const id of RUNG_IDS) {
    n += ball.rungs[id] ?? 0;
  }
  return n;
}

/** Read a saved roster, dropping anything malformed; never more than ROSTER_MAX. */
export function parseRoster(raw: unknown): Roster {
  if (!Array.isArray(raw)) {
    return defaultRoster();
  }
  const out: Roster = [];
  for (const entry of raw) {
    const b = entry as Partial<RosterBall> | null;
    if (!b || typeof b !== "object") {
      continue;
    }
    const rungs: Partial<Record<RungId, RungRank>> = {};
    const rawRungs = (b.rungs ?? {}) as Record<string, unknown>;
    for (const id of RUNG_IDS) {
      const r = Number(rawRungs[id]);
      if (r === 1 || r === 2 || r === 3) {
        rungs[id] = r;
      }
    }
    out.push({ slot: out.length + 1, name: typeof b.name === "string" ? b.name : undefined, rungs });
    if (out.length >= ROSTER_MAX) {
      break;
    }
  }
  return out.length > 0 ? out : defaultRoster();
}

// ── The live roster ─────────────────────────────────────────────────────────

let active: Roster = defaultRoster();

export function getActiveRoster(): Roster {
  return active;
}

export function setActiveRoster(roster: Roster): void {
  active = roster.map((b, i) => ({ ...b, slot: i + 1, rungs: { ...b.rungs } }));
}

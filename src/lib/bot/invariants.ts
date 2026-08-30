/**
 * The things that must be true after every single frame of play.
 *
 * These are not assertions about whether the bot played well. They are the
 * statements the game itself would be broken without, checked at a rate no
 * human tester could manage: after each of tens of thousands of physics steps,
 * across every map and many seeds.
 *
 * Each one is written to answer "what would a player SEE if this were false",
 * because a violation report is only useful if it says what went wrong on
 * screen rather than which number went out of range.
 */
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { CanvasGameState } from "@/types/gameState";

export interface Violation {
  /** Short stable id, so a sweep can group repeats. */
  rule: string;
  /** What a player would see. */
  detail: string;
}

/** Anything that is not a real, finite number is a bug wherever it appears. */
const finite = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n);

/**
 * Check one frame.
 *
 * Returns every violation rather than the first, because one root cause often
 * trips several rules and seeing them together is what identifies it.
 */
export function checkInvariants(game: CanvasGameState): Violation[] {
  const out: Violation[] = [];
  const add = (rule: string, detail: string) => out.push({ rule, detail });

  // ── Balls ────────────────────────────────────────────────────────────────
  for (const b of game.balls ?? []) {
    if (b.state === "dormant") continue;

    if (!finite(b.position?.x) || !finite(b.position?.y)) {
      add("ball-position-nan",
        `ball ${b.id} is at (${b.position?.x}, ${b.position?.y}) - it would vanish from the board`);
      continue; // every later check on this ball would be noise
    }
    if (!finite(b.velocity?.x) || !finite(b.velocity?.y)) {
      add("ball-velocity-nan", `ball ${b.id} has a non-finite velocity and will never move again`);
    }
    if (!finite(b.speed) || b.speed < 0) {
      add("ball-speed-invalid", `ball ${b.id} has speed ${b.speed}`);
    }
    // A generous margin: balls legitimately touch the edge, and a squashed
    // sprite can overhang it. Anything a whole board-width out has escaped.
    const slack = 200;
    if (b.position.x < -slack || b.position.x > BOARD_WIDTH + slack
      || b.position.y < -slack || b.position.y > BOARD_HEIGHT + slack) {
      add("ball-escaped",
        `ball ${b.id} is outside the board at (${b.position.x | 0}, ${b.position.y | 0})`);
    }
  }

  // ── The board's own bookkeeping ──────────────────────────────────────────
  for (const r of game.regions ?? []) {
    if (r.estimatedArea !== undefined && (!finite(r.estimatedArea) || r.estimatedArea < 0)) {
      add("region-area-invalid", `region ${r.id} reports an area of ${r.estimatedArea}`);
    }
  }

  // Fences that never resolve are the classic softlock: the player cannot cut
  // again and the map cannot finish.
  if ((game.activeWalls?.length ?? 0) > 8) {
    add("fence-pileup",
      `${game.activeWalls.length} fences growing at once - they are not completing`);
  }

  // ── The rule this game has broken before ─────────────────────────────────
  // A map reporting itself complete while balls are still in play, or the
  // reverse, is the "CLEAR must equal win" defect: the top bar says one thing
  // and the map does another.
  if (game.levelComplete && game.gameOver) {
    add("won-and-lost", "the map is flagged both complete and game-over");
  }

  return out;
}

/**
 * The checks that only make sense once play has stopped.
 *
 * The first version of this flagged any run that neither won nor lost inside
 * the frame budget, and it fired on fourteen of a hundred and five runs -
 * every one of them a late map where a deliberately mediocre policy simply
 * ran out of time. That is a measurement of the BOT, not the game, and an
 * invariant that reports the tester is worse than no invariant: it buries the
 * real findings in noise nobody can act on.
 *
 * What actually distinguishes a broken map from a slow player is PROGRESS. A
 * bot that is merely bad still eats the board a little at a time; a map that
 * cannot be finished stops moving. So the terminal check asks whether the
 * board was still changing when the budget ran out.
 */
export function checkTerminal(
  game: CanvasGameState, frames: number, cutsMade: number,
  complete: boolean, over: boolean, progressStalled: boolean,
): Violation[] {
  const out: Violation[] = [];
  if (complete || over) return out;

  if (cutsMade === 0) {
    // Never got a legal cut away at all. Either the policy is broken or the map
    // offers nowhere to start, and both are worth knowing.
    out.push({
      rule: "no-legal-cut",
      detail: `played ${frames} frames and never found a legal place to cut`,
    });
  } else if (progressStalled) {
    out.push({
      rule: "progress-stalled",
      detail: `made ${cutsMade} cuts but the board stopped shrinking - the map may be unfinishable from here`,
    });
  }
  // Otherwise: still eating the board when the budget ran out. That is a slow
  // bot on a big map, and it is not a finding.
  return out;
}

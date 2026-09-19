/**
 * The rAF loop must never be able to stay dead.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Reported twice from play, on level 13 both times: "after winning, the map
 * just does nothing and I end up stuck with no post map menu", and then, with a
 * screenshot of a board mid-play, "level 13 still breaks, this is where I got
 * stuck again". The board in that screenshot is a perfectly ordinary frame -
 * fences drawn, balls placed, the bar reading the state it had reached. That is
 * what a DEAD LOOP looks like: the last frame it painted is still on the glass.
 *
 * The engine was checked first and is not the culprit. A sweep of every map on
 * three seeds, testing after every single frame whether the map was won on
 * paper while nothing had been declared, found zero such frames (see
 * botWinShips.test.ts). So the win gate is sound, and what is left is the layer
 * the headless harness does not model at all: the browser loop.
 *
 * ── The hazard, stated plainly ──────────────────────────────────────────────
 *
 * createGameLoop has FIVE exits that return without calling schedule():
 * paused, game-over, an open push prompt, a finished level with its animations
 * played out, and the deferred push prompt. Every one of them is correct - the
 * world is meant to hold - and every one of them depends on some OTHER piece of
 * code calling startGameLoop again later. Five separate restart obligations,
 * across an effect, three modal handlers and a timeout. Miss any one of them
 * and the game is over in the worst possible way: nothing moves, nothing
 * responds, nothing on screen says why, and the only way out is to reload.
 *
 * So the loop stops being the only thing that can restart the loop. This is a
 * NET, not a diagnosis: it does not say which of the five obligations was
 * missed, and it is not a reason to stop caring. It converts a permanent hang
 * into a hitch of at most `DEAD_AFTER_MS`, and it counts itself, so the next
 * report can say whether it fired.
 *
 * It cannot fight the holds it is protecting, because it asks the same
 * questions they do: if ANY reason to be held still is true, the loop is
 * supposed to be stopped and this does nothing.
 */
import type { CanvasGameState } from "@/types/gameState";

/**
 * How long the loop may go unrun before the watchdog treats it as dead.
 *
 * Generously longer than any real frame. A phone dropping to 5fps is at 200ms,
 * a long GC pause or a heavy repaint can reach several hundred; a full second
 * of no loop body at all, with nothing holding it, is not slowness.
 */
export const DEAD_AFTER_MS = 1000;

/** How often to look. Cheap: a handful of boolean reads. */
export const WATCHDOG_INTERVAL_MS = 500;

/** Everything that legitimately stops the loop, as one list. */
export interface HoldFlags {
  /** A modal is up, or a launcher wager is open (GameCanvas mirrors both). */
  paused: boolean;
  gameOver: boolean;
  levelComplete: boolean;
  pushMode: "none" | "prompt" | "pushing";
  pushPromptPending: boolean;
}

export function holdFlagsOf(game: CanvasGameState): HoldFlags {
  return {
    paused: !!game.paused,
    gameOver: !!game.gameOver,
    levelComplete: !!game.levelComplete,
    pushMode: game.pushMode,
    pushPromptPending: !!game.pushPromptPending,
  };
}

/**
 * Why the loop is allowed to be stopped, or null if it is not.
 *
 * Returns the REASON rather than a boolean so a stall report can name it. The
 * order matches the loop's own guards, so the answer is the guard that would
 * actually have returned.
 *
 * `pushMode: "pushing"` is deliberately NOT a hold: the push is ordinary play
 * with a different HUD, and the loop runs right through it.
 */
export function loopHoldReason(f: HoldFlags): string | null {
  if (f.paused && !f.levelComplete && !f.gameOver) return "paused";
  if (f.gameOver) return "gameOver";
  if (f.pushMode === "prompt") return "pushPrompt";
  // A finished level keeps running while its lock flashes and the clear
  // shimmer play, then parks. Either way the overlay above it is the way out.
  if (f.levelComplete) return "levelComplete";
  if (f.pushPromptPending) return "pushPromptPending";
  return null;
}

/**
 * Should the watchdog restart the loop right now?
 *
 * `lastFrameAt` is WALL time (the rAF timestamp the loop body last saw), not
 * sim time, because the question is "has the browser run this function
 * lately", which sim time cannot answer - a held loop advances sim time by its
 * own frame length and a dead one advances nothing, and both look identical
 * from the game's clock.
 *
 * `lastFrameAt === 0` means the loop has never run: that is a map still being
 * built, not a stall, so it waits.
 */
export function loopNeedsRestart(
  f: HoldFlags, lastFrameAt: number, now: number, deadAfterMs = DEAD_AFTER_MS,
): boolean {
  if (lastFrameAt === 0) return false;
  if (loopHoldReason(f) !== null) return false;
  return now - lastFrameAt > deadAfterMs;
}

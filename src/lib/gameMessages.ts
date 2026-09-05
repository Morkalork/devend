/**
 * Telling the player why the thing they just tried did nothing.
 *
 * Six places in the input layer refuse a cut, and five of them said so only to
 * the dev console. From the player's side the fence simply failed to appear,
 * which reads as a bug rather than a rule - and the one rule that DID have
 * feedback (anchoring on a breakable) got a buzz and a flash, which says "no"
 * without saying why.
 *
 * The bar shows exactly ONE message. Not a queue: a queue makes a player who
 * mashes the same illegal cut sit through five copies of the same sentence, and
 * by the time the last one clears they have forgotten what they did. The newest
 * message replaces whatever was there, and repeating the SAME one refreshes its
 * clock instead of restarting the animation, so a run of failed attempts reads
 * as one steady explanation rather than a flicker.
 */

/**
 * Every refusal the player can hit. The id is the i18n key under
 * `gameMessages`, so a new one cannot be added without writing the words.
 */
export type GameMessageId =
  /** The cut would anchor on a breakable, which cannot hold a fence. */
  | "breakableAnchor"
  /** Already drawing as many fences at once as this run allows. */
  | "fenceLimit"
  /** The cut started on ground that has already been captured. */
  | "capturedStart"
  /** An existing fence borders the start point. */
  | "wallInTheWay"
  /** A barrel is still ejecting; no fence until it has finished. */
  | "launcherLoaded"
  /**
   * A ball cut through a fence you were still drawing, and it cost a life.
   *
   * Not a refusal like the five above, which is why the doc at the top of this
   * file says "the last thing you tried" rather than "the last thing you did":
   * the bar is the one place under the board that can say a short sentence
   * without covering it, and a life going with nothing but a red flash to
   * explain it was the largest silent moment left in the game.
   */
  | "lifeLostBall"
  /** A moving block ran through the fence you were drawing, and it cost a life. */
  | "lifeLostMover";

export interface GameMessage {
  id: GameMessageId;
  /** When it was raised, in ms. Refreshed when the same id repeats. */
  at: number;
  /**
   * Bumped only when a DIFFERENT message takes the slot.
   *
   * The bar animates on this rather than on `at`, so hitting the same wall
   * five times running does not restart the entrance five times.
   */
  seq: number;
}

/** How long a message stays up once nothing refreshes it. */
export const MESSAGE_MS = 4000;

/**
 * The slot's next state when `id` is raised.
 *
 * Returns the SAME object when a repeat lands inside its own lifetime and
 * nothing needs to change beyond the clock, so React can skip a render for the
 * common case of a player retrying the same illegal cut.
 */
export function raiseMessage(
  current: GameMessage | null, id: GameMessageId, now: number,
): GameMessage {
  if (current && current.id === id) {
    // Same message, still relevant: push its deadline out, keep its identity.
    return { ...current, at: now };
  }
  return { id, at: now, seq: (current?.seq ?? 0) + 1 };
}

/** Has this message outlived its welcome? */
export function messageExpired(
  message: GameMessage | null, now: number, lifetimeMs = MESSAGE_MS,
): boolean {
  if (!message) return false;
  return now - message.at >= lifetimeMs;
}

/**
 * Every id, for the tests that check each one has words in every language.
 *
 * Built from an exhaustive Record, so adding an id to the union without adding
 * it here is a COMPILE error. The previous note here said deriving the list
 * from the type was not possible at runtime; the keys of a
 * `Record<GameMessageId, true>` are exactly that, and the type checker refuses
 * a missing one. Deriving it from the locale file instead would make the test
 * that checks the locale file circular, which is why that is still not done.
 */
const ALL_MESSAGE_IDS: Record<GameMessageId, true> = {
  breakableAnchor: true,
  fenceLimit: true,
  capturedStart: true,
  wallInTheWay: true,
  launcherLoaded: true,
  lifeLostBall: true,
  lifeLostMover: true,
};

export const GAME_MESSAGE_IDS = Object.keys(ALL_MESSAGE_IDS) as GameMessageId[];

/**
 * Deliberately NOT here: running out of the fence budget.
 *
 * Drawing with a spent budget is not a silent failure - the cut completes and
 * ends the map (fenceBudget.ts) - and the fences-left counter is already on the
 * HUD. A message for something the player can see coming and that does work is
 * noise, and noise is what teaches people to stop reading this bar.
 */

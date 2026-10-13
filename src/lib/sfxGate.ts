/**
 * A rate limit for one sound: allow it at most once per `minGapMs`.
 *
 * A bomb chain goes off a frame apart, and a blast takes out a ring of bricks
 * in a single pass, so without this one chain stacked a boom per bomb and a
 * crack per brick into the same few frames: a wall of noise on a phone speaker
 * and a storm of audio nodes on a low-end audio thread. A dropped sound inside
 * the gap is inaudible under the one that played; the stack is not.
 */
export function sfxGate(minGapMs: number, clock: () => number = () => performance.now()): () => boolean {
  let last = -Infinity;
  return () => {
    const now = clock();
    if (now - last < minGapMs) return false;
    last = now;
    return true;
  };
}

/** A bomb's boom: a chain reads as a rumble of a few booms, not one per bomb. */
export const BOMB_SOUND_GAP_MS = 110;
/** A break's crack: a blast's ring of bricks reads as one crash. */
export const BREAK_SOUND_GAP_MS = 45;

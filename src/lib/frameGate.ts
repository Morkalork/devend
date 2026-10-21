/**
 * A frames-per-second cap for a requestAnimationFrame loop.
 *
 * Runs a frame when its due time has come, then books the next one an
 * interval on from the last DUE time rather than from now, so a display whose
 * refresh does not divide evenly still averages the cap: a 90Hz phone capped
 * at 60 draws two frames of every three instead of every other one (45). A
 * loop that fell more than an interval behind starts counting again from now,
 * so a stall is never followed by a burst.
 */
export interface FrameGate {
  /** Should the frame at `timestamp` (ms) run? */
  due(timestamp: number): boolean;
}

/** A refresh landing within this many ms of its due time still counts. */
const SLACK_MS = 1;

export function createFrameGate(fps: number): FrameGate {
  if (!(fps > 0)) return { due: () => true };
  const interval = 1000 / fps;
  let next = 0;
  return {
    due(timestamp: number): boolean {
      if (timestamp < next - SLACK_MS) return false;
      next = timestamp - next > interval ? timestamp + interval : next + interval;
      return true;
    },
  };
}

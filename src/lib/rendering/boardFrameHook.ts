/**
 * One-shot callbacks run right after the board renders a frame, inside that
 * frame (useGameLoop calls runBoardFrameHooks after callbacks.render).
 *
 * For the device check (lib/deviceCheck), which reads the board's pixels back:
 * a WebGL canvas that does not keep its drawing buffer is cleared once the
 * browser shows it, so the only moment its picture can be read is straight
 * after the draw. Guessing that moment from frame-callback order missed it on
 * one map in three. Nothing is registered outside a check, and then this costs
 * one length test a frame.
 */
const hooks: Array<() => void> = [];

/** Run `cb` once, right after the board's next rendered frame. */
export function onNextBoardFrame(cb: () => void): void {
  hooks.push(cb);
}

/** The game loop, after it rendered. */
export function runBoardFrameHooks(): void {
  if (hooks.length === 0) {
    return;
  }
  const due = hooks.splice(0, hooks.length);
  for (const cb of due) {
    try {
      cb();
    } catch {
      // A probe that throws must never take a frame down with it.
    }
  }
}

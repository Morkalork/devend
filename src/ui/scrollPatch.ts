/**
 * A grab drops the scroll's unfinished spring.
 *
 * @pixi/layout (3.2.1) scrolls with a SlidingNumber per axis. Released past an
 * end, it springs back to that end through `_activeEase`, and `grab()` resets
 * the speed but leaves that ease in place. Grab the content again while it is
 * still settling, drag the other way, let go, and the slide resumes the OLD
 * spring: the content flies back to the end it was settling to. On a phone
 * that is a fling to the bottom of Sprint Planning followed by "it will not
 * scroll back up", because every attempt that starts before the settle ends is
 * thrown back down.
 *
 * Patched on the prototype, so every ScrollView in the interface gets it.
 */
import { SlidingNumber } from "@pixi/layout/components";

type WithEase = { _activeEase: unknown };

let patched = false;

export function patchScrollGrab(): void {
  if (patched) return;
  patched = true;
  const grab = SlidingNumber.prototype.grab;
  SlidingNumber.prototype.grab = function grabDroppingEase(this: SlidingNumber, offset: number) {
    (this as unknown as WithEase)._activeEase = null;
    grab.call(this, offset);
  };
}

patchScrollGrab();

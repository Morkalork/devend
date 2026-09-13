/**
 * The Bug Squash splat is big enough and slow enough to SEE.
 *
 * bugSquash.test.tsx already pins that the envelope does the right thing:
 * it ramps in, it pins, it springs back from the moment of release. Every one
 * of those passed while the feature was reported as "there is no animation for
 * the ball squashing together when it hits the wall" - and the report was
 * fair. The deformation was ~34% over 90ms on a ~13px ball, under a round
 * additive bloom, which is a correct envelope nobody can perceive.
 *
 * So this file pins the PERCEPTUAL properties instead of the logical ones. It
 * is the difference between "the animation runs" and "the animation reads",
 * and only the second was ever the requirement.
 *
 * The brief, verbatim: "as if the ball got the physical consistency of a
 * slightly too ripe tomato when it hit the wall, then just reverse it once the
 * ball leaves the wall again."
 */
import { describe, it, expect } from "vitest";
import {
  createBallEffectState, triggerWallHit, pinSquish, updateBallEffects,
  getSquishEffect, isSquishPinned, SPLAT_HELD_OUT_MS,
} from "@/lib/ballEffects";

/** The upgrade's seconds: the WHOLE stuck time, animation included. */
const HOLD_MS = 2000;
/**
 * When the flat hold ends and the reinflate begins. Earlier than HOLD_MS,
 * because the ball must be round again by the time it is allowed to move: the
 * release plays inside the freeze, not after it.
 */
const RELEASE_AT = HOLD_MS - SPLAT_HELD_OUT_MS;
const T0 = 10_000;
const FRAME = 1 / 60;

/** A square wall hit at full speed, then stuck. */
function splat() {
  const st = createBallEffectState();
  triggerWallHit(st, T0, -300, 0, 300);
  pinSquish(st, T0, HOLD_MS);
  return st;
}

/**
 * The deformation at `ms` after impact, ticking every frame to get there and
 * landing a last tick exactly on `ms` - 60fps steps do not divide the times
 * that matter, and "round at the instant the freeze lifts" is a claim about
 * that instant, not about the frame 17ms before it.
 */
function at(st: ReturnType<typeof splat>, ms: number) {
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(st, FRAME, T0 + t);
  updateBallEffects(st, FRAME, T0 + ms);
  return getSquishEffect(st, 1);
}

describe("the splat is deep enough to see", () => {
  it("loses at least 40% of its thickness at full squash", () => {
    // The number this replaced was 0.657 (a 34% flatten), which on a ball
    // drawn at ~13px is three pixels. Half a ball is a splat.
    const s = at(splat(), 300);
    expect(s.scaleAlong).toBeLessThan(0.6);
    expect(s.scaleAlong).toBeGreaterThan(0.3); // and not a needle
  });

  it("spreads sideways as it flattens, but by less than it loses", () => {
    // A tomato, not a water balloon: strict area preservation at this depth
    // spread the ball to 2.06x its own width.
    const s = at(splat(), 300);
    expect(s.scalePerp).toBeGreaterThan(1.5);
    expect(s.scalePerp).toBeLessThan(1 / s.scaleAlong);
  });

  it("is several times deeper than an ordinary bounce", () => {
    const bounce = createBallEffectState();
    triggerWallHit(bounce, T0, -300, 0, 300);
    updateBallEffects(bounce, FRAME, T0);
    const b = getSquishEffect(bounce, 1);
    const s = at(splat(), 300);
    expect(1 - s.scaleAlong).toBeGreaterThan(2.5 * (1 - b.scaleAlong));
  });

  it("a ball with no usable effect state is simply round, never NaN", () => {
    // The guard this pins was found by breaking it. getSquishEffect answered a
    // state with no squishAmount with NaN scales, which Pixi tolerates on a
    // display property and which turns into NaN GEOMETRY the moment the squash
    // is also used to place the shadow. Anything not clearly a squash is no
    // squash.
    for (const bogus of [{}, { squishAmount: undefined }, { squishAmount: NaN }]) {
      const s = getSquishEffect(bogus as never, 1);
      expect(s.active).toBe(false);
      expect(s.scaleAlong).toBe(1);
      expect(s.scalePerp).toBe(1);
    }
  });
});

describe("the squashing is a motion, not a state", () => {
  it("takes at least eight frames to reach the splat", () => {
    // The old 90ms ramp was five frames: the ball did not appear to squash, it
    // appeared to already be flat.
    const st = splat();
    let frames = 0;
    let last = 1;
    for (let t = 0; t < 400; t += 1000 / 60) {
      updateBallEffects(st, FRAME, T0 + t);
      const along = getSquishEffect(st, 1).scaleAlong;
      if (along < last - 0.001) frames++;
      last = along;
    }
    expect(frames).toBeGreaterThanOrEqual(8);
  });

  it("deepens monotonically on the way in, with no jump to the end", () => {
    const st = splat();
    const path: number[] = [];
    for (let t = 0; t < 160; t += 1000 / 60) {
      updateBallEffects(st, FRAME, T0 + t);
      path.push(getSquishEffect(st, 1).scaleAlong);
    }
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeLessThanOrEqual(path[i - 1] + 1e-9);
    }
    // It really does start round and really does arrive flat.
    expect(path[0]).toBeGreaterThan(0.9);
    expect(path[path.length - 1]).toBeLessThan(0.6);
  });
});

describe("it holds, then reverses", () => {
  it("stays pinned at full squash until the reinflate starts", () => {
    // Sampled before RELEASE_AT rather than before HOLD_MS: the flat part of
    // the stick now ends early, so the reinflate can finish inside the freeze.
    const st = splat();
    const deep = at(st, 300);
    for (let t = 300; t < RELEASE_AT - 100; t += 1000 / 60) {
      updateBallEffects(st, FRAME, T0 + t);
    }
    expect(isSquishPinned(st, T0 + RELEASE_AT - 100)).toBe(true);
    expect(getSquishEffect(st, 1).scaleAlong).toBeCloseTo(deep.scaleAlong, 6);
  });

  it("un-squashes back to round while it is still stuck", () => {
    const st = splat();
    // THE CROWN LIFTS FIRST. Height is recovering while the footprint is still
    // wide, which is the "un-slump upward before letting go of the wall" beat.
    // Sampled 250ms into the release, which is now 250ms BEFORE the ball is let
    // go rather than after it: the whole reverse plays on a ball that has not
    // moved yet, instead of on one already crossing the board.
    at(st, RELEASE_AT + 250);
    const rising = getSquishEffect(st, 1);
    expect(rising.scaleAlong).toBeGreaterThan(0.5);
    expect(rising.scalePerp).toBeGreaterThan(1.3);
    // And it arrives at round, never past it. The peel-off stretch used to play
    // here and is gone from a held splat: it is the shape of a ball LEAVING,
    // and this one is nailed to the wall until it is round again. An ordinary
    // bounce still peels, and bugSquash.test.tsx pins both halves of that.
    const done = at(st, HOLD_MS);
    expect(done.active).toBe(false);
    expect(done.scaleAlong).toBe(1);
    expect(done.scalePerp).toBe(1);
  });

  it("takes longer to let go than a whole ordinary bounce lasts", () => {
    // A ripe tomato does not ping back. The release alone runs 520ms, longer
    // than an entire bounce at the brisk timescale, so it is still deformed
    // 400ms in. Measured from RELEASE_AT now: the release sits INSIDE the
    // stick, so "HOLD_MS + 520" is a ball that let go half a second ago.
    const st = splat();
    at(st, RELEASE_AT + 400);
    expect(getSquishEffect(st, 1).active).toBe(true);

    // A bounce at the same age has all but let go: what is left is the jelly
    // tail (ballLife), a swing of a few percent, against a tomato that is
    // still deeply flattened.
    const bounce = createBallEffectState();
    triggerWallHit(bounce, T0, -300, 0, 300);
    for (let t = 0; t <= 400; t += 1000 / 60) updateBallEffects(bounce, FRAME, T0 + t);
    expect(Math.abs(getSquishEffect(bounce, 1).scaleAlong - 1)).toBeLessThan(0.05);
    expect(getSquishEffect(st, 1).scaleAlong).toBeLessThan(0.9);
  });

  it("ends perfectly round, with the tomato dials cleared", () => {
    // At HOLD_MS exactly, not 900ms past it: the stick is over when the ball is
    // round, because that is the moment its physics resume.
    const st = splat();
    at(st, HOLD_MS);
    const s = getSquishEffect(st, 1);
    expect(s.active).toBe(false);
    expect(s.scaleAlong).toBe(1);
    expect(s.scalePerp).toBe(1);
    expect(st.squishAmount).toBe(0);
    expect(st.squishHoldUntil).toBe(0);
    expect(st.splatD).toBe(0);
    expect(st.splatV).toBe(0);
    expect(st.splatW).toBe(0);
  });

  it("a fresh bounce during the reinflate is a bounce, not a tomato", () => {
    // Otherwise the deep boost and the slow spring would leak onto the next
    // wall the ball touches, and one splat would make every hit after it soft.
    // Interrupted mid-release now, which is where a leak could actually happen:
    // a stuck ball can be struck by another ball while it is reinflating.
    const st = splat();
    at(st, RELEASE_AT + 200);
    const hitAt = T0 + RELEASE_AT + 200;
    triggerWallHit(st, hitAt, 0, -300, 300);
    // No hold, the brisk bounce timescale, and every dial reset: the tomato is
    // gone the instant the ball is struck again.
    expect(st.squishHoldUntil).toBe(0);
    expect(st.squishAmount).toBeLessThan(0.2);
    expect(st.splatD).toBe(0);
    for (let t = 0; t <= 80; t += 1000 / 60) updateBallEffects(st, FRAME, hitAt + t);
    expect(getSquishEffect(st, 1).scaleAlong).toBeGreaterThan(0.8);
  });
});

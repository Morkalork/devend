/**
 * A held ball has to say which way it will go, and say it loud enough to see.
 *
 * Reported twice. The first version of this cue shipped as three small chevrons
 * trailing behind the ball and was reported back as "still doesn't show the
 * direction of the balls when they are initially frozen. Without this, it loses
 * value." Photographed on a real board it was a two-pixel grey smudge at the
 * edge of a ball whose own bloom was brighter than it - the cue was there and
 * it was inaudible, which for information is the same as absent.
 *
 * So this file pins the two properties that failure came down to, and they pull
 * in opposite directions from the usual "keep it subtle" instinct:
 *
 *   IT POINTS THE RIGHT WAY   ahead of the ball, along the heading, and
 *                             mirrored when the heading reverses. A cue that
 *                             only knew the AXIS would be the same ambiguity a
 *                             motionless circle already has.
 *   IT IS BIG AND BRIGHT      a lance of several radii, never faint. Every
 *                             number here is the one the previous attempt got
 *                             wrong, so each is checked against what a player
 *                             can actually see rather than against taste.
 *
 * The ball layer's end of it is pinned too: this is geometry, and geometry
 * stroked at one pixel in a colour the board is already full of is how the
 * first attempt disappeared.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getHeadingCue } from "@/lib/rendering/headingCue";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const C = { x: 100, y: 100 };
const R = 18;
const cue = (vx: number, vy: number, now = 0, radius = R) =>
  getHeadingCue(C, { x: vx, y: vy }, radius, now);

/** How far a point is from the ball centre. */
const dist = (p: { x: number; y: number }) => Math.hypot(p.x - C.x, p.y - C.y);

describe("when there is a heading to show", () => {
  it("says nothing about a ball that is not going anywhere", () => {
    // A dormant ball in a launcher barrel, a sleeper waiting on its terminal:
    // both are held and neither has a heading, and an arrow pointing nowhere
    // in particular would be worse than no arrow.
    expect(cue(0, 0)).toBeNull();
    expect(cue(0.2, -0.1)).toBeNull();
  });

  it("draws for a ball with a real heading", () => {
    expect(cue(200, 0)).not.toBeNull();
  });
});

describe("it points where the ball is going", () => {
  it("sits AHEAD of the ball, not behind it", () => {
    // The reversal from the first attempt. A trail behind reads as exhaust -
    // where something has BEEN - and has to be decoded before it answers the
    // question the player is actually asking.
    const c = cue(200, 0)!;
    expect(c.shaft.from.x).toBeGreaterThan(C.x);
    expect(c.shaft.to.x).toBeGreaterThan(c.shaft.from.x);
    expect(c.head.apex.x, "the head is not the far end of the shaft")
      .toBeGreaterThan(c.shaft.to.x);
  });

  it("puts the point at the front and the wings behind it", () => {
    const c = cue(0, -240)!;   // straight up
    expect(c.head.apex.y).toBeLessThan(c.head.left.y);
    expect(c.head.apex.y).toBeLessThan(c.head.right.y);
    // The wings straddle the heading rather than both falling one side of it.
    expect(Math.sign(c.head.left.x - C.x)).toBe(-Math.sign(c.head.right.x - C.x));
  });

  it("mirrors when the heading reverses", () => {
    // The whole point. An axis-only cue would be identical for these two.
    expect(cue(200, 0)!.head.apex.x).toBeGreaterThan(C.x);
    expect(cue(-200, 0)!.head.apex.x).toBeLessThan(C.x);
  });

  it("follows a diagonal rather than snapping to an axis", () => {
    const c = cue(150, 150)!;
    const dx = c.head.apex.x - C.x;
    const dy = c.head.apex.y - C.y;
    expect(dx).toBeGreaterThan(0);
    expect(dy / dx, "the cue is not on the ball's own bearing").toBeCloseTo(1, 5);
  });

  it("reads the heading and not the speed", () => {
    // A slow ball and a fast one are equally worth pointing at, and a cue whose
    // length meant speed would be a second thing to decode.
    const slow = cue(20, 0)!;
    const fast = cue(900, 0)!;
    expect(dist(fast.head.apex)).toBeCloseTo(dist(slow.head.apex), 6);
  });
});

describe("it is big enough and bright enough to be seen", () => {
  it("clears the ball body, where the bloom is brightest", () => {
    const c = cue(0, -240)!;
    expect(dist(c.shaft.from), "the cue starts inside the ball").toBeGreaterThan(R);
  });

  it("reaches well clear of the ball's corona", () => {
    // The first attempt topped out around 2.2 radii, inside the glow. This has
    // to be long enough to read as a direction at a glance on a phone.
    expect(dist(cue(200, 0)!.head.apex)).toBeGreaterThan(R * 3.5);
  });

  it("carries a head wide enough to read as one", () => {
    const c = cue(200, 0)!;
    const width = Math.hypot(c.head.left.x - c.head.right.x, c.head.left.y - c.head.right.y);
    expect(width).toBeGreaterThan(R);
  });

  it("is never faint, at any point of its pulse", () => {
    // THE regression. Its predecessor's own test asked for "never opaque",
    // capped at 0.7, and that cap is most of why nobody could see it.
    for (let t = 0; t < 3000; t += 25) {
      const c = cue(120, 90, t)!;
      expect(c.alpha, `faint at t=${t}`).toBeGreaterThanOrEqual(0.7);
      expect(c.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("pulses, so it reads as live rather than painted on", () => {
    const seen: number[] = [];
    for (let t = 0; t < 1100; t += 25) seen.push(cue(200, 0, t)!.alpha);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.15);
  });

  it("scales with the ball, so a big-ball run is not a small cue", () => {
    expect(dist(cue(200, 0, 0, 30)!.head.apex))
      .toBeGreaterThan(dist(cue(200, 0, 0, 10)!.head.apex));
  });
});

describe("what the ball layer does with it", () => {
  const layer = read("src/lib/rendering/sleek/ballLayer.ts");

  it("draws it for any held ball, which is what Cold Boot needs", () => {
    // Not only the tap-freeze: Cold Boot hands you a board of motionless balls
    // at map start, and those are the ones the player has never seen move.
    expect(layer).toContain("getHeadingCue(c, ball.velocity, r, this.now)");
    const call = layer.indexOf("getHeadingCue(c,");
    const block = layer.slice(call - 600, call);
    expect(block, "the cue is gated on something narrower than a hold")
      .toContain("ball.frozenUntil !== undefined && this.now < ball.frozenUntil");
  });

  it("backs it, so it keeps its shape over the ball's own glow", () => {
    // The first attempt was a single thin stroke and vanished into the corona.
    const draw = layer.slice(layer.indexOf("getHeadingCue(c,"));
    expect(draw.slice(0, 900)).toContain("color: 0x000000");
    expect(draw.slice(0, 900)).toContain("PALETTE.frost");
  });

  it("does not quietly become the trajectory preview", () => {
    // That is a seven-upgrade family (SCRUM Master) and a freeze handing out
    // its bounces for nothing would delete its reason to exist. The cue module
    // knows nothing about walls, bounces or gravity.
    const src = read("src/lib/rendering/headingCue.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
    for (const forbidden of ["walls", "bounce", "gravity", "trajectory"]) {
      expect(src.toLowerCase(), `the cue reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });
});

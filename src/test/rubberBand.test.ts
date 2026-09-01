/**
 * The Rubber Band: a slingshot the player places, and the wager it makes.
 *
 * The launcher is a barrel the MAP owns, fired once before anything happens.
 * This is the same idea in the player's hands - a band stretched across
 * whatever is in front of them, at a moment they choose.
 *
 * ── One finger, and what the second one was buying ──────────────────────────
 *
 * The first design used two fingers to set the band's two ends. A single drag
 * carries all of it: the start point is where the band sits, the band lies
 * perpendicular to the drag, the anchors are that point offset by the
 * half-width, the length is the power, and the throw goes opposite the pull.
 * The only thing the second finger set was the WIDTH, now a constant. These
 * pin that derivation, because it is the whole reason the gesture is simple.
 *
 * ── The wager ───────────────────────────────────────────────────────────────
 *
 * Pulling harder does two things from one gesture: it throws harder AND it
 * breaks more. At full stretch it destroys any destructible in reach and leaves
 * a ball at three times its base speed - and nothing in the engine damps a
 * ball, so that is for the rest of the map. Freeze and slow are the answer,
 * which is the synergy the ability exists for.
 *
 * "Any destructible" is tested against the object's OWN budget rather than a
 * number, because a magic constant would be true until someone authors a
 * tougher breakable and then quietly false.
 */
import { describe, it, expect } from "vitest";
import {
  bandShape, inBandSweep, bandDamage, bandVelocity,
  BAND_DEAD_PULL, BAND_FULL_PULL, BAND_MIN_POWER, BAND_MAX_POWER,
  BAND_HALF_WIDTH, BAND_REACH,
} from "@/lib/rubberBand";

const pull = (dx: number, dy: number) =>
  bandShape({ x: 450, y: 450 }, { x: 450 + dx, y: 450 + dy });

describe("one drag carries the whole band", () => {
  it("is not a band at all below the dead zone", () => {
    // A charge cannot be taken back, so a stray touch must not spend one.
    expect(pull(0, 0)).toBeNull();
    expect(pull(BAND_DEAD_PULL - 1, 0)).toBeNull();
    expect(pull(BAND_DEAD_PULL + 2, 0)).not.toBeNull();
  });

  it("throws OPPOSITE the pull, as every slingshot has taught", () => {
    const s = pull(-120, 0)!;      // pulled left
    expect(s.heading.x).toBeCloseTo(1, 6);
    expect(s.heading.y).toBeCloseTo(0, 6);
  });

  it("sits under the finger, not at the start point", () => {
    // The band is the thing you have drawn BACK; it snaps forward from there.
    const s = pull(-120, 0)!;
    expect(s.centre.x).toBeCloseTo(330, 6);
    expect(s.centre.y).toBeCloseTo(450, 6);
  });

  it("lies across the pull, and its anchors are the half-width either side", () => {
    // THE derivation the second finger used to do by hand.
    const s = pull(-120, 0)!;      // heading +x, so the band is vertical
    expect(s.a.x).toBeCloseTo(s.centre.x, 6);
    expect(s.b.x).toBeCloseTo(s.centre.x, 6);
    expect(Math.abs(s.a.y - s.b.y)).toBeCloseTo(BAND_HALF_WIDTH * 2, 6);
  });

  it("keeps the band perpendicular at every angle", () => {
    for (const deg of [0, 37, 90, 143, 220, 310]) {
      const th = (deg * Math.PI) / 180;
      const s = pull(Math.cos(th) * 150, Math.sin(th) * 150)!;
      const span = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      const len = Math.hypot(span.x, span.y);
      const dot = (span.x * s.heading.x + span.y * s.heading.y) / len;
      expect(Math.abs(dot), `${deg}deg: the band is skewed`).toBeLessThan(1e-9);
    }
  });

  it("reads power off the drag length, up to a full stretch", () => {
    expect(pull(-(BAND_DEAD_PULL + 1), 0)!.power).toBeCloseTo(BAND_MIN_POWER, 1);
    expect(pull(-BAND_FULL_PULL, 0)!.power).toBeCloseTo(BAND_MAX_POWER, 6);
    // Pulling past full is still full: there has to BE a maximum.
    expect(pull(-5000, 0)!.power).toBeCloseTo(BAND_MAX_POWER, 6);
    expect(pull(-5000, 0)!.powerT).toBe(1);
  });

  it("grows monotonically with the pull, so the stretch is legible", () => {
    let last = 0;
    for (let d = BAND_DEAD_PULL + 2; d < BAND_FULL_PULL; d += 20) {
      const p = pull(-d, 0)!.power;
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe("what the band catches", () => {
  const s = () => pull(-120, 0)!;   // band at (330,450), firing +x

  it("catches what is in FRONT of it", () => {
    expect(inBandSweep({ x: 330 + BAND_REACH / 2, y: 450 }, s())).toBe(true);
  });

  it("ignores what is behind it", () => {
    // Behind the band is what you have already pulled past. Catching it would
    // make the live highlight disagree with the picture.
    expect(inBandSweep({ x: 330 - 20, y: 450 }, s())).toBe(false);
  });

  it("ignores what is beyond its reach", () => {
    expect(inBandSweep({ x: 330 + BAND_REACH + 5, y: 450 }, s())).toBe(false);
  });

  it("catches across its whole span and no further", () => {
    const inside = { x: 330 + 20, y: 450 + BAND_HALF_WIDTH - 2 };
    const outside = { x: 330 + 20, y: 450 + BAND_HALF_WIDTH + 2 };
    expect(inBandSweep(inside, s())).toBe(true);
    expect(inBandSweep(outside, s())).toBe(false);
  });

  it("sweeps the same shape whatever direction it points", () => {
    for (const deg of [0, 90, 180, 270]) {
      const th = (deg * Math.PI) / 180;
      const shape = pull(-Math.cos(th) * 150, -Math.sin(th) * 150)!;
      const front = {
        x: shape.centre.x + shape.heading.x * (BAND_REACH / 2),
        y: shape.centre.y + shape.heading.y * (BAND_REACH / 2),
      };
      const back = {
        x: shape.centre.x - shape.heading.x * 20,
        y: shape.centre.y - shape.heading.y * 20,
      };
      expect(inBandSweep(front, shape), `${deg}deg front`).toBe(true);
      expect(inBandSweep(back, shape), `${deg}deg back`).toBe(false);
    }
  });
});

describe("power is damage as well as speed", () => {
  it("does one ordinary hit at the gentlest pull", () => {
    expect(bandDamage(0, 3)).toBeCloseTo(1, 6);
  });

  it("destroys ANY destructible at full stretch, whatever its budget", () => {
    // Scaled to the object rather than to a constant, so this stays true when
    // someone authors a tougher breakable rather than becoming quietly false.
    for (const budget of [1, 2, 3, 5, 9, 40]) {
      expect(bandDamage(1, budget), `budget ${budget}`).toBeGreaterThanOrEqual(budget);
    }
  });

  it("rises with the pull, so the stretch is one decision and not two", () => {
    const at = (t: number) => bandDamage(t, 5);
    expect(at(0.25)).toBeGreaterThan(at(0));
    expect(at(0.75)).toBeGreaterThan(at(0.25));
    expect(at(1)).toBeGreaterThan(at(0.75));
  });

  it("clamps a nonsense stretch rather than doing nonsense damage", () => {
    expect(bandDamage(-3, 3)).toBeCloseTo(1, 6);
    expect(bandDamage(9, 3)).toBeCloseTo(3, 6);
  });
});

describe("the wager: it leaves you a fast ball", () => {
  it("fires at power times the ball's own base speed", () => {
    const v = bandVelocity(pull(-BAND_FULL_PULL, 0)!, 250);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(250 * BAND_MAX_POWER, 6);
  });

  it("stays under the speed at which a ball can cross a fence untested", () => {
    // The one bound that is correctness rather than design. Collision is
    // discrete: past about 5520 units/second an 18-unit ball can pass a 6-unit
    // fence between two physics steps. The wager is allowed to be punishing; it
    // is not allowed to be broken.
    const fastest = 340;   // the quickest ball in balls.yml
    const v = bandVelocity(pull(-BAND_FULL_PULL, 0)!, fastest);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(5520);
  });

  it("throws along the band's heading, not the ball's own course", () => {
    const s = pull(0, 150)!;   // pulled down, so it throws up
    const v = bandVelocity(s, 250);
    expect(v.y).toBeLessThan(0);
    expect(Math.abs(v.x)).toBeLessThan(1e-6);
  });
});

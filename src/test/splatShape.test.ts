/**
 * The droplet silhouette.
 *
 * The shape a ball takes when it is pressed against something, agreed at design
 * review from three sketched candidates. Everything here is about the SHAPE;
 * ballEffects owns when each dial moves and ballSplatRendering owns getting it
 * onto the screen.
 *
 * The property that matters, and the one that took two failed attempts to
 * arrive at: this is not an ellipse. An ellipse squeezes symmetrically, so the
 * far side of the ball flattens exactly as much as the side against the wall,
 * and at every depth it reads as a rubber ball under pressure rather than as a
 * material that has gone soft. A droplet is widest AT the wall and rounds off
 * toward the crown, and that asymmetry is what these tests pin.
 *
 * Contact space: origin on the wall, +y into it, the ball at negative y.
 */
import { describe, it, expect } from "vitest";
import {
  splatOutline, splatMetrics, splatCore, isDeformed, ROUND, SPLAT_SEGMENTS,
  type SplatState,
} from "@/lib/rendering/splatShape";

const R = 18;
const D = 2 * R;
const FULL: SplatState = { d: 1, v: 1, w: 1, stretch: 0 };
const measure = (s: SplatState, radius = R) => splatMetrics(splatOutline(s, radius));

describe("a ball at rest is exactly a circle", () => {
  it("is round, centred one radius off the wall", () => {
    const pts = splatOutline(ROUND, R);
    expect(pts).toHaveLength(SPLAT_SEGMENTS);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y + R)).toBeCloseTo(R, 6);
    }
    const m = measure(ROUND);
    expect(m.width).toBeCloseTo(D, 6);
    expect(m.height).toBeCloseTo(D, 6);
    expect(m.contact).toBeCloseTo(0, 6);   // touching at a point, not a face
  });

  it("reports itself undeformed, so the caller can skip the whole thing", () => {
    expect(isDeformed(ROUND)).toBe(false);
    expect(isDeformed(FULL)).toBe(true);
  });

  it("never crosses the wall", () => {
    // True at every dial setting: y > 0 is inside the wall, and nothing may be.
    for (const d of [0, 0.5, 1]) {
      for (const v of [0, 0.5, 1]) {
        for (const w of [0, 0.5, 1]) {
          for (const p of splatOutline({ d, v, w, stretch: 0 }, R)) {
            expect(p.y).toBeLessThanOrEqual(1e-9);
          }
        }
      }
    }
  });
});

describe("the contact face", () => {
  it("forms from the contact dial alone, before any spread", () => {
    // The beat that reads as "solid material suddenly went soft": the face is
    // already flat while the ball is still its original width.
    const m = measure({ d: 1, v: 0, w: 0, stretch: 0 });
    expect(m.contact / D).toBeGreaterThan(0.8);
    expect(m.width).toBeCloseTo(D, 6);
  });

  it("is a real flat chord, with many vertices sharing the wall", () => {
    const on = splatOutline(FULL, R).filter(p => p.y > -1e-9);
    expect(on.length).toBeGreaterThan(SPLAT_SEGMENTS / 5);
  });

  it("is nothing at all on a round ball", () => {
    expect(measure(ROUND).contact).toBeCloseTo(0, 6);
  });
});

describe("at full splat", () => {
  const m = measure(FULL);

  it("spreads to about 1.77 diameters and drops to about 0.48", () => {
    // The numbers signed off at design review, from the sketch.
    expect(m.width / D).toBeCloseTo(1.77, 1);
    expect(m.height / D).toBeCloseTo(0.48, 1);
  });

  it("rests its whole width on the wall", () => {
    expect(m.contact).toBeCloseTo(m.width, 1);
  });

  it("is widest AT the wall and narrows to the crown", () => {
    // THE test. An ellipse is widest across its middle; a droplet is widest
    // where it touches. Sampled in three bands by height.
    const pts = splatOutline(FULL, R);
    const widthIn = (lo: number, hi: number) => {
      const xs = pts.filter(p => {
        const h = -p.y / m.height;      // 0 at the wall, 1 at the crown
        return h >= lo && h <= hi;
      }).map(p => p.x);
      return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    };
    const atWall = widthIn(0, 0.12);
    const atMiddle = widthIn(0.44, 0.56);
    const atCrown = widthIn(0.85, 1);
    expect(atWall).toBeGreaterThan(atMiddle);
    expect(atMiddle).toBeGreaterThan(atCrown);
  });

  it("puts its mass low, which is where the shadow goes", () => {
    // The centroid is what the shadow is laid under. It used to carry the
    // texture's bright core too; that moved to splatCore below, which is the
    // same middle-of-the-ball point the material actually has.
    expect(m.cy).toBeGreaterThan(-m.height / 2);
    expect(Math.abs(m.cx)).toBeLessThan(0.001);   // and stays on the axis
  });
});

describe("the bulb's core", () => {
  // The renderer pins the texture's white-hot filament to this point. It is the
  // middle of the SPHERE carried through the deformation, not the centroid of
  // the silhouette: a material point, so it moves the way the material does.

  it("is the ball's own centre while it is round", () => {
    const core = splatCore(ROUND, R);
    expect(core.x).toBe(0);
    expect(core.y).toBeCloseTo(-R, 9);
  });

  it("sinks toward the wall as the face forms and the mass slumps", () => {
    // y runs INTO the wall, so sinking is y climbing toward 0.
    const round = splatCore(ROUND, R);
    const pressed = splatCore({ d: 1, v: 0, w: 0, stretch: 0 }, R);
    const slumped = splatCore({ d: 1, v: 1, w: 0, stretch: 0 }, R);
    expect(pressed.y).toBeGreaterThan(round.y);
    expect(slumped.y).toBeGreaterThan(pressed.y);
  });

  it("stays on the axis and inside the outline at every setting", () => {
    for (const d of [0, 0.5, 1]) {
      for (const v of [0, 0.5, 1]) {
        for (const w of [0, 0.5, 1]) {
          const s: SplatState = { d, v, w, stretch: 0 };
          const core = splatCore(s, R);
          const m = measure(s);
          expect(core.x).toBe(0);                        // never leaves the axis
          expect(core.y).toBeLessThan(0);                // never reaches the wall
          expect(core.y).toBeGreaterThan(-m.height);     // never leaves the crown
        }
      }
    }
  });

  it("sits lower than the centroid, which is dragged up by the spread", () => {
    // Why it is not the centroid: the footprint flowing sideways pulls the
    // silhouette's average away from where the middle of the ball actually
    // went, so the filament used to sit higher than the material it lights.
    const m = measure(FULL);
    const core = splatCore(FULL, R);
    expect(core.y).toBeGreaterThan(m.cy);
  });

  it("is stretched away from the wall by the peel, like the rest of the body", () => {
    const still = splatCore({ d: 0.3, v: 0.1, w: 0.2, stretch: 0 }, R);
    const pulling = splatCore({ d: 0.3, v: 0.1, w: 0.2, stretch: 1 }, R);
    expect(pulling.y).toBeLessThan(still.y);
  });
});

describe("peeling off", () => {
  it("stretches along the normal and narrows across it", () => {
    const flat = measure({ d: 0.3, v: 0.1, w: 0.2, stretch: 0 });
    const pulling = measure({ d: 0.3, v: 0.1, w: 0.2, stretch: 1 });
    expect(pulling.height).toBeGreaterThan(flat.height);
    expect(pulling.width).toBeLessThan(flat.width);
  });
});

describe("it scales with the ball", () => {
  it("is the same silhouette at any radius", () => {
    const small = measure(FULL, 6);
    const big = measure(FULL, 60);
    expect(big.width / 120).toBeCloseTo(small.width / 12, 6);
    expect(big.height / 120).toBeCloseTo(small.height / 12, 6);
  });

  it("carries each vertex's original angle, for texture mapping", () => {
    // The renderer maps the sphere bake by these, so a vertex that has slid
    // sideways still shows the part of the ball it always showed.
    const pts = splatOutline(FULL, R);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].theta).toBeCloseTo((i / SPLAT_SEGMENTS) * Math.PI * 2, 9);
    }
  });
});

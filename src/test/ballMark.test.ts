/**
 * The marks are distinguishable at the size they are actually drawn.
 *
 * Balls are identified by hue alone, and hue is the one channel that fails on a
 * phone in daylight, on a deliberately dark map, and for the ~8% of men with a
 * colour vision deficiency. Under deuteranopia purple/compass measure 4.6 apart
 * in CIELAB and red/lodestone 5.3, against the ~15 where two colours stop being
 * confusable. The marks are what carries identity when the colour cannot.
 *
 * Which means a mark that is merely PRESENT has done nothing. It has to be
 * telling apart from the other marks, at sixteen screen pixels, which is what a
 * ball measures on a phone (18 world units on a 900-unit board). So this
 * rasterises them the way the renderer will and compares the pixels, rather
 * than reading the shape definitions and agreeing with itself. The numbers
 * below came from running it, not from taste.
 */
import { describe, it, expect } from "vitest";
import {
  BALL_MARKS, markFor, markColor, markWidth, MARK_MIN_RADIUS_PX,
  type MarkStroke,
} from "@/lib/rendering/sleek/ballMark";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

/** Phone: a 900-unit board on a ~370px screen puts the ball radius near 8px. */
const PHONE_R = 8;

/** Distance from point to segment, the same maths the stroke rasteriser needs. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Render one mark into a square bitmap of side 2r, as the renderer draws it:
 * unit coordinates scaled by the ball radius, strokes of markWidth.
 */
function raster(strokes: MarkStroke[], r: number): boolean[] {
  const side = Math.round(r * 2);
  const half = markWidth(r) / 2;
  const px: boolean[] = [];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      // Pixel centre, in ball-radius units about the ball's middle.
      const ux = (x + 0.5 - side / 2) / r;
      const uy = (y + 0.5 - side / 2) / r;
      let on = false;
      for (const s of strokes) {
        if (s.kind === "dot") {
          if (Math.hypot(ux - s.at[0], uy - s.at[1]) * r <= s.r * r) { on = true; break; }
        } else {
          const pts = s.close ? [...s.pts, s.pts[0]] : s.pts;
          for (let i = 0; i + 1 < pts.length; i++) {
            if (segDist(ux, uy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) * r <= half) {
              on = true; break;
            }
          }
          if (on) break;
        }
      }
      px.push(on);
    }
  }
  return px;
}

/** Share of pixels that differ, over the pixels either mark lights up. */
function difference(a: boolean[], b: boolean[]): number {
  let diff = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 0 : diff / union;
}

const IDS = Object.keys(BALL_MARKS);

describe("telling two marks apart", () => {
  it("has a mark for every ability, all different from each other", () => {
    // The measured floor is 0.42 (heavyLock/turnTimer, which share a horizontal
    // bar). 0.35 leaves room to nudge a shape without the guard going quiet,
    // and is far above the ~0.15 where two marks start reading as one.
    const worst: { pair: string; d: number }[] = [];
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) {
        const d = difference(raster(BALL_MARKS[IDS[i]], PHONE_R), raster(BALL_MARKS[IDS[j]], PHONE_R));
        worst.push({ pair: `${IDS[i]}/${IDS[j]}`, d });
      }
    }
    worst.sort((a, b) => a.d - b.d);
    expect(worst[0].d, `closest marks: ${worst[0].pair}`).toBeGreaterThan(0.35);
  });

  it("keeps them apart on a tablet too, where strokes get proportionally thinner", () => {
    // Scaling is not automatically safe: markWidth has a 1.4px floor, so at
    // small sizes strokes fatten relative to the ball and shapes converge.
    // Checked at both ends rather than assuming the phone case is the worst.
    for (const r of [MARK_MIN_RADIUS_PX, PHONE_R, 20]) {
      for (let i = 0; i < IDS.length; i++) {
        for (let j = i + 1; j < IDS.length; j++) {
          const d = difference(raster(BALL_MARKS[IDS[i]], r), raster(BALL_MARKS[IDS[j]], r));
          expect(d, `${IDS[i]}/${IDS[j]} merge at r=${r}`).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it("draws every mark large enough to see and small enough to stay on the ball", () => {
    // A mark covering almost nothing is invisible; one running past the rim
    // rides the sphere's dark edge and breaks the ball's silhouette.
    for (const id of IDS) {
      const on = raster(BALL_MARKS[id], PHONE_R).filter(Boolean).length;
      const area = Math.PI * PHONE_R * PHONE_R;
      expect(on / area, `${id} is a smudge`).toBeGreaterThan(0.10);
      expect(on / area, `${id} swamps the ball`).toBeLessThan(0.55);
      for (const s of BALL_MARKS[id]) {
        const pts = s.kind === "dot"
          ? [[s.at[0] + s.r, s.at[1]], [s.at[0], s.at[1] + s.r]] as [number, number][]
          : s.pts;
        for (const [x, y] of pts) {
          expect(Math.hypot(x, y), `${id} reaches past the ball`).toBeLessThanOrEqual(0.62);
        }
      }
    }
  });

  it("draws the strokes bold enough to survive a phone", () => {
    // The defect that the coverage floor above only hinted at. markWidth was
    // r * 0.17, which at a phone's 8px ball radius is a 1.4px hairline - a mark
    // that is technically present and practically a smudge, on exactly the
    // small screen this whole change is for. Anything under ~1.6px cannot hold
    // a shape once the sphere's shading is under it.
    expect(markWidth(MARK_MIN_RADIUS_PX)).toBeGreaterThanOrEqual(1.6);
    expect(markWidth(PHONE_R)).toBeGreaterThanOrEqual(1.6);
    // And it has to keep growing, or a tablet gets a phone's hairline.
    expect(markWidth(20)).toBeGreaterThan(markWidth(PHONE_R));
  });
});

describe("which balls get a mark", () => {
  const BALLS = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/balls.yml"), "utf8"),
  ) as { balls: { id: string; color: string; ability?: string }[] }).balls;

  it("covers every ability the game actually ships", () => {
    // The real guard against adding a ball type and silently shipping it
    // unmarked - which would put it back on colour alone, the thing this fixes.
    const missing = BALLS
      .filter(b => b.ability && b.ability !== "none" && !BALL_MARKS[b.ability])
      .map(b => `${b.id} (${b.ability})`);
    expect(missing, "ball abilities with no mark").toEqual([]);
  });

  it("defines no mark for an ability no ball has", () => {
    // A mark for a deleted ability is dead weight that the distinctness budget
    // above still pays for, crowding the marks that are real.
    const abilities = new Set(BALLS.map(b => b.ability));
    expect(IDS.filter(id => !abilities.has(id)), "marks with no ball").toEqual([]);
  });

  it("leaves a plain ball plain", () => {
    // The rule that makes a mark mean something: a mark says "this one does
    // something". Marking red and blue with a "nothing" glyph would spend the
    // player's attention on the two balls that never need it.
    expect(markFor("none")).toBeNull();
    expect(markFor(undefined)).toBeNull();
    expect(markFor("")).toBeNull();
  });

  it("draws nothing rather than guessing for an ability it does not know", () => {
    // Borrowing another ability's symbol would be a lie about what the ball
    // does, which is worse than the colour-only state this replaces.
    expect(markFor("someFutureAbility")).toBeNull();
  });
});

describe("the mark against the ball under it", () => {
  const BALLS = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/balls.yml"), "utf8"),
  ) as { balls: { id: string; color: string; ability?: string }[] }).balls;

  const rgb = (h: string) => {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // Contrast ratio, WCAG's definition, which is the one with a published floor.
  const contrast = (a: number[], b: number[]) => {
    const rel = (c: number[]) => {
      const l = c.map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    };
    const x = rel(a), y = rel(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it("is readable on every ball the game ships", () => {
    // Marks are drawn onto the LIT sphere, so the choice of black or white has
    // to hold against a face lighter than the flat colour - which is why the
    // threshold in markColor sits above mid grey. 3:1 is WCAG's floor for
    // graphical objects, and these are graphical objects.
    for (const b of BALLS) {
      if (!markFor(b.ability)) continue;
      const mark = markColor(b.color);
      const ink = [(mark >> 16) & 255, (mark >> 8) & 255, mark & 255];
      // Approximate the lit face: the bake brightens the middle of the sphere,
      // which is exactly where the mark sits.
      const lit = rgb(b.color).map(v => Math.min(255, v * 1.18 + 14));
      expect(contrast(ink, lit), `${b.id}: mark vanishes into the ball`)
        .toBeGreaterThan(3);
    }
  });

  it("picks ink by lightness, not by hue", () => {
    expect(markColor("#ffffff")).toBe(0x101418);
    expect(markColor("#2b2f3a")).toBe(0xffffff);
    // Two colours of very different hue and near-identical lightness must get
    // the same ink, or the marks flicker between black and white across balls
    // that look equally bright.
    expect(markColor("#00b4ff")).toBe(markColor("#00c853"));
  });

  it("falls back to dark ink on a colour it cannot parse", () => {
    // Colours come from balls.yml, which is hand-edited. A bad value must not
    // produce NaN and paint a mark in colour zero by accident.
    expect(markColor("nonsense")).toBe(0x000000);
  });

  it("handles the three-digit hex form", () => {
    expect(markColor("#fff")).toBe(0x101418);
    expect(markColor("#000")).toBe(0xffffff);
  });
});

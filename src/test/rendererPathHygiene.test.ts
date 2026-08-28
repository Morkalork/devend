/**
 * A sweep of the Pixi renderer for the class of bug the compass beam belonged
 * to: state left on a shared Graphics that the NEXT thing drawn inherits.
 *
 * The beam was `arc()` continuing the current path. That is one member of a
 * family, and the family is what is worth guarding, because every instance
 * looks like a rendering glitch with no obvious cause and none of them is
 * visible in the code that caused it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../lib/rendering/sleek");
const LAYERS = readdirSync(DIR).filter(f => f.endsWith(".ts"));
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");

describe("nothing continues a path it did not start", () => {
  /**
   * lineTo, arcTo and the curve methods all continue the current path, exactly
   * as the Canvas2D API they mirror does. circle/rect/poly/ellipse open their
   * own, which is why every other round thing in the renderer was fine.
   *
   * `lineTo` is on this list now, and leaving it off was a real gap rather than
   * an oversight about tidiness. Pixi's ShapePath sends the continuing calls
   * through `_ensurePoly(true)`, which, on a path with nothing completed on it
   * yet, seeds the subpath with a literal (0, 0) before adding your point - a
   * line from the canvas origin, which is precisely what the beam looks like.
   * `arc()` alone takes `_ensurePoly(false)` and seeds nothing, so the call the
   * first two fixes guarded was in fact the least dangerous of the family. It
   * is no longer in the renderer at all (see compassRing.ts), and `lineTo`,
   * which is everywhere, is guarded in its place.
   */
  const CONTINUES = ["lineTo", "arc", "arcTo", "bezierCurveTo", "quadraticCurveTo"];

  it.each(LAYERS)("%s opens a subpath before any continuing call", (file) => {
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hit = CONTINUES.find(m => new RegExp(`\\.${m}\\(`).test(lines[i]));
      if (!hit) continue;
      // Canvas2D contexts have beginPath to manage instead, and draw into their
      // own offscreen canvas: not this rule's business.
      if (/\b(ctx|c)\.(moveTo|lineTo|arc|bezierCurveTo|quadraticCurveTo)\(/.test(lines[i])) continue;
      const before = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
      expect(before, `${file}:${i + 1} .${hit}() joins to whatever was drawn last`)
        .toMatch(/\.moveTo\(/);
    }
  });

  it("is looking at real layers, not an empty directory", () => {
    expect(LAYERS.length).toBeGreaterThan(5);
    expect(LAYERS).toContain("ballLayer.ts");
  });
});

/**
 * Geometry queued and never flushed stays on the Graphics for the next
 * stroke/fill to pick up. The builder pattern (return the Graphics for the
 * caller to flush) is fine and common here; what is not fine is an early exit
 * between queueing and flushing.
 */
describe("no draw leaves geometry queued behind it", () => {
  const BUILD = /\.(moveTo|lineTo|arc|poly|circle|rect|roundRect|ellipse)\(/;
  const FLUSH = /\.(stroke|fill|cut)\(/;
  const EXIT = /^\s*(return|continue|break)\b/;
  const FN = /^\s*(private|public|export function|function)\s+\w+/;

  it.each(LAYERS)("%s flushes before every exit", (file) => {
    const lines = read(file).split("\n");
    const dangling: string[] = [];
    let pending: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (FN.test(ln)) pending = null;
      // A `return g.rect(...)` hands the Graphics to the caller to flush, which
      // is the builder pattern and not a leak.
      const isBuilder = /^\s*return\s+\w+\s*;?\s*$/.test(ln)
        || /^\s*return\s+.*\.(rect|poly|circle|moveTo|lineTo)\(/.test(ln);
      if (BUILD.test(ln) && !ln.includes("ctx.")) pending = i + 1;
      if (FLUSH.test(ln)) pending = null;
      if (EXIT.test(ln) && pending !== null && !isBuilder) {
        dangling.push(`${file}:${i + 1} exits with geometry queued from line ${pending}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

/**
 * A Graphics that is never cleared accumulates every frame it has ever drawn.
 */
describe("every Graphics is cleared", () => {
  it.each(LAYERS)("%s clears what it draws into", (file) => {
    const src = read(file);
    const fields = [...src.matchAll(/(?:private|readonly)\s+(\w+)\s*=\s*new Graphics\(\)/g)]
      .map(m => m[1]);
    for (const f of fields) {
      // Cleared directly, or through a local alias (`const g = this.rim; g.clear()`),
      // which is the style several layers use.
      const direct = src.includes(`this.${f}.clear()`);
      const aliased = new RegExp(`=\\s*this\\.${f}\\s*;[\\s\\S]{0,120}?\\.clear\\(\\)`).test(src);
      expect(direct || aliased, `${file}: ${f} is never cleared`).toBe(true);
    }
  });
});

/**
 * The fence mask stands in for collision, so it has to agree with it.
 *
 * Balls, fences and chains all pass through a phased-out obstacle
 * (phasing.ts), and updateBall and chain.ts honour that. The mask did not: it
 * cut a hole wherever an obstacle footprint was, phased out or not, so a fence
 * drawn across a phased-out pillar was clipped into an invisible gap.
 */
describe("the fence mask agrees with collision", () => {
  const WALL = read("wallLayer.ts");
  const mask = WALL.slice(WALL.indexOf("private syncMask("), WALL.indexOf("  sync("));

  it("does not cut an obstacle that is currently intangible", () => {
    expect(mask).toMatch(/phase === "out"/);
    expect(mask).toMatch(/intangible\.has\(poly\)/);
  });

  /** Without this the mask keeps whatever it cut on the frame a pillar last
   *  changed state, and never catches up. */
  it("rebuilds when the phase state changes", () => {
    const key = mask.slice(mask.indexOf("const key ="), mask.indexOf("if (key ==="));
    expect(key).toMatch(/intangible\.size/);
  });

  it("still cuts the ordinary solid obstacles", () => {
    expect(mask).toMatch(/for \(const poly of game\.obstaclePolygons\)/);
    expect(mask).toMatch(/\.cut\(\)/);
  });
});

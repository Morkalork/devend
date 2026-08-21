/**
 * boardConstants must stay a LEAF module.
 *
 * It briefly did not, and the app stopped booting. Adding board tilt put the
 * geometry in boardTilt.ts, which read BOARD_WIDTH at module scope, while
 * boardConstants imported boardTilt back for screenToWorld's inverse. In a
 * cycle, whichever side initialises second sees the other's bindings
 * uninitialised, and the browser threw:
 *
 *   ReferenceError: Cannot access 'BOARD_WIDTH' before initialization
 *
 * Nothing caught it. Typecheck passed, the production build passed, and all
 * 1301 tests passed, because Vitest happened to resolve the module graph in an
 * order that worked and the browser bundle did not. Only loading the page found
 * it. That is the gap this file closes: a cheap structural check for the one
 * property that would have prevented it.
 *
 * boardConstants is imported by almost everything (physics, rendering, input,
 * level loading), so it is the module where a cycle is most likely and most
 * fatal. The rule is simple enough to state and to keep: it may import types,
 * and nothing else of ours.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const LIB = resolve(__dirname, "../lib");

/** Value imports from our own code (`@/...` or relative), ignoring type-only. */
function ownValueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const isTypeOnly = Boolean(m[1]) || /^\{\s*type\s/.test(m[2]);
    const spec = m[3];
    if (isTypeOnly) continue;
    if (spec.startsWith("@/") || spec.startsWith(".")) out.push(spec);
  }
  return out;
}

describe("boardConstants stays a leaf", () => {
  const src = readFileSync(join(LIB, "boardConstants.ts"), "utf8");

  it("imports no value from our own code", () => {
    const imports = ownValueImports(src);
    expect(
      imports,
      "boardConstants is imported by physics, rendering, input and level loading. " +
      "A value import here can close a cycle, and a cycle here stops the app booting " +
      "while typecheck, build and the whole test suite stay green.",
    ).toEqual([]);
  });

  it("still owns the board size the rest of the game measures against", () => {
    expect(src).toMatch(/export const BOARD_WIDTH/);
  });
});

/**
 * The narrower version of the same rule: no module boardConstants depends on
 * may depend back on it. Since the test above pins its imports to none, this
 * is really a guard on the pairing that broke, kept explicit so the next person
 * to move geometry between these two files sees why they are arranged this way.
 */
describe("the board tilt pair points one way", () => {
  it("boardTilt may import boardConstants, never the reverse", () => {
    const tilt = readFileSync(join(LIB, "boardTilt.ts"), "utf8");
    const constants = readFileSync(join(LIB, "boardConstants.ts"), "utf8");
    expect(ownValueImports(tilt).some(i => i.includes("boardConstants"))).toBe(true);
    expect(ownValueImports(constants).some(i => i.includes("boardTilt"))).toBe(false);
  });

  /**
   * The specific trigger. A module-scope read of an imported binding is what
   * turns a cycle from a latent smell into a boot failure: a function body
   * would have run later, after both modules finished initialising.
   */
  it("boardTilt reads no imported binding at module scope", () => {
    const tilt = readFileSync(join(LIB, "boardTilt.ts"), "utf8");
    const topLevelConsts = [...tilt.matchAll(/^const\s+\w+\s*=\s*([^;]+);/gm)].map(m => m[1]);
    for (const expr of topLevelConsts) {
      expect(expr, `module-scope const evaluates an import: ${expr.trim()}`)
        .not.toMatch(/BOARD_WIDTH|BOARD_HEIGHT/);
    }
  });

  /** Sanity: the check above is looking at a file that actually has content. */
  it("is checking real files", () => {
    expect(readFileSync(join(LIB, "boardTilt.ts"), "utf8").length).toBeGreaterThan(500);
    expect(readdirSync(LIB)).toContain("boardConstants.ts");
  });
});

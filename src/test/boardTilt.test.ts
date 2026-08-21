/**
 * The board turns so that down is always down (issue #77).
 *
 * Rather than an indicator telling the player which way gravity pulls, the board
 * itself rotates to meet it. Three things have to hold or the map is unplayable
 * rather than merely disorienting:
 *
 *   1. The tilt and its inverse must round-trip EXACTLY, at every angle
 *      including mid-turn. Input goes through the inverse, so any drift here is
 *      a fence that appears somewhere other than where it was drawn.
 *   2. The board must never leave its own square. A square rotated 45 degrees
 *      has a bounding box 1.41x its side, so a turn without the fit scale would
 *      throw its corners off screen.
 *   3. Every rest angle must be an exact multiple of 90 degrees at full size,
 *      since that is what makes the square map onto itself with no letterboxing.
 */
import { describe, it, expect } from "vitest";
import {
  TILT_SECONDS, phaseAngle, tiltAngleAt, fitScale, tiltWorldPoint, untiltWorldPoint,
} from "@/lib/boardTilt";
import { BOARD_WIDTH, screenToWorld } from "@/lib/boardConstants";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GravityConfig } from "@/lib/physics/gravity";

const CFG: GravityConfig = {
  turnRate: 1.1, period: 9,
  sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
};
const DEG = (d: number) => (d * Math.PI) / 180;
const HALF = BOARD_WIDTH / 2;

describe("which way the board rests", () => {
  it("leaves the board upright while the pull is down", () => {
    expect(phaseAngle(0, CFG)).toBeCloseTo(0, 9);
  });

  it("turns a quarter for each cardinal pull", () => {
    const at = (dir: string) => phaseAngle(0, { ...CFG, sequence: [dir as never] });
    expect(at("down")).toBeCloseTo(0, 9);
    expect(at("right")).toBeCloseTo(DEG(90), 9);
    expect(at("up")).toBeCloseTo(DEG(180), 9);
    expect(at("left")).toBeCloseTo(DEG(-90), 9);
  });

  /**
   * Gravity switching off is the board RESTING, not the board righting itself.
   * Snapping back to upright between pulls would double the number of turns and
   * make the quiet stretches the busiest part of the map.
   */
  it("holds its orientation through a gravity-free phase", () => {
    expect(phaseAngle(1, CFG)).toBeCloseTo(phaseAngle(0, CFG), 9); // none after down
    expect(phaseAngle(3, CFG)).toBeCloseTo(phaseAngle(2, CFG), 9); // none after left
  });

  it("never turns when the sequence has no pull at all", () => {
    expect(phaseAngle(2, { ...CFG, sequence: ["none", "none"] })).toBe(0);
  });
});

describe("the turn itself", () => {
  it("is settled by the time the phase is old", () => {
    const settled = tiltAngleAt(TILT_SECONDS + 0.01, CFG);
    expect(settled).toBeCloseTo(phaseAngle(0, CFG), 6);
  });

  it("moves between two rest angles during a turn", () => {
    // Phase 2 is the first "left" (index 2 x period 9 = 18s in).
    const start = tiltAngleAt(18, CFG);
    const mid = tiltAngleAt(18 + TILT_SECONDS / 2, CFG);
    const end = tiltAngleAt(18 + TILT_SECONDS, CFG);
    expect(start).toBeCloseTo(phaseAngle(1, CFG), 4);
    expect(end).toBeCloseTo(phaseAngle(2, CFG), 6);
    expect(Math.abs(mid - start)).toBeGreaterThan(1e-3);
  });

  /** A quarter turn must never be taken the three-quarter way round. */
  it("always takes the short way round", () => {
    const cfg: GravityConfig = { ...CFG, sequence: ["up", "left"] };
    // up = 180deg, left = -90deg: the short route is +90, not -270.
    const from = phaseAngle(0, cfg), to = phaseAngle(1, cfg);
    const mid = tiltAngleAt(cfg.period + TILT_SECONDS / 2, cfg);
    const travelled = Math.abs(mid - from);
    expect(travelled).toBeLessThan(Math.abs(to - from)); // not the long way
    expect(travelled).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });

  it("is flat and upright when there is no gravity at all", () => {
    expect(tiltAngleAt(12, null)).toBe(0);
  });

  it("survives a nonsense clock", () => {
    for (const t of [-3, NaN, Infinity]) {
      expect(() => tiltAngleAt(t, CFG)).not.toThrow();
      expect(Number.isFinite(tiltAngleAt(t, CFG))).toBe(true);
    }
  });
});

describe("staying inside the frame", () => {
  it("is full size at every rest angle, so the square maps onto itself", () => {
    for (const d of [0, 90, 180, -90, 270]) expect(fitScale(DEG(d))).toBeCloseTo(1, 9);
  });

  it("shrinks most at the halfway point of a turn", () => {
    expect(fitScale(DEG(45))).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(fitScale(DEG(45))).toBeLessThan(fitScale(DEG(20)));
  });

  /** The property the fit scale exists for, checked on the actual corners. */
  it("keeps all four corners inside the board at every angle", () => {
    const corners = [[0, 0], [BOARD_WIDTH, 0], [0, BOARD_WIDTH], [BOARD_WIDTH, BOARD_WIDTH]];
    for (let d = 0; d < 360; d += 3) {
      for (const [cx, cy] of corners) {
        const p = tiltWorldPoint(cx, cy, DEG(d));
        expect(p.x, `corner at ${d}deg`).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x, `corner at ${d}deg`).toBeLessThanOrEqual(BOARD_WIDTH + 1e-6);
        expect(p.y, `corner at ${d}deg`).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y, `corner at ${d}deg`).toBeLessThanOrEqual(BOARD_WIDTH + 1e-6);
      }
    }
  });

  it("keeps the board centred, whatever the angle", () => {
    for (let d = 0; d < 360; d += 15) {
      const c = tiltWorldPoint(HALF, HALF, DEG(d));
      expect(c.x).toBeCloseTo(HALF, 9);
      expect(c.y).toBeCloseTo(HALF, 9);
    }
  });
});

describe("round-tripping a tap back to world space", () => {
  /**
   * THE correctness property for input. A fence is drawn where the inverse says
   * the finger was, so any drift here puts the fence somewhere the player did
   * not touch.
   */
  it("inverts exactly, at every angle and all over the board", () => {
    const pts = [[0, 0], [45, 45], [120, 700], [HALF, HALF], [855, 120], [900, 900]];
    for (let d = 0; d < 360; d += 7) {
      for (const [x, y] of pts) {
        const t = tiltWorldPoint(x, y, DEG(d));
        const back = untiltWorldPoint(t.x, t.y, DEG(d));
        expect(back.x, `${x},${y} at ${d}deg`).toBeCloseTo(x, 6);
        expect(back.y, `${x},${y} at ${d}deg`).toBeCloseTo(y, 6);
      }
    }
  });

  it("is a no-op at zero, so an ordinary map pays nothing", () => {
    expect(tiltWorldPoint(123, 456, 0)).toEqual({ x: 123, y: 456 });
    expect(untiltWorldPoint(123, 456, 0)).toEqual({ x: 123, y: 456 });
  });

  it("round-trips mid-turn too, where the scale is not 1", () => {
    const a = tiltAngleAt(18 + TILT_SECONDS / 2, CFG);
    expect(fitScale(a)).toBeLessThan(1);
    const t = tiltWorldPoint(200, 640, a);
    const back = untiltWorldPoint(t.x, t.y, a);
    expect(back.x).toBeCloseTo(200, 6);
    expect(back.y).toBeCloseTo(640, 6);
  });
});

describe("where the pull ends up on screen", () => {
  /**
   * The whole point: whichever way gravity pulls in world space, it must point
   * DOWN the screen once the board has turned to meet it.
   */
  it("puts every cardinal pull at the bottom of the screen", () => {
    const pulls: Record<string, [number, number]> = {
      down: [0, 1], right: [1, 0], up: [0, -1], left: [-1, 0],
    };
    for (const [dir, [px, py]] of Object.entries(pulls)) {
      const angle = phaseAngle(0, { ...CFG, sequence: [dir as never] });
      // Transform the pull as a direction: tilt two points and take the delta.
      const a = tiltWorldPoint(HALF, HALF, angle);
      const b = tiltWorldPoint(HALF + px * 100, HALF + py * 100, angle);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      expect((b.y - a.y) / len, `${dir} should read as screen-down`).toBeCloseTo(1, 6);
    }
  });
});

// ── The two transforms must agree ───────────────────────────────────────────

/**
 * The renderer tilts in `w2s` (SleekRenderer) and input un-tilts in
 * `screenToWorld` (boardConstants). They are separate functions in separate
 * files, and if they ever disagree a fence lands somewhere the player did not
 * touch, which is invisible in code review and obvious the instant you play.
 *
 * Both derive their angle from the same pure tiltAngleAt on the same
 * activePlaySeconds, deliberately: neither caches, so they cannot drift by a
 * frame. This reconstructs the renderer's half and checks the pair round-trips.
 */
describe("the renderer and input agree", () => {
  const RECT = { left: 40, top: 90, scale: 0.5, width: 450, height: 450 };

  /** Exactly what SleekRenderer's tilted w2s does. */
  const renderPoint = (x: number, y: number, angle: number) => {
    const p = tiltWorldPoint(x, y, angle);
    return { x: RECT.left + p.x * RECT.scale, y: RECT.top + p.y * RECT.scale };
  };

  it("recovers the world point a tap landed on, at every angle", () => {
    const pts = [[45, 45], [200, 640], [HALF, HALF], [855, 120], [700, 800]];
    for (let d = 0; d < 360; d += 11) {
      const angle = DEG(d);
      for (const [x, y] of pts) {
        const screen = renderPoint(x, y, angle);
        const back = screenToWorld(screen.x, screen.y, RECT, angle);
        expect(back.x, `${x},${y} at ${d}deg`).toBeCloseTo(x, 5);
        expect(back.y, `${x},${y} at ${d}deg`).toBeCloseTo(y, 5);
      }
    }
  });

  it("agrees mid-turn, where the fit scale is not 1", () => {
    const angle = tiltAngleAt(18 + TILT_SECONDS / 2, CFG);
    expect(fitScale(angle)).toBeLessThan(1);
    const screen = renderPoint(320, 210, angle);
    const back = screenToWorld(screen.x, screen.y, RECT, angle);
    expect(back.x).toBeCloseTo(320, 5);
    expect(back.y).toBeCloseTo(210, 5);
  });

  /** An ordinary map must be byte-for-byte the arithmetic it always was. */
  it("is unchanged on a map with no gravity", () => {
    const screen = renderPoint(300, 400, 0);
    expect(screen).toEqual({ x: RECT.left + 300 * RECT.scale, y: RECT.top + 400 * RECT.scale });
    expect(screenToWorld(screen.x, screen.y, RECT)).toEqual({ x: 300, y: 400 });
  });
});

/**
 * Every input path must actually PASS the tilt.
 *
 * The round-trip tests above call screenToWorld directly, so they prove the
 * maths and miss the wiring: dropping the angle at one call site leaves them all
 * green while that gesture lands somewhere the player did not touch. A mutation
 * run found exactly that hole. This is a source check because the relationship
 * is structural, five call sites that must all agree with one renderer, and
 * nothing in the type system relates them (the parameter defaults to 0, which
 * is what makes an omission silent).
 */
describe("input never forgets the tilt", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../hooks/useGameInput.ts"), "utf8",
  );

  it("finds the call sites, so a rename cannot quietly disable this", () => {
    expect(SRC.match(/screenToWorld\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("passes a tilt angle to every screenToWorld call", () => {
    const bare: string[] = [];
    for (const m of SRC.matchAll(/screenToWorld\(([^)]*)\)/g)) {
      if (!/boardTilt|tiltAngle/.test(m[1])) bare.push(m[0]);
    }
    expect(
      bare,
      `these gestures would land un-turned on a gravity map: ${bare.join(" | ")}`,
    ).toEqual([]);
  });

  it("derives that angle from the same clock the renderer uses", () => {
    expect(SRC).toMatch(/tiltAngleAt\(\s*game\.activePlaySeconds/);
  });
});

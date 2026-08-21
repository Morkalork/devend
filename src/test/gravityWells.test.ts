/**
 * Gravity wells (issue #77): local patches of the board that pull.
 *
 * Local rather than global, and that is the design argument the tests are
 * really guarding. Universal gravity makes every ball's path knowable, which is
 * corrosive in a game whose tension is unpredictable motion in shrinking space.
 * A well does the opposite: a ball flies normally, bends only while inside, and
 * resumes ordinary motion on the way out, so where it leaves depends on where
 * and at what angle it entered.
 *
 * Two properties matter beyond "it pulls". The pull must STOP at the boundary,
 * or the well is just global gravity with extra steps. And speed must be
 * untouched, both because every rescaler in updateBall would erase anything
 * else and because it is what makes a resting ball impossible.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  pointInWell, wellAt, wellStep, pullsIntoWall, WELL_PULL, DEFAULT_WELL_TURN_RATE,
} from "@/lib/physics/gravityWells";
import { rotateGravityWell } from "@/lib/mapRotation";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { GravityWell, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const WELL: GravityWell = { x: 300, y: 300, width: 200, height: 200, turnRate: 2.8 };
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe("what counts as inside", () => {
  it("contains its own middle and edges", () => {
    expect(pointInWell(400, 400, WELL)).toBe(true);
    expect(pointInWell(300, 300, WELL)).toBe(true);
    expect(pointInWell(500, 500, WELL)).toBe(true);
  });

  it("excludes everything outside, on every side", () => {
    expect(pointInWell(299, 400, WELL)).toBe(false);
    expect(pointInWell(501, 400, WELL)).toBe(false);
    expect(pointInWell(400, 299, WELL)).toBe(false);
    expect(pointInWell(400, 501, WELL)).toBe(false);
  });

  it("finds the well a point is in, or none", () => {
    expect(wellAt(400, 400, [WELL])).toBe(WELL);
    expect(wellAt(100, 100, [WELL])).toBeNull();
    expect(wellAt(400, 400, [])).toBeNull();
    expect(wellAt(400, 400, undefined)).toBeNull();
  });
});

describe("the pull", () => {
  it("points down the screen", () => {
    expect(WELL_PULL).toEqual({ x: 0, y: 1 });
  });

  /** The property that makes it LOCAL rather than global gravity in disguise. */
  it("does nothing at all outside the well", () => {
    expect(wellStep({ x: 100, y: 100 }, { x: 200, y: 0 }, [WELL], 1 / 60)).toBeNull();
  });

  it("bends the heading downward inside", () => {
    const out = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [WELL], 1 / 60)!;
    expect(out).not.toBeNull();
    expect(out.y).toBeGreaterThan(0);
  });

  it("never changes speed, from any heading", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const v = { x: Math.cos(a) * 240, y: Math.sin(a) * 240 };
      const out = wellStep({ x: 400, y: 400 }, v, [WELL], 1 / 60)!;
      expect(len(out), `heading ${a.toFixed(2)}`).toBeCloseTo(240, 6);
    }
  });

  it("bends harder for a fiercer well", () => {
    const gentle = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...WELL, turnRate: 0.5 }], 1 / 60)!;
    const fierce = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...WELL, turnRate: 5 }], 1 / 60)!;
    expect(fierce.y).toBeGreaterThan(gentle.y);
  });

  it("falls back to a sane rate when none is authored", () => {
    const { turnRate, ...bare } = WELL;
    expect(turnRate).toBeDefined();
    const a = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [bare as GravityWell], 1 / 60)!;
    const b = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...bare, turnRate: DEFAULT_WELL_TURN_RATE } as GravityWell], 1 / 60)!;
    expect(a.y).toBeCloseTo(b.y, 9);
  });

  it("ignores a nonsense rate rather than freezing or flinging the ball", () => {
    for (const bad of [0, -4, Number.NaN]) {
      const out = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...WELL, turnRate: bad }], 1 / 60)!;
      expect(len(out), `rate ${bad}`).toBeCloseTo(200, 6);
      expect(out.y, `rate ${bad}`).toBeGreaterThan(0);
    }
  });
});

describe("the authoring rule", () => {
  /**
   * A well whose pull points at a surface it is sitting on pins a ball against
   * it, bouncing in place: not stopped, since speed is preserved, but stuck on
   * one axis and trivially fenceable, which is worse than either.
   */
  it("flags a well resting on the floor it pulls toward", () => {
    expect(pullsIntoWall({ x: 300, y: 700, width: 200, height: 150 }, BOARD_WIDTH)).toBe(true);
  });

  it("passes a well with room beneath it", () => {
    expect(pullsIntoWall({ x: 300, y: 300, width: 200, height: 170 }, BOARD_WIDTH)).toBe(false);
  });
});

describe("rotating with the map", () => {
  /**
   * The box turns with the map; the PULL does not. A rigid rotation preserves
   * every relationship inside it, so a pull that turned too could never change
   * how a map plays, which is what a later board tilt has to be able to do.
   */
  it("moves the box into the orientation", () => {
    const turned = rotateGravityWell(WELL, 1);
    expect(turned).not.toEqual(WELL);
    expect(turned.width).toBeGreaterThan(0);
    expect(turned.height).toBeGreaterThan(0);
  });

  it("leaves the standard orientation untouched", () => {
    expect(rotateGravityWell(WELL, 0)).toBe(WELL);
  });

  it("keeps the turn rate through a rotation", () => {
    expect(rotateGravityWell(WELL, 3).turnRate).toBe(WELL.turnRate);
  });
});

// ── Through the real physics ────────────────────────────────────────────────

describe("a ball crossing a real well", () => {
  const LEVEL = {
    id: "well-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
    maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
  } as unknown as LevelConfig;

  function probe(wells: GravityWell[], startX: number): CanvasGameState {
    const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
    const ball = data.balls[0];
    ball.position = { x: startX, y: 400 };            // level with the well
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y) || ball.baseSpeed;
    ball.velocity = { x: speed, y: 0 };               // flying flat, rightward
    return {
      ...data, balls: [ball], walls: data.walls, activeWalls: [],
      movers: data.movers ?? [], objectDebris: [], destructibles: [], pendingDestroys: [],
      obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
      pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
      activePlaySeconds: 0, creepFactor: 1, ballSpeedScale: 1, frozenBallId: null,
      gravityWells: wells, mapMutator: null, gravityConfig: null,
      screenSize: { width: 900, height: 900 },
      boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
    } as unknown as CanvasGameState;
  }

  const step = (g: CanvasGameState, n: number) => {
    for (let i = 0; i < n; i++) {
      g.activePlaySeconds += 1 / 60;
      updateBall(g.balls[0], 1 / 60, g);
    }
  };

  it("flies straight until it reaches the well", () => {
    const g = probe([WELL], 100);
    step(g, 5);                                        // still short of x=300
    expect(g.balls[0].position.x).toBeLessThan(WELL.x);
    expect(Math.abs(g.balls[0].velocity.y)).toBeLessThan(1e-6);
  });

  it("bends once inside", () => {
    const g = probe([WELL], 320);                      // starts inside
    step(g, 20);
    expect(g.balls[0].velocity.y).toBeGreaterThan(1);
  });

  /** A map with no wells must behave exactly as it always did. */
  it("is untouched on a map with none", () => {
    const g = probe([], 320);
    step(g, 20);
    expect(Math.abs(g.balls[0].velocity.y)).toBeLessThan(1e-6);
  });

  it("keeps its speed across the whole crossing", () => {
    const g = probe([WELL], 100);
    const before = Math.hypot(g.balls[0].velocity.x, g.balls[0].velocity.y);
    step(g, 300);
    expect(Math.hypot(g.balls[0].velocity.x, g.balls[0].velocity.y)).toBeCloseTo(before, 3);
  });

  it("never brings the ball to rest", () => {
    const g = probe([WELL], 320);
    for (let i = 0; i < 40; i++) {
      step(g, 10);
      expect(Math.hypot(g.balls[0].velocity.x, g.balls[0].velocity.y)).toBeGreaterThan(1);
    }
  });
});

// ── As authored ─────────────────────────────────────────────────────────────

describe("the wells in map.yml", () => {
  const LEVELS = (yaml.load(
    readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
  ) as { levels: LevelConfig[] }).levels;
  const withWells = LEVELS.filter(l => (l.gravityWells ?? []).length > 0);

  it("has at least one map using them", () => {
    expect(withWells.length).toBeGreaterThan(0);
  });

  /** They are a mechanic for after the teaching band (L1-10 are one idea each). */
  it("only appears past the teaching levels", () => {
    for (const l of withWells) expect(l.level, l.id).toBeGreaterThan(10);
  });

  it("keeps every well inside the board", () => {
    for (const l of withWells) {
      for (const w of l.gravityWells!) {
        expect(w.x, l.id).toBeGreaterThanOrEqual(0);
        expect(w.y, l.id).toBeGreaterThanOrEqual(0);
        expect(w.x + w.width, l.id).toBeLessThanOrEqual(BOARD_WIDTH);
        expect(w.y + w.height, l.id).toBeLessThanOrEqual(BOARD_WIDTH);
      }
    }
  });

  /** The rule, enforced rather than merely written down in a comment. */
  it("never rests a well on the floor it pulls toward", () => {
    for (const l of withWells) {
      for (const w of l.gravityWells!) {
        expect(
          pullsIntoWall(w, BOARD_WIDTH),
          `${l.id}: a well this close to the floor pins balls against it`,
        ).toBe(false);
      }
    }
  });
});

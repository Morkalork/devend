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
  pointInWell, wellAt, liveWellAt, wellStep, pullsIntoWall, WELL_PULL,
  DEFAULT_WELL_TURN_RATE, wellIsLive, wellPull,
} from "@/lib/physics/gravityWells";
import { rotateGravityWell, rotatePoint } from "@/lib/mapRotation";
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
   * Both the box and the PULL turn here, and the distinction is worth stating
   * because it looks like it contradicts the rule that makes the board tilt
   * work. There are two rotations and only one of them happens where the player
   * can see it.
   *
   * A board TILT is live, mid-map, over a board already in play. Its pull must
   * NOT turn, or the turn preserves every relationship inside the map and
   * changes nothing. That is the mechanic.
   *
   * A map ROTATION is baked in before the first frame. The player never sees
   * the un-rotated board, so a fixed pull creates no surprise - it just
   * randomises which of four unrelated maps the author actually shipped, and
   * silently voids the authoring rule they checked against.
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

  /** Orientation 1 is a left/CCW quarter turn (see rotatePoint), so down goes right. */
  it("turns the pull the same way it turns the box", () => {
    expect(rotateGravityWell({ ...WELL, pull: "down" }, 1).pull).toBe("right");
    expect(rotateGravityWell({ ...WELL, pull: "down" }, 2).pull).toBe("up");
    expect(rotateGravityWell({ ...WELL, pull: "down" }, 3).pull).toBe("left");
  });

  /**
   * Stated against rotatePoint rather than against a table of expected answers,
   * because the failure mode is turning the pull the WRONG way: every test that
   * only checks "it changed" passes, and the map quietly stops being the one
   * that was designed.
   */
  it("agrees with how every other part of the map rotates", () => {
    const V = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] } as const;
    for (const pull of ["down", "up", "left", "right"] as const) {
      for (const r of [1, 2, 3] as const) {
        const [dx, dy] = V[pull];
        const o = rotatePoint(0, 0, r);
        const q = rotatePoint(dx, dy, r);
        const got = V[rotateGravityWell({ ...WELL, pull }, r).pull!];
        expect(got[0], `${pull} @ ${r}`).toBeCloseTo(q.x - o.x, 6);
        expect(got[1], `${pull} @ ${r}`).toBeCloseTo(q.y - o.y, 6);
      }
    }
  });

  it("turns an unstated pull too, since absent means down", () => {
    expect(rotateGravityWell(WELL, 1).pull).toBe("right");
  });

  it("comes full circle over four quarter turns", () => {
    let w: GravityWell = { ...WELL, pull: "right" };
    for (let i = 0; i < 4; i++) w = rotateGravityWell(w, 1);
    expect(w.pull).toBe("right");
  });

  /**
   * The whole point of turning the pull, stated as the thing that was broken:
   * an author places a well safely clear of the edge it pulls toward, and a
   * fixed pull gave it a one-in-four chance of being rotated onto that edge.
   */
  it("keeps a safely-placed well safe in all four orientations", () => {
    const safe: GravityWell = { x: 330, y: 300, width: 240, height: 170, pull: "down" };
    expect(pullsIntoWall(safe, BOARD_WIDTH)).toBe(false);
    for (const r of [1, 2, 3] as const) {
      const turned = rotateGravityWell(safe, r);
      expect(
        pullsIntoWall(turned, BOARD_WIDTH),
        `orientation ${r} must not push a safe well onto the edge it pulls at`,
      ).toBe(false);
    }
  });
});

describe("the four bearings", () => {
  const at = (pull: GravityWell["pull"]) =>
    wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...WELL, pull }], 1 / 60)!;

  it("bend a rightward ball toward the pull, each its own way", () => {
    expect(at("down").y).toBeGreaterThan(0);
    expect(at("up").y).toBeLessThan(0);
    // Already flying right: a rightward pull has nothing to bend.
    expect(at("right").y).toBeCloseTo(0, 6);
    expect(at("right").x).toBeCloseTo(200, 6);
  });

  it("keep the speed exactly, whichever way they pull", () => {
    for (const pull of ["down", "up", "left", "right"] as const) {
      expect(Math.hypot(at(pull).x, at(pull).y), pull).toBeCloseTo(200, 6);
    }
  });

  it("resolve a head-on pull rather than stalling on it", () => {
    // The one case a steering rule has to be explicit about: a perfectly
    // opposed pull has no side to turn toward unless the maths picks one.
    const out = wellStep(
      { x: 400, y: 400 }, { x: 200, y: 0 }, [{ ...WELL, pull: "left" }], 1 / 60,
    )!;
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(200, 6);
    expect(out.x).toBeLessThan(200);
  });

  it("treat an absent or nonsense bearing as down", () => {
    expect(wellPull(WELL)).toBe("down");
    expect(wellPull({ ...WELL, pull: "sideways" as GravityWell["pull"] })).toBe("down");
    const plain = wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [WELL], 1 / 60)!;
    expect(plain.y).toBeGreaterThan(0);
  });

  it("check the edge they actually pull at, not always the floor", () => {
    const near = { width: 200, height: 150 };
    expect(pullsIntoWall({ x: 300, y: 700, ...near, pull: "down" }, BOARD_WIDTH)).toBe(true);
    expect(pullsIntoWall({ x: 300, y: 700, ...near, pull: "up" }, BOARD_WIDTH)).toBe(false);
    expect(pullsIntoWall({ x: 300, y: 10, ...near, pull: "up" }, BOARD_WIDTH)).toBe(true);
    expect(pullsIntoWall({ x: 10, y: 300, ...near, pull: "left" }, BOARD_WIDTH)).toBe(true);
    expect(pullsIntoWall({ x: 690, y: 300, ...near, pull: "right" }, BOARD_WIDTH)).toBe(true);
    expect(pullsIntoWall({ x: 690, y: 300, ...near, pull: "left" }, BOARD_WIDTH)).toBe(false);
  });
});

/**
 * Dormant wells: visible the whole map, inert until the board has been cleared
 * down to a threshold. LEVELDESIGN.md's "Turn" in well form.
 *
 * What makes it a Turn rather than an ambush is that the well is DRAWN while
 * dormant, so a player sees it coming and plans around it. That half lives in
 * the renderer; what is testable here is that it genuinely does nothing until
 * it wakes, and that "nothing cleared yet" reads as asleep rather than awake.
 */
describe("a dormant well", () => {
  const SLEEPER: GravityWell = { ...WELL, activeFrom: 55 };
  const pull = (remaining: number | undefined) =>
    wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [SLEEPER], 1 / 60, remaining);

  it("does nothing while the board is still full", () => {
    expect(pull(100)).toBeNull();
    expect(pull(80)).toBeNull();
  });

  it("wakes once cleared space reaches its threshold", () => {
    expect(pull(55)).not.toBeNull();
    expect(pull(20)).not.toBeNull();
    expect(pull(55)!.y).toBeGreaterThan(0);
  });

  /**
   * Space remaining is undefined until the first cut of a map resolves. Reading
   * that as an empty board would wake every dormant well for the opening
   * seconds of every map and then put it back to sleep, which is the exact
   * opposite of the intended beat and would look like a physics bug.
   */
  it("treats an unknown board as a full one, not an empty one", () => {
    expect(pull(undefined)).toBeNull();
    expect(pull(Number.NaN)).toBeNull();
    expect(wellIsLive(SLEEPER, undefined)).toBe(false);
  });

  it("leaves a well with no threshold live from the first frame", () => {
    expect(wellIsLive(WELL, undefined)).toBe(true);
    expect(wellStep({ x: 400, y: 400 }, { x: 200, y: 0 }, [WELL], 1 / 60, 100)).not.toBeNull();
  });

  it("is still found by a dormancy-blind lookup, so it can be drawn", () => {
    expect(wellAt(400, 400, [SLEEPER])).toBe(SLEEPER);
    expect(liveWellAt(400, 400, [SLEEPER], 100)).toBeNull();
    expect(liveWellAt(400, 400, [SLEEPER], 40)).toBe(SLEEPER);
  });

  it("does not shadow a live well sharing the same patch", () => {
    expect(liveWellAt(400, 400, [SLEEPER, WELL], 100)).toBe(WELL);
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
  it("never rests a well on the edge it pulls toward", () => {
    for (const l of withWells) {
      for (const w of l.gravityWells!) {
        expect(
          pullsIntoWall(w, BOARD_WIDTH),
          `${l.id}: a well this close to the edge it pulls at pins balls against it`,
        ).toBe(false);
      }
    }
  });

  /**
   * And in every orientation the map can actually be dealt in, which is the
   * guarantee the author is really relying on. Checking only the authored
   * orientation would have passed happily back when the pull did not rotate,
   * while three runs in four shipped a well pinned against a wall.
   */
  it("holds in all four orientations the map can be dealt in", () => {
    for (const l of withWells) {
      for (const w of l.gravityWells!) {
        for (const r of [0, 1, 2, 3] as const) {
          expect(
            pullsIntoWall(rotateGravityWell(w, r), BOARD_WIDTH),
            `${l.id} in orientation ${r}`,
          ).toBe(false);
        }
      }
    }
  });

  /** A dormant well nobody can reach the threshold of never wakes. */
  it("keeps every dormancy threshold reachable", () => {
    for (const l of withWells) {
      for (const w of l.gravityWells!) {
        if (w.activeFrom == null) continue;
        expect(w.activeFrom, `${l.id}: threshold out of range`).toBeGreaterThan(0);
        expect(w.activeFrom, `${l.id}: threshold out of range`).toBeLessThanOrEqual(100);
        // The map is won at sizeThreshold% remaining, so a well that wakes at
        // or below it wakes exactly as the map ends, i.e. never in practice.
        expect(
          w.activeFrom,
          `${l.id}: wakes at ${w.activeFrom}% but the map is already won at ${l.sizeThreshold}%`,
        ).toBeGreaterThan(l.sizeThreshold);
      }
    }
  });
});

// ── The map builder ─────────────────────────────────────────────────────────

/**
 * The builder has to be able to author a well, or every one has to be typed
 * into map.yml by hand next to a coordinate system nobody can see.
 *
 * A source check because the wiring is optional props: I made onSelectWell,
 * onAddWell and the rest optional so the canvas and panel keep working for
 * callers that do not care, which means a half-wired builder typechecks
 * perfectly and silently does nothing when you click.
 */
describe("the map builder can author wells", () => {
  const read = (f: string) =>
    readFileSync(resolve(__dirname, `../components/admin/${f}`), "utf8");
  const CANVAS = read("MapCanvas.tsx");
  const PANEL = read("EntityPanel.tsx");
  const BUILDER = read("MapBuilder.tsx");

  it("draws them on the canvas", () => {
    expect(CANVAS).toMatch(/level\.gravityWells/);
  });

  it("hit-tests them ABOVE areas, matching the draw order", () => {
    const wellHit = CANVAS.indexOf("return { type: 'well', id: '', wellIndex: i }");
    const areaHit = CANVAS.indexOf("return { type: 'area', id: '', areaIndex: i }");
    expect(wellHit, "well hit-test missing").toBeGreaterThan(-1);
    expect(areaHit, "area hit-test missing").toBeGreaterThan(-1);
    expect(wellHit, "a well drawn over an area must take the click").toBeLessThan(areaHit);
  });

  it("supports moving and resizing, not just placing", () => {
    expect(CANVAS).toMatch(/type: 'well';/);
    expect(CANVAS).toMatch(/type: 'well-resize';/);
  });

  it("adds, updates and deletes from the builder", () => {
    for (const fn of ["addWell", "updateWell", "deleteWell"]) {
      expect(BUILDER, `${fn} missing`).toMatch(new RegExp(`const ${fn} = useCallback`));
    }
  });

  it("drops the key entirely when the last well goes", () => {
    expect(BUILDER).toMatch(/delete next\.gravityWells/);
  });

  it("actually passes the handlers down, since the props are optional", () => {
    for (const prop of ["onAddWell", "onDeleteWell", "onUpdateWell", "onSelectWell"]) {
      expect(BUILDER, `${prop} never wired`).toContain(`${prop}={`);
    }
    expect(PANEL).toMatch(/onAddWell\?\.\(\)/);
  });

  it("lets the bend rate be edited, since it is the one tuning knob", () => {
    expect(PANEL).toMatch(/turnRate/);
  });
});

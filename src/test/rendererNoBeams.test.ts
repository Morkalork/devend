/**
 * No layer of the sleek renderer may draw a line across the board.
 *
 * The compass beam has now been reported three times and "fixed" twice. Both
 * fixes were real - `arc()` without a `moveTo` genuinely does draw from the
 * canvas origin to the arc's first point, and `ballLayerNoBeams` reproduces it
 * on demand - and the beam is still on screen on the deployed build, which is
 * byte-identical to HEAD. So it is drawn by something else, and every attempt
 * to name that something else by reading code has been wrong.
 *
 * This stops naming it. It drives EVERY layer over a real level and measures
 * every straight run in every Graphics in the display tree. The board is 900 x
 * 1600 world units; nothing any layer legitimately draws is a single straight
 * span of half the board. Whatever is drawing it, this sees it.
 *
 * The shared `shadowPlane` is swept too, and deliberately: five layers draw
 * into that one Graphics, which is exactly the shape of shared-path-state bug
 * that produced the first beam.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { Container, Graphics } from "pixi.js";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { lightScope } from "@/lib/rendering/sleek/light";
import { BoardLayer } from "@/lib/rendering/sleek/boardLayer";
import { AreaLayer } from "@/lib/rendering/sleek/areaLayer";
import { PropLayer } from "@/lib/rendering/sleek/propLayer";
import { EntityLayer } from "@/lib/rendering/sleek/entityLayer";
import { ObjectLayer } from "@/lib/rendering/sleek/objectLayer";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { FxLayer } from "@/lib/rendering/sleek/fxLayer";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { ChromeLayer } from "@/lib/rendering/sleek/chromeLayer";
import type { LevelData, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";
import { boardAngleFor } from "@/lib/boardTilt";
import { tiltWorldPoint } from "@/lib/boardConstants";

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

/**
 * The transform, chosen so the origin is a TELL.
 *
 * Every layer is handed a world-to-screen that offsets by (100, 200) and
 * halves. Legitimate geometry therefore lives in [100,550] x [200,1000], and
 * NOTHING a layer draws on purpose can land on (0,0). So a path point at the
 * origin is not a coincidence to be judged by length - it is a subpath that was
 * never opened, which is precisely the beam: Pixi joins the shape to wherever
 * the path last was, and on a freshly cleared Graphics that is (0,0).
 *
 * This is why the earlier "longest span" idea was wrong. Board grid lines,
 * fences and area outlines are all legitimately board-length, so length cannot
 * separate them from a beam. The origin can.
 */
const W2S = (x: number, y: number) => ({ x: 100 + x * 0.5, y: 200 + y * 0.5 });

/**
 * The path preview ON, because the screenshots plainly have it: the green
 * dashes are right there next to the beam. With prediction at its default zero
 * the fx layer skips the trajectory entirely, and the trajectory is the one
 * thing in that layer that draws a long line starting at a ball.
 */
const PREDICTING: GameModifiers = {
  ...DEFAULT_MODIFIERS,
  ballPathPredictionBounces: 3,
  ballPathPredictionBalls: 100,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function graphicsIn(node: Container, found: Graphics[] = []): Graphics[] {
  if (node instanceof Graphics) found.push(node);
  for (const child of node.children ?? []) graphicsIn(child as Container, found);
  return found;
}

function strayOriginPoints(g: any): string[] {
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);

  const strays: string[] = [];
  for (const path of paths) {
    for (const prim of path.shapePath?.shapePrimitives ?? []) {
      const pts: number[] = (prim.shape as any).points ?? [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        if (Math.hypot(pts[i], pts[i + 1]) > 0.5) continue;
        const nx = pts[i + 2], ny = pts[i + 3];
        strays.push(
          `${prim.shape.type} starts at the origin then runs to `
          + `(${nx?.toFixed(0) ?? "-"},${ny?.toFixed(0) ?? "-"})`,
        );
      }
    }
  }
  return strays;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A real level, mid-play, with a compass ball on it.
 *
 * The roster is forced rather than rolled: the beam has only ever been seen
 * with a compass ball on the board, and leaving that to a 1-in-N draw would
 * make this test pass most of the time for the wrong reason.
 */
/**
 * The gravity mutator, as public/mapMutators.yml authors it.
 *
 * The reporter's session had "gravity over the whole map", and that is not a
 * variation on the ordinary case - it is a different renderer. A gravity map
 * TURNS, so `boardAngleFor` becomes non-zero and every layer is handed a
 * ROTATED world-to-screen. Every earlier sweep ran the identity transform, so
 * the entire tilted path was untested.
 */
const GRAVITY_CFG = {
  turnRate: 1.1,
  period: 9,
  sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
};

function stateWithCompass(level: LevelConfig, seconds: number, gravity = false): CanvasGameState {
  const data = createInitialGameData(level, level.level, DEFAULT_MODIFIERS);
  const game = data as unknown as CanvasGameState;
  game.activePlaySeconds = seconds;
  // createInitialGameData builds the model; the loop supplies the rest of the
  // frame. Fill in what the layers read so none of them silently no-ops.
  const g = game as unknown as Record<string, unknown>;
  g.boardRect = { left: 0, top: 0, width: 900, height: 1600, scale: 1 };
  g.pickups ??= [];
  g.pickupLockMarkers ??= [];
  g.ballPops ??= [];
  g.abilityFx ??= [];
  g.debris ??= [];
  g.fallingSlabs ??= [];
  g.lockFlashes ??= [];
  g.chains ??= [];
  g.wallImpacts ??= [];
  g.assimilations ??= new Map();
  // A fence mid-growth, because a fence being DRAWN is the state the beam has
  // never been photographed without, and an empty activeWalls skips the whole
  // growing-wall path.
  g.objectDebris ??= [];
  if (gravity) g.gravityConfig = GRAVITY_CFG;
  g.fallingObjects ??= [];
  g.pickupFeedback ??= [];
  g.swipeTrail ??= null;
  // A fence mid-growth in BOTH directions, because a fence being drawn is the
  // state the beam has never been photographed without, and an empty
  // activeWalls skips the growing-wall path entirely.
  g.activeWalls = [{
    origin: { x: 300, y: 400 },
    direction: { x: 0, y: 1 },
    startWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 120 }],
    endWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 700 }],
    startSegmentIndex: 0,
    endSegmentIndex: 0,
    startPoint: { x: 300, y: 260 },
    endPoint: { x: 300, y: 550 },
    targetStart: { x: 300, y: 120 },
    targetEnd: { x: 300, y: 700 },
    thickness: 6,
    isComplete: false,
    activeRegionId: "r0",
    startTime: 0,
  }];
  for (const ball of game.balls) {
    const b = ball as Ball & { nextTurnAt?: number; turnIntervalSeconds?: number };
    b.ability = "turnTimer";
    b.turnIntervalSeconds = 9;
    b.nextTurnAt = seconds + 4.5;
    b.color = "#c08cff";
  }
  return game;
}

describe("no layer of the renderer draws across the board", () => {
  const level = levels.find(l => l.id === "level-19")!;

  it("holds for every layer, over a whole compass cycle", () => {
    const w2s = W2S;
    const light = lightScope({ left: 0, top: 0, width: 900, height: 1600, scale: 1 }, 0);

    let swept = 0;
    const failures: string[] = [];
    const syncFailures = new Set<string>();

    for (let step = 0; step <= 8; step++) {
      const seconds = 1 + step;
      const game = stateWithCompass(level, seconds);

      const shadowPlane = new Graphics();
      const board = new BoardLayer();
      const areas = new AreaLayer();
      const props = new PropLayer();
      const entities = new EntityLayer();
      const objects = new ObjectLayer();
      const walls = new WallLayer();
      const fx = new FxLayer();
      const balls = new SleekBallLayer();
      const chrome = new ChromeLayer();

      shadowPlane.clear();
      const run = (name: string, fn: () => void) => {
        try { fn(); } catch (e) {
          const err = e as Error;
          console.log(`SYNC FAILED ${name}: ${(err.stack ?? err.message).slice(0, 260)}`);
          syncFailures.add(name);
        }
      };
      run("board", () => board.sync(game, light, w2s, true));
      run("areas", () => areas.sync(game, light, w2s, 1, null as never));
      run("props", () => props.sync(game, light, shadowPlane, w2s, 1, 0));
      run("entities", () => entities.sync(game, light, shadowPlane, w2s, 1));
      run("objects", () => objects.sync(game, light, shadowPlane, w2s, 1));
      run("walls", () => walls.sync(game, light, shadowPlane, w2s, 1));
      run("fx", () => fx.sync(game, light, PREDICTING, w2s, 1, 0));
      run("balls", () => balls.sync(game, light, shadowPlane, w2s, 1, 0));
      run("chrome", () => chrome.sync(game, light, 1, 0, 9));

      const named: Array<[string, Container | Graphics]> = [
        ["shadowPlane", shadowPlane],
        ["board", board.container], ["areas", areas.container],
        ["props", props.container], ["entities", entities.container],
        ["objects", objects.container], ["walls", walls.container],
        ["fx", fx.container], ["balls", balls.container],
        ["chrome", chrome.container],
      ];

      for (const [name, node] of named) {
        const gs = node instanceof Graphics ? [node] : graphicsIn(node);
        for (const g of gs) {
          swept++;
          for (const stray of strayOriginPoints(g)) {
            failures.push(`${name} @${seconds}s: ${stray}`);
          }
        }
      }
    }

    expect([...new Set(failures)].join(" | ") || "none", "stray origin points").toBe("none");

    // The whole point is that something was measured. A renderer that drew
    // nothing would sail through every assertion above.
    expect(swept, "no layer drew anything measurable").toBeGreaterThan(10);
    // A layer that threw drew NOTHING, so every assertion above passed for it
    // vacuously. That is the failure mode this whole file exists to avoid.
    expect([...syncFailures].join(", ") || "none", "layers that failed to sync").toBe("none");
  });

  /**
   * The same sweep on a map that is TURNING.
   *
   * "Everything started with gravity over the whole map" is what the reporter
   * said, and that is not a variation on the ordinary case - it is a different
   * renderer. A gravity map turns so its pull always reads as screen-down, so
   * `boardAngleFor` goes non-zero and every layer is handed a ROTATED
   * world-to-screen. Every sweep before this one ran the identity transform,
   * which means the whole tilted path was untested.
   *
   * Rotation is exactly where an untransformed coordinate stops being
   * invisible: a point some code forgot to put through w2s sits somewhere
   * plausible while the angle is zero, and swings away from everything else the
   * moment it is not.
   *
   * Walks the mutator's full 72-second sequence rather than one arbitrary
   * angle, so quiet stretches and turning stretches are both covered.
   */
  it("holds while the board is turning under gravity", () => {
    const light = lightScope({ left: 0, top: 0, width: 900, height: 1600, scale: 1 }, 0);
    const failures: string[] = [];
    let swept = 0;
    const angles = new Set<number>();

    for (let seconds = 1; seconds <= 72; seconds += 3) {
      const game = stateWithCompass(level, seconds, true);
      const angle = boardAngleFor(
        seconds,
        (game as unknown as { gravityConfig?: never }).gravityConfig,
        null,
      );
      angles.add(Math.round(angle * 100));

      // The renderer's own transform, composed exactly as SleekRenderer does:
      // tilt the world point, THEN place it. Offsetting after the rotation is
      // what keeps the origin a tell.
      const w2s = (x: number, y: number) => {
        const p = tiltWorldPoint(x, y, angle);
        return { x: 100 + p.x * 0.5, y: 200 + p.y * 0.5 };
      };

      const shadowPlane = new Graphics();
      const board = new BoardLayer(), areas = new AreaLayer(), props = new PropLayer();
      const entities = new EntityLayer(), objects = new ObjectLayer(), walls = new WallLayer();
      const fx = new FxLayer(), balls = new SleekBallLayer(), chrome = new ChromeLayer();

      const failed: string[] = [];
      const run = (name: string, fn: () => void) => {
        try { fn(); } catch { failed.push(name); }
      };
      run("board", () => board.sync(game, light, w2s, true));
      run("areas", () => areas.sync(game, light, w2s, 1, angle as never));
      run("props", () => props.sync(game, light, shadowPlane, w2s, 1, 0));
      run("entities", () => entities.sync(game, light, shadowPlane, w2s, 1));
      run("objects", () => objects.sync(game, light, shadowPlane, w2s, 1));
      run("walls", () => walls.sync(game, light, shadowPlane, w2s, 1));
      run("fx", () => fx.sync(game, light, PREDICTING, w2s, 1, 0));
      run("balls", () => balls.sync(game, light, shadowPlane, w2s, 1, 0));
      run("chrome", () => chrome.sync(game, light, 1, 0, 9));
      expect(failed.join(",") || "none", `sync failures @${seconds}s`).toBe("none");

      const named: Array<[string, Container | Graphics]> = [
        ["shadowPlane", shadowPlane], ["board", board.container], ["areas", areas.container],
        ["props", props.container], ["entities", entities.container],
        ["objects", objects.container], ["walls", walls.container],
        ["fx", fx.container], ["balls", balls.container], ["chrome", chrome.container],
      ];
      for (const [name, node] of named) {
        const gs = node instanceof Graphics ? [node] : graphicsIn(node);
        for (const g of gs) {
          swept++;
          for (const stray of strayOriginPoints(g)) failures.push(`${name} @${seconds}s: ${stray}`);
        }
      }
    }

    // The board really did turn through several angles rather than sit at zero,
    // or this is the untilted sweep wearing a different name.
    expect(angles.size, "the board never actually tilted").toBeGreaterThan(3);
    expect(swept, "no layer drew anything measurable").toBeGreaterThan(10);
    expect([...new Set(failures)].join(" | ") || "none", "stray origin points").toBe("none");
  });
});

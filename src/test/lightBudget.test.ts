/**
 * What the light model is allowed to cost.
 *
 * Every effect in this system is one more thing per ball per frame, and each
 * one on its own is cheap. The failure mode is not any single addition, it is
 * the eighth one landing on a board that is already carrying seven - so the
 * budget is pinned here, on a board heavier than any the game ships, as COUNTS
 * rather than as milliseconds.
 *
 * Counts, because a timing assertion on CI hardware measures the CI machine.
 * What the renderer asks the GPU to draw is identical everywhere, and it is
 * the number that actually moves when someone adds an emitter per wall instead
 * of per near wall - which is the mistake this is here to catch.
 *
 * The ratio at the end is the one timing check, and it is deliberately loose:
 * it is measured as OFF then ON inside a single process, so it survives a slow
 * machine, and it only has to catch something that has gone wrong by an order
 * of magnitude rather than by a few percent.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Graphics } from "pixi.js";
import { BallLightPass } from "@/lib/rendering/sleek/ballLightPass";
import { BounceLayer } from "@/lib/rendering/sleek/bounceLayer";
import { MoteLayer, AMBIENT_MOTES, RESIDUE_MOTES } from "@/lib/rendering/sleek/moteLayer";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import { createBallEffectState } from "@/lib/ballEffects";
import { registerWallImpact, updateWallImpacts, clearWallImpacts } from "@/lib/wallImpactEffects";
import { setLightLook, resetLightLookCache, DEFAULT_LIGHT_LOOK } from "@/lib/lightLook";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 } as never;
const COLORS = ["#ff4d5a", "#4db4ff", "#ffd24d", "#a78bfa", "#4ade80"];

/** Heavier than the game ships: 85 walls, 10 balls, a mirror, constant impacts. */
function heavyBoard() {
  const walls: Record<string, unknown>[] = [];
  const edge = (id: string, x1: number, y1: number, x2: number, y2: number) =>
    ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6, isBoardEdge: true });
  walls.push(edge("board-edge-0", 45, 45, 855, 45), edge("board-edge-1", 855, 45, 855, 855),
    edge("board-edge-2", 855, 855, 45, 855), edge("board-edge-3", 45, 855, 45, 45));
  let n = 0;
  for (let i = 1; i <= 20; i++) {
    const x = 45 + (810 * i) / 21, y = 45 + (810 * i) / 21;
    walls.push({ id: `fv${n++}`, start: { x, y: 45 }, end: { x, y: 450 }, thickness: 6 });
    walls.push({ id: `fv${n++}`, start: { x, y: 450 }, end: { x, y: 855 }, thickness: 6 });
    walls.push({ id: `fh${n++}`, start: { x: 45, y }, end: { x: 450, y }, thickness: 6 });
    walls.push({ id: `fh${n++}`, start: { x: 450, y }, end: { x: 855, y }, thickness: 6 });
  }
  walls.push({ id: "mirror-a", start: { x: 120, y: 700 }, end: { x: 400, y: 700 }, thickness: 10, isMirror: true });
  const balls = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return {
      id: `b${i}`,
      position: { x: 450 + Math.cos(a) * 300, y: 450 + Math.sin(a) * 300 },
      renderPosition: { x: 450 + Math.cos(a) * 300, y: 450 + Math.sin(a) * 300 },
      velocity: { x: Math.cos(a) * 250, y: Math.sin(a) * 250 },
      speed: 250, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
      radius: 18, color: COLORS[i % COLORS.length], state: "active", rotation: a,
      assimScale: 1, assimColorFade: 0, wonSpinSpeed: 0, wonTime: 0, flashIntensity: 0,
      regionId: "r", spawnTime: -99999, effects: createBallEffectState(),
    } as unknown as Ball;
  });
  const game = {
    balls, walls, obstaclePolygons: [], movers: [], chains: [], activeWalls: [],
    phasingObjects: [], activePlaySeconds: 8, assimilations: new Map(), boardRect: RECT,
    boardPolygon: { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] },
  } as unknown as CanvasGameState;
  return { game, balls, walls };
}

function rig() {
  const { game, balls, walls } = heavyBoard();
  const w2s = (x: number, y: number) => ({ x, y });
  const light = lightScope(RECT, 0);
  const pass = new BallLightPass();
  const bounce = new BounceLayer();
  const wall = new WallLayer();
  const motes = new MoteLayer();
  const shadows = new Graphics();

  const step = (t: number) => {
    for (const b of balls) {
      b.position.x += b.velocity.x / 120;
      b.position.y += b.velocity.y / 120;
      if (b.position.x < 70 || b.position.x > 830) b.velocity.x *= -1;
      if (b.position.y < 70 || b.position.y > 830) b.velocity.y *= -1;
      b.renderPosition = { x: b.position.x, y: b.position.y };
    }
    for (let k = 0; k < 3; k++) {
      const b = balls[k];
      registerWallImpact({ x: 45, y: 300 + k * 100 }, { x: 855, y: 300 + k * 100 },
        { x: b.position.x, y: 300 + k * 100 }, 0.8, b.position, b.color);
    }
    updateWallImpacts();
    wall.sync(game, light, shadows, w2s, 1);
    bounce.sync(game, w2s, 1);
    pass.build(game, w2s, 1, t, light);
    motes.sync(game, pass.worldLights, w2s, 1, t);
  };
  return { step, pass, bounce, wall, motes, shadows, walls, balls, game };
}

/** Emitters actually composed this frame. */
function emitters(pass: BallLightPass): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (pass as unknown as any).live;
}

beforeEach(() => {
  resetLightLookCache();
  localStorage.clear();
  clearWallImpacts();
});

describe("the light budget on a board heavier than any that ships", () => {
  it("keeps emitters proportional to the BALLS, not to the walls", () => {
    // The mistake worth catching. 85 walls and 10 balls: every effect here is
    // per ball, per near wall or per event, and none is per wall - so the
    // count has to stay in the low tens. An emitter per wall would be 85 on
    // its own and would not trip a timing test on a fast machine.
    const { step, pass, walls, balls } = rig();
    for (let i = 0; i < 20; i++) step(performance.now());
    expect(walls.length).toBeGreaterThan(80);
    expect(emitters(pass)).toBeLessThan(balls.length * 5);
    expect(emitters(pass)).toBeGreaterThan(balls.length);   // it is doing something
  });

  it("keeps bounce sprites in the low hundreds, not one per wall per ball", () => {
    const { step, bounce, walls, balls } = rig();
    for (let i = 0; i < 20; i++) step(performance.now());
    const sprites = bounce.onWalls.children.length + bounce.onFrame.children.length
      + bounce.onBalls.children.length;
    // Pooled, so this is the high-water mark rather than the live count. The
    // ceiling that matters is that it is nowhere near walls x balls.
    expect(sprites).toBeLessThan(walls.length * balls.length * 0.5);
  });

  it("bounds the shadow quads a single emitter can draw", () => {
    // MAX_OCCLUDERS_PER_LIGHT exists so a fence tangle cannot turn one frame
    // into thousands of quads. Balls are in the occluder loop now too, so the
    // per-emitter ceiling is that cap plus the ball count.
    const { step, pass, balls } = rig();
    for (let i = 0; i < 20; i++) step(performance.now());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const es = (pass as unknown as any).emitters as { shade: { context: { instructions: unknown[] } } }[];
    for (const e of es.slice(0, emitters(pass))) {
      expect(e.shade.context.instructions.length).toBeLessThanOrEqual(40 + balls.length + 2);
    }
  });

  it("keeps the mote field a fixed size, however long the game runs", () => {
    // The field never grows: ambient motes WRAP rather than respawning, and
    // residue is a ring that overwrites its oldest. A particle system that
    // allocates per event is one that gets slower the longer you play, which
    // is the failure nobody notices until a long run.
    const { step, motes } = rig();
    for (let i = 0; i < 30; i++) step(performance.now());
    const first = motes.lit;
    for (let i = 0; i < 200; i++) step(performance.now());
    expect(motes.lit).toBeLessThan(AMBIENT_MOTES + RESIDUE_MOTES);
    expect(first).toBeGreaterThanOrEqual(0);
    // Two meshes for the whole field, whatever is in it: one draw each.
    expect(motes.container.children.length).toBe(2);
  });

  it("lights only the motes near a pool, never the whole field", () => {
    // The honest version of "invisible until light finds it": with ten balls
    // on an 85-wall board, the lit fraction has to stay a small minority or
    // the specks have become a texture over the board rather than air in it.
    const { step, motes } = rig();
    for (let i = 0; i < 40; i++) step(performance.now());
    expect(motes.lit).toBeLessThan(AMBIENT_MOTES * 0.5);
  });

  it("costs a fraction of the frame it already spent, not a multiple of it", () => {
    // The one timing check, measured OFF then ON in ONE process so it compares
    // like with like on whatever machine is running it. Loose on purpose: it
    // is here to catch an order-of-magnitude mistake, not to police percents.
    const { step } = rig();
    const run = () => {
      for (let i = 0; i < 40; i++) step(performance.now());
      const t0 = performance.now();
      for (let i = 0; i < 120; i++) step(performance.now());
      return performance.now() - t0;
    };
    setLightLook({
      bounce: 0, reflected: 0, caustic: 0, flash: 0, tell: 0, ballShadows: 0,
      reaction: 0, motes: 0,
    });
    const off = run();
    setLightLook(DEFAULT_LIGHT_LOOK);
    const on = run();
    expect(on).toBeLessThan(off * 2);
  });
});

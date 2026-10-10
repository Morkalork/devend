/**
 * The 3D board (RENDER_3D_PLAN.md, rendering/three).
 *
 * What a screenshot cannot pin and a player would notice at once: the floor
 * landing on exactly the 2D board's pixels (input aims at those), the tilt
 * turning the 3D board exactly as it turns the 2D one, the light model's rules
 * carried over from light.ts, a lamp-ball's light and shadow, the walls and
 * solids standing where the 2D layers draw their tops, explosions read off the
 * same state the 2D fx layer reads, and the fallback chain that keeps a phone
 * the 3D board will not start on playable.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Group, Quaternion, Vector3 } from "three";
import { computeBoardRect, fitScale, tiltWorldPoint } from "@/lib/boardConstants";
import {
  BOARD_CENTRE, boardTiltElements, eyeDistance, floorCamera, projectToSurface, surfaceToFloor,
} from "@/lib/rendering/three/floorCamera";
import { collectWallRuns } from "@/lib/rendering/three/walls3d";
import { collectSolids, extrude } from "@/lib/rendering/three/solids3d";
import { ballPose, parallaxFactor, patternIndex, rollStep, shellContrast } from "@/lib/rendering/three/balls3d";
import { BALL_PATTERNS, getAllBallTypes } from "@/lib/ballTypes";
import { haloStops, CORONA_RADII } from "@/lib/rendering/sleek/bulb";
import {
  monitorConeAngle, monitorPlacement, roomLevel, wantedLights,
} from "@/lib/rendering/three/lights3d";
import { Explosions3D, blastEnvelope, BLAST_MS } from "@/lib/rendering/three/explosions3d";
import { shoulder, SHOULDER_KNEE } from "@/lib/rendering/three/outputPass";
import { QualityGovernor, QUALITY_PRESETS, stepDown } from "@/lib/rendering/three/quality";
import { poolLightsChunk } from "@/lib/rendering/three/surfaceMaterial";
import {
  autoTier, getFov, getHeightScale, getQualitySetting, getRendererChoice, setFov, setHeightScale,
  setQualitySetting, setRendererChoice, FOV_RANGE, HEIGHT_RANGE, RENDERER_KEY,
} from "@/lib/rendering/render3dSettings";
import { BallLightPass } from "@/lib/rendering/sleek/ballLightPass";
import { SLAB_HEIGHT_WORLD } from "@/lib/rendering/sleek/light";
import { MIN_MAP_LIGHT } from "@/lib/rendering/sleek/boardWash";
import { BOARD_FRAME_THICKNESS } from "@/lib/boardConstants";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function game(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    walls: [], activeWalls: [], obstaclePolygons: [], mirrorPolygons: [], movers: [],
    balls: [], destructibles: [], objectDebris: [], charges: [], rubble: [],
    boardPolygon: { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] },
    ...over,
  } as unknown as CanvasGameState;
}

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b", position: { x: 400, y: 300 }, velocity: { x: 0, y: 0 }, radius: 18,
    color: "#ff5b5b", state: "active", assimScale: 1, assimColorFade: 0,
    effects: { squishAmount: 0 },
    ...over,
  } as unknown as Ball;
}

describe("the floor lands on the 2D board's pixels", () => {
  const SURFACES: Array<[number, number, number]> = [[780, 1341, 284], [1600, 600, 100], [1179, 2556, 400]];

  it("projects every floor point exactly where boardRect puts it", () => {
    for (const [w, h, inset] of SURFACES) {
      const rect = computeBoardRect(w, h, inset);
      for (const fov of [8, 26, 50]) {
        const cam = floorCamera(w, h, rect, fov);
        for (const [x, z] of [[0, 0], [900, 900], [450, 450], [45, 855], [720, 130]]) {
          const p = projectToSurface(cam, w, h, x, 0, z);
          expect(p.x, `${w}x${h} fov ${fov} (${x},${z}) x`).toBeCloseTo(rect.left + x * rect.scale, 3);
          expect(p.y, `${w}x${h} fov ${fov} (${x},${z}) y`).toBeCloseTo(rect.top + z * rect.scale, 3);
        }
      }
    }
  });

  it("leans raised things OUT from the board's centre, a few units at most", () => {
    // The sliver of wall side that makes a fence read as standing. Outward,
    // and small: at the default view a fence top at the edge moves a few
    // world units, not enough to aim at the wrong thing.
    const rect = computeBoardRect(780, 1341, 284);
    const cam = floorCamera(780, 1341, rect);
    const foot = projectToSurface(cam, 780, 1341, 855, 0, 450);
    const top = projectToSurface(cam, 780, 1341, 855, SLAB_HEIGHT_WORLD, 450);
    const lean = (top.x - foot.x) / rect.scale;
    expect(lean).toBeGreaterThan(1);
    expect(lean).toBeLessThan(5);
    // The centre does not lean at all.
    const c0 = projectToSurface(cam, 780, 1341, 450, 0, 450);
    const c1 = projectToSurface(cam, 780, 1341, 450, SLAB_HEIGHT_WORLD, 450);
    expect(c1.x).toBeCloseTo(c0.x, 6);
  });

  it("puts the eye over the board's centre, further away for a narrower view", () => {
    const rect = computeBoardRect(780, 1341, 284);
    const cam = floorCamera(780, 1341, rect, 26);
    expect(cam.eye).toEqual({ x: BOARD_CENTRE, y: eyeDistance(26), z: BOARD_CENTRE });
    expect(eyeDistance(10)).toBeGreaterThan(eyeDistance(40));
  });

  it("reads a surface pixel back onto the floor", () => {
    const rect = computeBoardRect(780, 1341, 284);
    const f = surfaceToFloor(rect, rect.left + 300 * rect.scale, rect.top + 610 * rect.scale);
    expect(f.x).toBeCloseTo(300, 6);
    expect(f.z).toBeCloseTo(610, 6);
  });
});

describe("the 3D board tilts exactly as the 2D one", () => {
  it("maps every world point where tiltWorldPoint does", () => {
    for (const angle of [0, 0.3, Math.PI / 4, Math.PI / 2, -1.1, Math.PI]) {
      const e = boardTiltElements(angle, fitScale(angle));
      for (const [x, y] of [[0, 0], [900, 0], [450, 450], [120, 780]]) {
        const tx = e[0] * x + e[8] * y + e[12];
        const tz = e[2] * x + e[10] * y + e[14];
        const want = tiltWorldPoint(x, y, angle);
        expect(tx).toBeCloseTo(want.x, 6);
        expect(tz).toBeCloseTo(want.y, 6);
      }
      // Heights shrink with the board, so nothing pokes out of a turning one.
      expect(e[5]).toBeCloseTo(fitScale(angle), 9);
    }
  });

  it("is resolved through the same function the 2D renderer and input use", () => {
    const src = read("src/lib/rendering/three/ThreeRenderer.ts");
    expect(src).toMatch(/boardAngleFor\(game\.activePlaySeconds, game\.gravityConfig, game\.boardTilt\)/);
  });
});

describe("walls stand where the 2D layer draws them", () => {
  it("frames the visible outline, pushed out, taller than a fence", () => {
    const runs = collectWallRuns(game(), 1);
    const frame = runs.filter(r => r.thickness === BOARD_FRAME_THICKNESS);
    expect(frame).toHaveLength(4);
    for (const r of frame) expect(r.height).toBeGreaterThan(SLAB_HEIGHT_WORLD);
    // Outside the play area: the frame's centreline is half its thickness out.
    expect(Math.min(...frame.map(r => Math.min(r.ay, r.by)))).toBeCloseTo(45 - BOARD_FRAME_THICKNESS / 2, 6);
  });

  it("clips a fence round the obstacle it crosses, and skips board and obstacle edges", () => {
    const slab = { vertices: [{ x: 400, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 400 }, { x: 400, y: 400 }] };
    const runs = collectWallRuns(game({
      obstaclePolygons: [slab],
      walls: [
        { id: "fence-1", start: { x: 100, y: 350 }, end: { x: 800, y: 350 }, thickness: 6 },
        { id: "board-top", start: { x: 45, y: 45 }, end: { x: 855, y: 45 }, thickness: 6 },
        { id: "obstacle-0-edge-0", start: { x: 400, y: 300 }, end: { x: 500, y: 300 }, thickness: 6, isObstacleBoundary: true },
      ],
    } as unknown as Partial<CanvasGameState>), 1).filter(r => r.thickness === 6);
    expect(runs).toHaveLength(2);
    expect(runs.every(r => Math.max(r.ax, r.bx) <= 400.01 || Math.min(r.ax, r.bx) >= 499.99)).toBe(true);
  });

  it("raises the cut being drawn, leg by leg", () => {
    const runs = collectWallRuns(game({
      activeWalls: [{
        startWaypoints: [{ x: 300, y: 300 }, { x: 100, y: 300 }], startSegmentIndex: 0, startPoint: { x: 250, y: 300 },
        endWaypoints: [{ x: 300, y: 300 }, { x: 800, y: 300 }], endSegmentIndex: 0, endPoint: { x: 380, y: 300 },
        thickness: 6,
      }],
    } as unknown as Partial<CanvasGameState>), 1).filter(r => r.thickness === 6);
    expect(runs.map(r => Math.round(Math.abs(r.bx - r.ax)))).toEqual([50, 80]);
  });

  it("scales with the Admin height knob", () => {
    const tall = collectWallRuns(game({
      walls: [{ id: "f", start: { x: 100, y: 350 }, end: { x: 800, y: 350 }, thickness: 6 }],
    } as unknown as Partial<CanvasGameState>), 2).find(r => r.thickness === 6)!;
    expect(tall.height).toBeCloseTo(SLAB_HEIGHT_WORLD * 2, 9);
  });
});

describe("solids", () => {
  const square = (x: number, y: number) => ({ vertices: [{ x, y }, { x: x + 50, y }, { x: x + 50, y: y + 50 }, { x, y: y + 50 }] });

  it("extrudes obstacles but never a portal, and sinks a pillar as it phases out", () => {
    const wall = square(100, 100), portal = square(300, 300), pillar = square(500, 500), gone = square(700, 700);
    const solids = collectSolids(game({
      obstaclePolygons: [wall, portal, pillar, gone],
      portals: new Map([[portal, { centre: { x: 325, y: 325 }, radius: 25 }]]),
      phasingObjects: [
        { polygon: pillar, alpha: 0.5, phase: "out" },
        { polygon: gone, alpha: 0, phase: "out" },
      ],
    } as unknown as Partial<CanvasGameState>), 1, 0);
    expect(solids).toHaveLength(2);
    expect(solids[0].height).toBeCloseTo(SLAB_HEIGHT_WORLD, 9);
    expect(solids[1].height).toBeCloseTo(SLAB_HEIGHT_WORLD * 0.5, 9);
  });

  it("builds tops that face up and sides that face out, whichever way a polygon winds", () => {
    for (const verts of [square(0, 0).vertices, [...square(0, 0).vertices].reverse()]) {
      const g = extrude([{ vertices: verts, height: 10 }]);
      const pos = g.getAttribute("position");
      const idx = g.getIndex()!;
      const at = (i: number) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      for (let t = 0; t < idx.count; t += 3) {
        const a = at(idx.getX(t)), b = at(idx.getX(t + 1)), c = at(idx.getX(t + 2));
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        if (Math.abs(n.y) > 0.9) {
          expect(n.y, "a top must face up").toBeGreaterThan(0);
        } else {
          // Outward from the square's centre (25, *, 25).
          const out = new Vector3(mid.x - 25, 0, mid.z - 25);
          expect(n.dot(out), "a side must face out").toBeGreaterThan(0);
        }
      }
    }
  });

  it("samples a side's colour from inside the slab, not its antialiased edge", () => {
    const g = extrude([{ vertices: square(0, 0).vertices, height: 10 }]);
    const ins = g.getAttribute("aSampleInset");
    const pos = g.getAttribute("position");
    for (let i = 4; i < pos.count; i++) {
      // Side vertex + inset lands strictly inside the square.
      const x = pos.getX(i) + ins.getX(i), z = pos.getZ(i) + ins.getY(i);
      expect(x > 0 && x < 50 && z > 0 && z < 50, `vertex ${i}`).toBe(true);
    }
  });
});

describe("balls", () => {
  it("roll about up x motion by distance / radius", () => {
    const q = new Quaternion();
    expect(rollStep(q, 18 * Math.PI / 2, 0, 18)).toBe(true);
    // A quarter turn rolling along +x: the top of the ball heads for +x.
    const top = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(top.x).toBeCloseTo(1, 6);
    expect(top.y).toBeCloseTo(0, 6);
  });

  it("do not spin on a warp", () => {
    const q = new Quaternion();
    expect(rollStep(q, 400, 0, 18)).toBe(false);
    expect(q.w).toBe(1);
  });

  it("keep the 2D body's colour and dimming rules", () => {
    const now = 10_000;
    expect(ballPose(ball({ state: "dormant", spawnTime: 0 } as Partial<Ball>), now, null).alpha).toBeCloseTo(0.5, 6);
    expect(ballPose(ball({ state: "won", spawnTime: 0 } as Partial<Ball>), now, null).alpha).toBeCloseTo(0.72, 6);
    expect(ballPose(ball({ spawnTime: 0 } as Partial<Ball>), now, null).color).toBe(0xff5b5b);
  });

  it("flatten against the wall they hit and keep their face on it", () => {
    const b = ball({
      spawnTime: 0,
      effects: { squishAmount: 1, splatD: 0.35, splatV: 0, splatW: 0, splatStretch: 0, squishNx: 1, squishNy: 0 },
    } as unknown as Partial<Ball>);
    const pose = ballPose(b, 10_000, null);
    // Shorter along the normal (x), no narrower across it.
    expect(pose.a[0]).toBeLessThan(1);
    expect(pose.a[3]).toBeGreaterThanOrEqual(1);
    // The centre moves toward the wall (-x) by what the squash took.
    expect(pose.x).toBeLessThan(400);
  });

  it("sit under their 2D glow: nudged in by the parallax of their height", () => {
    expect(parallaxFactor(2000, 18)).toBeCloseTo(1982 / 2000, 9);
    expect(parallaxFactor(2000, 0)).toBe(1);
  });
});

describe("the lights keep light.ts's rules", () => {
  it("places the monitor past the bottom-right corner, where 2D shadows say it is", () => {
    const at = monitorPlacement();
    expect(at.x).toBeGreaterThan(900);
    expect(at.z).toBeGreaterThan(900);
    // A slab at the centre throws 1.15x its height, the 2D SHADOW_LENGTH.
    const d = Math.hypot(at.x - 450, at.z - 450);
    expect(SLAB_HEIGHT_WORLD * d / (at.y - SLAB_HEIGHT_WORLD)).toBeCloseTo(SLAB_HEIGHT_WORLD * 1.15, 0);
  });

  it("aims a cone that takes in every corner of the board", () => {
    expect(monitorConeAngle(monitorPlacement())).toBeGreaterThan(0.1);
    const src = read("src/lib/rendering/three/lights3d.ts");
    expect(src).toMatch(/monitorConeAngle\(at\) \/ \(1 - MONITOR_PENUMBRA\)/);
  });

  it("ranks the lamp, then explosions, then balls by brightness, then the rest", () => {
    const wanted = wantedLights(
      [
        { x: 1, y: 1, reach: 90, intensity: 0.2, color: 1, ballId: "dim" },
        { x: 2, y: 2, reach: 90, intensity: 0.9, color: 1, ballId: "bright" },
        { x: 3, y: 3, reach: 60, intensity: 2, color: 1 },
      ],
      [{ x: 5, y: 5, height: 30, reach: 200, intensity: 1, color: 2 }],
      new Map([["dim", { x: 10, z: 10, y: 18 }], ["bright", { x: 20, z: 20, y: 18 }]]),
      { x: 50, y: 60, level: 1, color: 0x0000ff },
    );
    expect(wanted.map(w => w.rank)).toEqual([0, 1, 2, 2, 3]);
    expect(wanted[2].ballId).toBe("bright");
    // A ball's light sits at the ball's own centre, not the 2D list's point.
    expect([wanted[2].x, wanted[2].y, wanted[2].height]).toEqual([20, 20, 18]);
    // The lamp is mostly white: a board-wide light in a ball's colour would
    // repaint the whole board.
    expect(wanted[0].color & 0xff0000).toBeGreaterThan(0x800000);
  });

  it("darkens a dark map as far as the 2D wash did, and no further", () => {
    expect(roomLevel(1)).toBe(1);
    expect(roomLevel(undefined)).toBe(1);
    expect(roomLevel(MIN_MAP_LIGHT)).toBeCloseTo(0.62, 6);
    expect(roomLevel(0)).toBeCloseTo(0.62, 6);
  });

  it("keeps the light pool a fixed size, so no shader recompiles mid-map", () => {
    for (const p of Object.values(QUALITY_PRESETS)) {
      expect(p.shadowedLights).toBeGreaterThanOrEqual(1);
      expect(p.shadowedLights + p.plainLights).toBeGreaterThanOrEqual(5);
    }
    const src = read("src/lib/rendering/three/lights3d.ts");
    // Lights are parked at zero, never removed or hidden (either recompiles).
    expect(src).not.toMatch(/\.visible\s*=\s*false/);
    expect(src).toMatch(/l\.intensity = 0;/);
    // ...and every shadowed one gets its map made at once (see the comment).
    expect(src).toMatch(/l\.shadow\.needsUpdate = true;/);
  });

  it("swaps only the point lights' step for the pool step", () => {
    const chunk = poolLightsChunk();
    expect(chunk).toMatch(/poolK/);
    const spot = chunk.slice(chunk.indexOf("#if ( NUM_SPOT_LIGHTS > 0 )"));
    expect(spot).not.toMatch(/poolK/);
    expect(chunk.match(/uPoolWrap/g)).toHaveLength(1);
  });
});

describe("the light list comes from the 2D pass", () => {
  it("lists every ball's light with its ball, and draws no shadow in lights-only mode", () => {
    const pass = new BallLightPass();
    pass.build({
      balls: [ball({ id: "a" }), ball({ id: "c", position: { x: 200, y: 300 } })],
      walls: [{ id: "w", start: { x: 430, y: 260 }, end: { x: 430, y: 340 }, thickness: 6 }],
      activeWalls: [],
    } as unknown as CanvasGameState, (x, y) => ({ x, y }), 1, undefined, undefined, true);
    expect(pass.worldLights.filter(l => l.ballId).map(l => l.ballId).sort()).toEqual(["a", "c"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shades = ((pass as any).emitters as Array<{ shade: { visible: boolean } }>);
    expect(shades.every(e => !e.shade.visible)).toBe(true);
    pass.destroy();
  });
});

describe("explosions", () => {
  it("snap on and fade, and are gone when the blast is over", () => {
    expect(blastEnvelope(-0.1)).toBe(0);
    expect(blastEnvelope(1)).toBe(0);
    expect(blastEnvelope(0.06)).toBeGreaterThan(blastEnvelope(0.5));
    expect(blastEnvelope(0.5)).toBeGreaterThan(blastEnvelope(0.9));
  });

  it("read a breaking object off the same state the 2D debris is drawn from", () => {
    const fx = new Explosions3D(new Group(), 64);
    const debris = {
      startTime: 1000, durationMs: 900, color: "#ffb454",
      particles: Array.from({ length: 30 }, (_, i) => ({
        x: 400 + Math.cos(i) * 20, y: 300 + Math.sin(i) * 20, vx: Math.cos(i) * 100, vy: Math.sin(i) * 100,
        rotation: 0, rotSpeed: 1, size: 8,
      })),
    };
    const g = game({ objectDebris: [debris] } as unknown as Partial<CanvasGameState>);
    fx.sync(g, 1000);
    expect(fx.lights).toHaveLength(1);
    expect(fx.lights[0].x).toBeCloseTo(400, 0);
    // Seen once, not every frame.
    fx.sync(g, 1100);
    expect(fx.lights).toHaveLength(1);
    fx.sync(g, 1000 + BLAST_MS + 10);
    expect(fx.lights).toHaveLength(0);
    fx.dispose();
  });

  it("go off where a Deploy Charge goes off", () => {
    const fx = new Explosions3D(new Group(), 64);
    const charge = { fuse: { x: 100, y: 200 }, blown: false, blastRadius: 120, targetId: "x" };
    const g = game({ charges: [charge] } as unknown as Partial<CanvasGameState>);
    fx.sync(g, 1000);
    expect(fx.lights).toHaveLength(0);
    charge.blown = true;
    fx.sync(g, 1016);
    expect(fx.lights).toHaveLength(1);
    expect(fx.lights[0].reach).toBeGreaterThanOrEqual(220);
    fx.dispose();
  });
});

describe("the output curve", () => {
  it("passes the palette through untouched and only rolls off what is brighter", () => {
    expect(shoulder(0.3)).toBe(0.3);
    expect(shoulder(SHOULDER_KNEE)).toBe(SHOULDER_KNEE);
    expect(shoulder(2)).toBeLessThan(1);
    expect(shoulder(1.5)).toBeGreaterThan(shoulder(1.2));
  });
});

describe("quality", () => {
  it("steps down only, after a full window of slow frames, ignoring pauses", () => {
    const gov = new QualityGovernor(21, 10, 120);
    gov.reset(0, 0);
    let t = 0;
    let asked = false;
    for (let i = 0; i < 11; i++) { t += 16; asked = gov.frame(t) || asked; }
    expect(asked).toBe(false);
    for (let i = 0; i < 11; i++) { t += 30; asked = gov.frame(t) || asked; }
    expect(asked).toBe(true);
    // A long gap (a pause) is not a slow frame.
    const g2 = new QualityGovernor(21, 3, 120);
    g2.reset(0, 0);
    expect([g2.frame(10), g2.frame(500), g2.frame(1000), g2.frame(1600)]).toEqual([false, false, false, false]);
    expect(stepDown("high")).toBe("medium");
    expect(stepDown("low")).toBeNull();
  });

  it("guesses by device, and spends less on a phone", () => {
    expect(autoTier({ coarsePointer: false, dpr: 1, cores: 8 })).toBe("high");
    expect(autoTier({ coarsePointer: true, dpr: 3, cores: 8 })).toBe("medium");
    expect(autoTier({ coarsePointer: true, dpr: 2, cores: 4 })).toBe("low");
    expect(QUALITY_PRESETS.low.shadowedLights).toBeLessThan(QUALITY_PRESETS.high.shadowedLights);
    expect(QUALITY_PRESETS.low.maxPixelRatio).toBeLessThan(QUALITY_PRESETS.high.maxPixelRatio);
  });
});

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("default to the 3D board, auto quality and the authored view", () => {
    expect(getRendererChoice()).toBe("three");
    expect(getQualitySetting()).toBe("auto");
    expect(getFov()).toBe(26);
    expect(getHeightScale()).toBe(1.4);
  });

  it("store the default as no key at all, and clamp what they keep", () => {
    setRendererChoice("sleek");
    expect(localStorage.getItem(RENDERER_KEY)).toBe("sleek");
    setRendererChoice("three");
    expect(localStorage.getItem(RENDERER_KEY)).toBeNull();
    setQualitySetting("low");
    expect(getQualitySetting()).toBe("low");
    setFov(999);
    expect(getFov()).toBe(FOV_RANGE[1]);
    setHeightScale(-3);
    expect(getHeightScale()).toBe(HEIGHT_RANGE[0]);
  });

  it("survive a total reset, like the renderer choice always has", () => {
    const src = read("src/lib/totalReset.ts");
    for (const k of ["RENDERER_KEY", "QUALITY_KEY", "FOV_KEY", "HEIGHT_KEY"]) expect(src).toMatch(new RegExp(`\\b${k},`));
  });
});

describe("the wiring", () => {
  const canvas = read("src/components/game/GameCanvas.tsx");
  const sleek = read("src/lib/rendering/sleek/SleekRenderer.ts");

  it("starts the chosen renderer and falls back 3D, then 2D, then the emergency board", () => {
    expect(canvas).toMatch(/useState<RendererChoice>\(getRendererChoice\)/);
    expect(canvas).toMatch(/import\("@\/lib\/rendering\/three\/ThreeRenderer"\)/);
    const fb = canvas.slice(canvas.indexOf("const fallback = (err: unknown) =>"));
    expect(fb.slice(0, 900)).toMatch(/if \(glKind === "three"\) \{[\s\S]*?setGlKind\("sleek"\);[\s\S]*?return;/);
    expect(fb.slice(0, 1200)).toMatch(/setUseFallback2d\(true\)/);
    // A fresh canvas for each step: a used one cannot be trusted.
    expect(canvas).toMatch(/key=\{useFallback2d \? '2d' : glKind\}/);
  });

  it("keeps the 3D chunk out of the first screen", () => {
    // Dynamically imported with the board, never statically.
    expect(canvas).not.toMatch(/^import .*rendering\/three\//m);
    expect(read("src/components/admin/AdminScreen.tsx")).not.toMatch(/rendering\/three\//);
  });

  it("leaves out the 2D layers that faked the light the 3D scene makes", () => {
    const hybrid = sleek.slice(sleek.indexOf("private initHybrid("), sleek.indexOf("private resizeHybrid("));
    for (const faked of ["this.ballLights.sprite", "this.faceLight.container", "this.bounce.onWalls", "this.bounce.onBalls", "this.bounce.onFrame"]) {
      expect(hybrid, faked).not.toContain(faked);
    }
    const frame = sleek.slice(sleek.indexOf("private renderHybrid("), sleek.indexOf("private drawSplitWarn("));
    expect(frame).toMatch(/this\.ballLights\.build\(game, w2s, scale, now, monitor, true\)/);
    expect(frame).not.toMatch(/this\.faceLight\.sync|this\.bounce\.sync|ballLights\.commit/);
  });

  it("draws the flat marks under a flat light, so nothing is lit twice", () => {
    const frame = sleek.slice(sleek.indexOf("private renderHybrid("), sleek.indexOf("private drawSplitWarn("));
    expect(frame).toMatch(/const flat: LightScope = \{ \.\.\.light, level: 1, reach: 1e7 \}/);
    expect(frame).toMatch(/this\.walls\.sync\(game, flat, sink, w2s, scale\)/);
    expect(sleek).toMatch(/this\.board\.showWash = false;/);
  });
});

describe("the shell shows a ball rolling", () => {
  it("gives every ball type its own pattern from balls.yml", () => {
    const types = getAllBallTypes();
    expect(types.length).toBeGreaterThanOrEqual(10);
    for (const t of types) expect(t.pattern, t.id).toBeDefined();
    // Not all the same: the pattern is also how types are told apart.
    expect(new Set(types.map(t => t.pattern)).size).toBeGreaterThanOrEqual(5);
  });

  it("wears its type's pattern unless the Playground forces one", () => {
    const red = ball({ typeId: "red" } as Partial<Ball>);
    expect(BALL_PATTERNS[patternIndex(red, "auto")]).toBe("seam");
    expect(BALL_PATTERNS[patternIndex(red, "dimples")]).toBe("dimples");
    expect(BALL_PATTERNS[patternIndex(ball({ typeId: "nope" } as Partial<Ball>), "auto")]).toBe("seam");
  });

  it("has a shader branch for every pattern, in BALL_PATTERNS order", () => {
    const src = read("src/lib/rendering/three/balls3d.ts");
    const order = [...src.matchAll(/\/\/ (seam|stripe|bands|quarters|panels|dimples|plain)\b/g)].map(m => m[1]);
    expect(order).toEqual([...BALL_PATTERNS]);
  });

  it("fades the pattern before it can strobe, and on a ball too small to carry it", () => {
    expect(shellContrast(0.1, 20)).toBeCloseTo(1, 6);
    expect(shellContrast(1.2, 20)).toBe(0);
    expect(shellContrast(0.6, 20)).toBeGreaterThan(0);
    expect(shellContrast(0.6, 20)).toBeLessThan(1);
    expect(shellContrast(0.1, 3)).toBe(0);
  });

  it("keeps the 3D halo off the ball's face, where the pattern is", () => {
    const edge = 1 / CORONA_RADII;
    for (const st of haloStops()) if (st.offset <= edge) expect(st.alpha).toBe(0);
    expect(Math.max(...haloStops().map(st => st.alpha))).toBeGreaterThan(0.3);
  });
});

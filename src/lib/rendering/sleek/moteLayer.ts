/**
 * Drawing the motes (motes.ts): one mesh, one draw, however many specks.
 *
 * Four vertices and two triangles per mote, all of them in one shared
 * geometry, rewritten per frame. The same trade ballLayer.ts makes for the
 * body and the corona, and the reason a field of hundreds costs about what a
 * handful of sprites would: a display object per particle would be a node, a
 * transform and a draw call each, and that is the version of this effect that
 * ends up being deleted six months later for being slow.
 *
 * BRIGHTNESS IS CARRIED BY SIZE, not by a per-vertex colour, and that is a
 * constraint rather than a preference: Pixi's default mesh shader reads only
 * position and UV, so a custom `aColor` attribute is accepted by the geometry
 * and then silently ignored by the shader. (It says so, once, in a console
 * warning that is easy to miss - which is how the first version of this got as
 * far as a screenshot.) The alternatives were a custom shader, which this
 * renderer has deliberately avoided everywhere else, or a mesh per colour,
 * which trades the one draw call this whole design exists to protect.
 *
 * Size works because a mote is two pixels across. At that scale the eye reads
 * a bigger speck as a brighter one and cannot resolve hue at all, so the thing
 * being given up costs nothing and the thing being kept - one draw for the
 * whole field - is the entire point. Ambient motes are lit warm-white, and
 * residue keeps its own colour on its own mesh, which is the one place the
 * colour is big enough to matter.
 *
 * The meshes are additive, because a mote is light scattering off a speck
 * rather than a speck painted on the floor - which also means an unlit mote
 * contributes nothing and the whole field is free when no light is near it.
 */

import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import {
  createMoteField, refitMoteField, stepMotes, spawnResidue, MoteBins, lightAt,
  moteAlpha, binDims, moteRandom, MOTE_PEAK_ALPHA,
  type MoteField, type MoteLight,
} from "@/lib/rendering/motes";
import { claimResidue, pruneResidueSeen } from "./residue";
import { getLightLook } from "@/lib/lightLook";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** The world-to-screen transform, flattened so a mote costs no allocation. */
interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number }

/**
 * How many ambient motes a board carries at full density.
 *
 * Chosen against the BENCH rather than by eye. The plan budgeted about 5% of
 * the frame for the whole field and the first attempt at 400 ambient and 220
 * residue came in at +19% mean and +34% at the median, which is the number
 * that gets an effect deleted rather than tuned. Two fixes in the arithmetic
 * (squared distances in the light lookup, and one affine probe instead of a
 * transform call per mote) and these counts bring it inside the budget while
 * still putting six or so motes in every bin, which is sparse enough that no
 * single pool lights a crowd and dense enough that one always finds a few.
 * Scaled down by the dial, never up.
 */
export const AMBIENT_MOTES = 260;

/** Slots kept for residue bursts. A ring: the newest burst wins. */
export const RESIDUE_MOTES = 140;

/**
 * What an ambient mote is lit as.
 *
 * A warm off-white rather than pure white: this is light being scattered by a
 * speck, and the board's own light is not neutral. Pure white specks over a
 * green board read as pixels rather than as air.
 */
export const AMBIENT_TINT = 0xfff2dd;

/**
 * The smallest fraction of its size light will shrink a mote to.
 *
 * Not near zero. Size is the only channel this effect has, and a mote allowed
 * to shrink to nothing does not read as dim - it reads as gone, which loses
 * the dim outskirts of a pool that are most of what makes it look like a
 * volume rather than a disc.
 */
const SIZE_FLOOR = 0.45;

/** Screen pixels a mote is drawn at, per world unit of its size. */
const MOTE_SCALE = 1;

/** Longest frame the field will integrate in one step, in seconds. */
const MAX_STEP = 1 / 20;

export class MoteLayer {
  readonly container = new Container();

  private field: MoteField | null = null;
  /** Ambient motes: warm white, the colour of light rather than of a thing. */
  private ambientMesh: Mesh | null = null;
  /** Residue: tinted by the burst it came from, where the colour is the point. */
  private residueMesh: Mesh | null = null;
  private ambientPos: Float32Array = new Float32Array(0);
  private residuePos: Float32Array = new Float32Array(0);
  /**
   * What the residue mesh is tinted, set when a burst is thrown.
   *
   * One tint for the whole mesh, so two bursts of different colours in flight
   * at once both take the newer one's. That is the right trade at this size:
   * the alternative is a mesh per burst, and the one draw call is the thing
   * this design exists to protect.
   */
  private residueTint = 0xffffff;
  private bins = new MoteBins();
  /** Motes that actually had light on them last frame. Read by the bench. */
  lit = 0;
  private rnd = moteRandom(20260914);
  private last = 0;
  /** Events already turned into residue, so one break is one burst. */
  /** Event key -> its start time, for the length of the freshness window. */
  private seen = new Map<string, number>();

  /**
   * Compose this frame's field.
   *
   * `lights` is the emitter list the ball-light pass has just built, handed
   * over rather than recomputed: the motes want exactly what the pass already
   * knows, and a second opinion about where the light is would be a second
   * thing to keep in step.
   */
  sync(
    game: CanvasGameState, lights: readonly MoteLight[], w2s: W2S, scale: number, now: number,
  ): void {
    const look = getLightLook();
    const density = look.motes;
    if (density <= 0.001) {
      this.container.visible = false;
      this.last = now;
      return;
    }
    this.container.visible = true;

    const poly = game.boardPolygon?.vertices;
    if (!poly || poly.length < 3) { this.container.visible = false; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of poly) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }

    if (!this.field) {
      this.field = createMoteField(minX, minY, maxX, maxY, AMBIENT_MOTES, RESIDUE_MOTES);
      this.build(AMBIENT_MOTES, RESIDUE_MOTES);
    } else {
      refitMoteField(this.field, minX, minY, maxX, maxY);
    }
    const f = this.field;

    // Clamped, because a tab that was in the background for a minute must not
    // teleport the whole field across the board on the frame it comes back.
    const dt = Math.min(MAX_STEP, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    this.collectResidue(game, now);
    const weather = game.weather;
    stepMotes(f, dt, (weather?.x ?? 0), (weather?.y ?? 0));

    const { cols, rows } = binDims(f);
    this.bins.rebuild(lights, minX, minY, cols, rows);
    // The world-to-screen transform, probed once and applied inline below.
    // w2s is affine (a translate, a scale, and on a gravity map a rotation),
    // so three calls pin it exactly - and calling it per mote instead would
    // allocate a point per mote per frame, which is tens of thousands of tiny
    // objects a second and showed up in the bench as a fatter tail rather than
    // as a slower median.
    const o = w2s(0, 0), ex = w2s(1, 0), ey = w2s(0, 1);
    const m = {
      a: ex.x - o.x, b: ex.y - o.y, c: ey.x - o.x, d: ey.y - o.y, tx: o.x, ty: o.y,
    };
    this.write(f, m, scale, density, minX, minY, cols, rows);
  }

  /**
   * Turn this frame's events into residue bursts.
   *
   * Read from state the game already keeps rather than hooked into the physics:
   * debris and lock dust are both already spawned and already carry a start
   * time, so a burst is a read of something that happened rather than a new
   * thing to remember to fire. `claimResidue` is what keeps one break from
   * spraying a burst on every frame of its animation - and, since neither list
   * is ever pruned, what keeps a lock that happened two minutes ago from
   * spraying again the moment a bounded cache is emptied. See residue.ts.
   */
  private collectResidue(game: CanvasGameState, now: number): void {
    const f = this.field;
    if (!f) return;
    for (const d of game.objectDebris ?? []) {
      if (!claimResidue(this.seen, `d${d.startTime}`, d.startTime, now)) continue;
      this.residueTint = parseColor(d.color);
      spawnResidue(f, avgX(d.particles), avgY(d.particles), 26,
        this.residueTint, 90, d.durationMs, this.rnd);
    }
    for (const [id, a] of game.assimilations ?? new Map()) {
      if (!claimResidue(this.seen, `a${id}${a.startTime}`, a.startTime, now)) continue;
      this.residueTint = parseColor(a.zoneColor ?? a.ballColor);
      spawnResidue(f, a.centroid.x, a.centroid.y, 34,
        this.residueTint, 70, 900, this.rnd);
    }
    // Pruned by AGE, not by size. Neither list above is ever pruned - a lock
    // and its debris stand in them for the rest of the map - so a cache emptied
    // by size made every one of them read as new again and spray a second time,
    // and a third. See lib/rendering/sleek/residue.
    pruneResidueSeen(this.seen, now);
  }

  private build(ambient: number, residue: number): void {
    this.ambientPos = new Float32Array(ambient * 8);
    this.residuePos = new Float32Array(residue * 8);
    this.ambientMesh = makeMesh(this.ambientPos, ambient, AMBIENT_TINT);
    this.residueMesh = makeMesh(this.residuePos, residue, 0xffffff);
    this.container.addChild(this.ambientMesh, this.residueMesh);
  }

  private write(
    f: MoteField, m: Affine, scale: number, density: number,
    minX: number, minY: number, cols: number, rows: number,
  ): void {
    this.lit = 0;
    // Density scales how many of the ambient slots are used rather than how
    // bright they are: a half-density field is fewer specks, not a field of
    // dim ones, because dimming is what the light already means.
    const liveAmbient = Math.round(f.ambient * density);
    for (let i = 0; i < f.motes.length; i++) {
      const mo = f.motes[i];
      const ambient = i < f.ambient;
      const pos = ambient ? this.ambientPos : this.residuePos;
      const v = (ambient ? i : i - f.ambient) * 8;
      const dead = ambient ? i >= liveAmbient : mo.life <= 0;
      if (dead) { blank(pos, v); continue; }

      const lit = lightAt(this.bins, mo.x, mo.y, minX, minY, cols, rows);
      const alpha = moteAlpha(mo, lit.level);
      if (alpha <= 0.004) { blank(pos, v); continue; }
      this.lit++;

      const px = m.a * mo.x + m.c * mo.y + m.tx;
      const py = m.b * mo.x + m.d * mo.y + m.ty;
      // Brightness, as size. A speck two pixels across cannot carry hue and
      // the shader will not carry alpha, so the one channel left is how big it
      // is - which is also how the eye reads a distant point of light.
      const bright = SIZE_FLOOR + (1 - SIZE_FLOOR) * (alpha / MOTE_PEAK_ALPHA);
      const r = mo.size * MOTE_SCALE * scale * 0.5 * bright;
      pos[v] = px - r; pos[v + 1] = py - r;
      pos[v + 2] = px + r; pos[v + 3] = py - r;
      pos[v + 4] = px + r; pos[v + 5] = py + r;
      pos[v + 6] = px - r; pos[v + 7] = py + r;
    }
    if (this.residueMesh) this.residueMesh.tint = this.residueTint;
    this.ambientMesh?.geometry.attributes.aPosition.buffer.update();
    this.residueMesh?.geometry.attributes.aPosition.buffer.update();
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.ambientMesh = null;
    this.residueMesh = null;
    this.field = null;
  }
}

let dotTexture: Texture | null = null;

/** One soft dot, baked once and shared by every mote on the board. */
function dotTex(): Texture {
  if (dotTexture) return dotTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (dotTexture = Texture.WHITE);
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.7)");
  g.addColorStop(0.75, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  dotTexture = Texture.from(canvas);
  return dotTexture;
}

export function clearMoteTexture(): void {
  dotTexture?.destroy(true);
  dotTexture = null;
}

/**
 * A quad collapsed to a point: still written, still indexed, draws nothing.
 *
 * The alternative is rebuilding the index buffer as motes come and go, which
 * costs more every frame than four zeroed floats ever will.
 */
function blank(pos: Float32Array, v: number): void {
  pos[v] = pos[v + 1] = pos[v + 2] = pos[v + 3] = 0;
  pos[v + 4] = pos[v + 5] = pos[v + 6] = pos[v + 7] = 0;
}

function makeMesh(positions: Float32Array, count: number, tint: number): Mesh {
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const v = i * 4, k = i * 6;
    index[k] = v; index[k + 1] = v + 1; index[k + 2] = v + 2;
    index[k + 3] = v; index[k + 4] = v + 2; index[k + 5] = v + 3;
  }
  // UVs spanning the whole quad, so each mote samples a soft dot rather than
  // a flat square. At two or three pixels across a hard-edged quad reads as a
  // stuck pixel - which is the one thing this effect must never look like.
  const uvs = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const u = i * 8;
    uvs[u] = 0; uvs[u + 1] = 0;
    uvs[u + 2] = 1; uvs[u + 3] = 0;
    uvs[u + 4] = 1; uvs[u + 5] = 1;
    uvs[u + 6] = 0; uvs[u + 7] = 1;
  }
  const mesh = new Mesh({
    geometry: new MeshGeometry({ positions, uvs, indices: index }),
    texture: dotTex(),
  });
  mesh.blendMode = "add";
  mesh.tint = tint;
  // Near opaque: the size already carries the brightness, so holding the
  // alpha down as well would dim a mote twice and leave nothing on screen.
  mesh.alpha = 0.85;
  return mesh;
}

function parseColor(c: string | null | undefined): number {
  if (!c) return 0xffffff;
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

function avgX(ps: readonly { x: number }[]): number {
  if (ps.length === 0) return 0;
  let s = 0;
  for (const p of ps) s += p.x;
  return s / ps.length;
}

function avgY(ps: readonly { y: number }[]): number {
  if (ps.length === 0) return 0;
  let s = 0;
  for (const p of ps) s += p.y;
  return s / ps.length;
}

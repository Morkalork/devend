/**
 * Explosions, shards and rubble, in 3D.
 *
 * WHAT COUNTS AS AN EXPLOSION. Nothing in the simulation is called one; these
 * are read off state the physics already leaves behind, the way the 2D fx
 * layer reads it:
 *
 *   - a destructible breaking, or a hard hit chipping it (game.objectDebris),
 *   - a Deploy Charge going off (a charge turning `blown`),
 *   - a launcher shell section letting go (game.shellShatters),
 *   - a ball popping (game.ballPops).
 *
 * Each one is a burst of LIGHT first. That is the point of doing this in 3D:
 * the flash is a real point light in the board's light pool (lights3d.ts), so
 * every fence and slab round it throws a shadow that snaps out and fades with
 * the blast, which no 2D flash can do. Then a hot core and a shockwave ring on
 * the floor, and the debris as actual shards: thrown up and out, spinning,
 * falling back under gravity, bouncing once or twice and settling, lit by the
 * same light that threw their shadows.
 *
 * The shards take the 2D debris' own particles (positions, velocities, spin,
 * size), so the burst goes the way the physics threw it; height is the one
 * thing the 2D state does not have, so each shard is given an upward kick of
 * its own, seeded from its index so a burst always looks the same.
 *
 * All of it is render-only, remembered in this renderer by object identity.
 * The simulation never learns any of it happened, so lockstep cannot either.
 */
import {
  AdditiveBlending, BoxGeometry, Color, Euler, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, RingGeometry, SphereGeometry,
  Vector3, type Group, type WebGLProgramParametersWithUniforms,
} from "three";
import type { CanvasGameState } from "@/types/gameState";
import type { ObjectDebrisState, ShellShatterState } from "@/types/game";
import { polygonCentroid, type Vector2 } from "@/lib/polygon";
import { rubbleAlpha } from "@/lib/physics/rubble";

/** A light an explosion is making this frame, in untilted world units. */
export interface BlastLight {
  x: number;
  y: number;
  height: number;
  reach: number;
  intensity: number;
  color: number;
}

interface Blast {
  x: number;
  y: number;
  start: number;
  /** World units the light reaches and the ring grows to. */
  reach: number;
  /** 0..1, how big a bang. */
  power: number;
  color: number;
}

interface Shard {
  x: number; y: number; h: number;
  vx: number; vy: number; vh: number;
  rot: number; spin: number; tumble: number;
  size: number;
  color: number;
  born: number;
  life: number;
  settled: boolean;
}

const UP = new Vector3(0, 1, 0);

/** How long a blast's light, core and ring last, ms. */
export const BLAST_MS = 700;
/** Gravity on a shard's height, world units / s^2. */
const GRAVITY = 1100;
/** Floor drag on a settled shard's slide, per second. */
const FLOOR_DRAG = 4.5;

/**
 * The blast's light envelope: a hard 40ms attack and an exponential tail, so
 * the room snaps bright and the shadows linger as it fades.
 */
export function blastEnvelope(t: number): number {
  if (t < 0 || t >= 1) return 0;
  const attack = Math.min(1, t / 0.06);
  return attack * Math.exp(-t * 4.2) * (1 - t);
}

function parseColor(c: string | undefined, fallback: number): number {
  const n = Number.parseInt((c ?? "").replace("#", ""), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** Deterministic 0..1 from an integer, for per-shard variety. */
function hash01(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Explosions3D {
  private blasts: Blast[] = [];
  private shards: Shard[] = [];
  private seenDebris = new WeakSet<ObjectDebrisState>();
  private seenShells = new WeakMap<ShellShatterState, Set<number>>();
  private seenPops = new WeakSet<object>();
  private blownCharges = new WeakSet<object>();
  private lastNow = 0;

  private shardMesh: InstancedMesh;
  private rubbleMesh: InstancedMesh;
  private cores: Mesh[] = [];
  private rings: Mesh[] = [];
  private coreGeometry = new SphereGeometry(1, 20, 14);
  private ringGeometry = new RingGeometry(0.94, 1, 64);

  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private euler = new Euler();
  private c = new Color();
  /** This frame's blast lights, brightest first. */
  readonly lights: BlastLight[] = [];

  constructor(private parent: Group, private maxShards: number) {
    const shardMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
    // Shards are hot when thrown: a little of their own colour glows.
    shardMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor * 0.25;\n#endif",
      );
    };
    shardMat.customProgramCacheKey = () => "shard";
    this.shardMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), shardMat, maxShards);
    this.shardMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shardMesh.castShadow = true;
    this.shardMesh.receiveShadow = true;
    this.shardMesh.frustumCulled = false;
    // Create the colour attribute up front: adding it later recompiles the
    // shader, which would hitch on the first explosion of the session.
    this.shardMesh.setColorAt(0, this.c.setHex(0xffffff));
    this.shardMesh.count = 0;
    parent.add(this.shardMesh);

    // Rubble chips: five-sided, like the 2D chip, and lying on the floor.
    const rubbleMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
    this.rubbleMesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 5), rubbleMat, 96);
    this.rubbleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rubbleMesh.castShadow = true;
    this.rubbleMesh.receiveShadow = true;
    this.rubbleMesh.frustumCulled = false;
    this.rubbleMesh.setColorAt(0, this.c.setHex(0xffffff));
    this.rubbleMesh.count = 0;
    parent.add(this.rubbleMesh);
  }

  private blast(x: number, y: number, now: number, reach: number, power: number, color: number): void {
    this.blasts.push({ x, y, start: now, reach, power: Math.min(1, power), color });
  }

  private addShard(sh: Shard): void {
    if (this.shards.length >= this.maxShards) this.shards.shift();
    this.shards.push(sh);
  }

  /** Read this frame's new events off the game state. */
  private detect(game: CanvasGameState, now: number): void {
    for (const d of game.objectDebris ?? []) {
      if (this.seenDebris.has(d)) continue;
      this.seenDebris.add(d);
      if (d.particles.length === 0) continue;
      let cx = 0, cy = 0, spread = 0;
      for (const p of d.particles) { cx += p.x; cy += p.y; }
      cx /= d.particles.length; cy /= d.particles.length;
      for (const p of d.particles) spread = Math.max(spread, Math.hypot(p.x - cx, p.y - cy));
      const color = parseColor(d.color, 0xffb454);
      // A break throws a lot of debris; a chip a handful. The count says which.
      const power = Math.min(1, d.particles.length / 28);
      this.blast(cx, cy, now, 90 + spread * 2.2 + power * 120, 0.25 + power * 0.75, color);
      d.particles.forEach((p, i) => {
        const r = hash01(i + d.particles.length * 7);
        this.addShard({
          x: p.x, y: p.y, h: 4 + r * 8,
          vx: p.vx, vy: p.vy, vh: 160 + r * 260 * (0.4 + power),
          rot: p.rotation, spin: p.rotSpeed, tumble: (r - 0.5) * 14,
          size: p.size, color, born: now, life: Math.max(d.durationMs, 900) + 600, settled: false,
        });
      });
    }

    for (const shatter of game.shellShatters ?? []) {
      let released = this.seenShells.get(shatter);
      if (!released) { released = new Set(); this.seenShells.set(shatter, released); }
      shatter.sections.forEach((section, si) => {
        if (released!.has(si) || now < shatter.startTime + section.delay) return;
        released!.add(si);
        const c = polygonCentroid({ vertices: section.vertices });
        this.blast(c.x, c.y, now, 110, 0.35, 0x9fe8ff);
        section.tiles.forEach((t, ti) => {
          const r = hash01(si * 31 + ti);
          this.addShard({
            x: t.x, y: t.y, h: 6, vx: t.vx, vy: t.vy, vh: 120 + r * 200,
            rot: t.rotation, spin: t.rotSpeed, tumble: (r - 0.5) * 10,
            size: Math.max(t.w, t.h) * 0.8, color: 0x51705f, born: now,
            life: shatter.flightMs + 700, settled: false,
          });
        });
      });
    }

    for (const c of game.charges ?? []) {
      if (!c.blown || this.blownCharges.has(c)) continue;
      this.blownCharges.add(c);
      // The blast centre physics used: the target slab's centroid, else the fuse.
      const target = game.destructibles?.find(d => d.id === c.targetId);
      const poly = target?.obstaclePolygon ?? target?.mirrorPolygon;
      const at: Vector2 = poly ? polygonCentroid(poly) : c.fuse;
      this.blast(at.x, at.y, now, Math.max(220, c.blastRadius * 2.4), 1, 0xffa640);
    }

    for (const pop of game.ballPops ?? []) {
      if (this.seenPops.has(pop)) continue;
      this.seenPops.add(pop);
      const color = parseColor(pop.color, 0xffffff);
      this.blast(pop.x, pop.y, now, 120, 0.4, color);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + hash01(i) * 0.5;
        const sp = 90 + hash01(i + 3) * 120;
        this.addShard({
          x: pop.x, y: pop.y, h: 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 140 + hash01(i + 9) * 160,
          rot: a, spin: 6, tumble: 9, size: 4.5, color, born: now, life: 1100, settled: false,
        });
      }
    }
  }

  /** Advance everything to `now` and lay it out. */
  sync(game: CanvasGameState, now: number): void {
    // A new map (the clock went backwards) or a long gap: drop what is in flight.
    if (now < this.lastNow || now - this.lastNow > 1000) {
      this.blasts.length = 0;
      this.shards.length = 0;
    }
    const dt = this.lastNow > 0 ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    this.detect(game, now);

    // ── Blasts: light, core, ring ───────────────────────────────────────────
    this.lights.length = 0;
    this.blasts = this.blasts.filter(b => now - b.start < BLAST_MS);
    while (this.cores.length < this.blasts.length) {
      const core = new Mesh(this.coreGeometry, new MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      core.frustumCulled = false;
      this.parent.add(core);
      this.cores.push(core);
      const ring = new Mesh(this.ringGeometry, new MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.frustumCulled = false;
      this.parent.add(ring);
      this.rings.push(ring);
    }
    this.blasts.forEach((b, i) => {
      const t = (now - b.start) / BLAST_MS;
      const env = blastEnvelope(t);
      this.lights.push({
        x: b.x, y: b.y, height: 26 + 30 * b.power, reach: b.reach,
        intensity: env * (1.2 + 3.2 * b.power), color: b.color,
      });
      // The core: a hot ball of light that swells and is gone in the first
      // third of the blast. Any longer and it reads as a pale disc lying on
      // the board rather than as a flash above it.
      const core = this.cores[i];
      const ct = t / 0.35;
      core.visible = ct < 1;
      const cr = (6 + 20 * b.power) * Math.sqrt(Math.min(1, ct / 0.4));
      core.position.set(b.x, 10 + 14 * b.power, b.y);
      core.scale.setScalar(Math.max(0.01, cr));
      const coreMat = core.material as MeshBasicMaterial;
      const heat = Math.max(0, 1 - ct) ** 2;
      coreMat.color.setHex(b.color).lerp(this.c.setHex(0xffffff), 0.6).multiplyScalar(3 * heat + 0.001);
      coreMat.opacity = Math.min(1, heat * 1.5);
      const ring = this.rings[i];
      ring.visible = true;
      ring.position.set(b.x, 0.6, b.y);
      ring.scale.setScalar(Math.max(1, b.reach * 0.75 * Math.sqrt(t)));
      const ringMat = ring.material as MeshBasicMaterial;
      const fade = Math.max(0, 1 - t * 1.6);
      ringMat.color.setHex(b.color).multiplyScalar(1.6 * fade * (0.4 + b.power));
      ringMat.opacity = fade;
    });
    for (let i = this.blasts.length; i < this.cores.length; i++) {
      this.cores[i].visible = false;
      this.rings[i].visible = false;
    }
    this.lights.sort((a, b) => b.intensity - a.intensity);

    // ── Shards: thrown, falling, bouncing, settling, fading ─────────────────
    this.shards = this.shards.filter(s => now - s.born < s.life);
    let n = 0;
    for (const sh of this.shards) {
      if (dt > 0) {
        if (!sh.settled) {
          sh.vh -= GRAVITY * dt;
          sh.h += sh.vh * dt;
          if (sh.h <= sh.size * 0.3) {
            sh.h = sh.size * 0.3;
            // Bounce, losing most of it; a weak bounce settles.
            sh.vh = -sh.vh * 0.32;
            sh.vx *= 0.6; sh.vy *= 0.6; sh.spin *= 0.5; sh.tumble *= 0.4;
            if (sh.vh < 60) { sh.vh = 0; sh.settled = true; sh.tumble = 0; }
          }
        } else {
          const k = Math.max(0, 1 - FLOOR_DRAG * dt);
          sh.vx *= k; sh.vy *= k; sh.spin *= k;
        }
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.rot += sh.spin * dt;
      }
      const age = (now - sh.born) / sh.life;
      const shrink = age > 0.75 ? Math.max(0.01, 1 - (age - 0.75) / 0.25) : 1;
      this.q.setFromEuler(this.euler.set(sh.settled ? 0 : sh.tumble * (now - sh.born) / 1000, sh.rot, 0));
      this.p.set(sh.x, sh.h, sh.y);
      this.s.set(sh.size * shrink, sh.size * 0.45 * shrink, sh.size * 0.8 * shrink);
      this.m.compose(this.p, this.q, this.s);
      this.shardMesh.setMatrixAt(n, this.m);
      this.shardMesh.setColorAt(n, this.c.setHex(sh.color));
      n++;
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;

    // ── Rubble: the physics' chips, lying on the floor ──────────────────────
    let rn = 0;
    for (const chunk of game.rubble ?? []) {
      if (rn >= 96) break;
      const alpha = rubbleAlpha(chunk, now);
      if (alpha <= 0.01) continue;
      this.q.setFromAxisAngle(UP, -chunk.rotation);
      const h = chunk.radius * 0.7 * alpha;
      this.p.set(chunk.x, h / 2, chunk.y);
      this.s.set(chunk.radius, Math.max(0.01, h), chunk.radius);
      this.m.compose(this.p, this.q, this.s);
      this.rubbleMesh.setMatrixAt(rn, this.m);
      this.rubbleMesh.setColorAt(rn, this.c.setHex(parseColor(chunk.color, 0x51705f)));
      rn++;
    }
    this.rubbleMesh.count = rn;
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
    if (this.rubbleMesh.instanceColor) this.rubbleMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.shardMesh, this.rubbleMesh]) {
      this.parent.remove(m);
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
      m.dispose();
    }
    for (const m of [...this.cores, ...this.rings]) {
      this.parent.remove(m);
      (m.material as MeshBasicMaterial).dispose();
    }
    this.coreGeometry.dispose();
    this.ringGeometry.dispose();
  }
}

/**
 * Balls as real spheres: lamps that roll.
 *
 * WHAT CARRIES OVER FROM THE 2D BALL. It is still a lamp (ballLayer.ts): the
 * body glows from inside, brightest where it faces you and carrying its hue at
 * the rim, and a light inside it lights the board (lights3d.ts). The 2D
 * corona, rings, frost, marks and labels are still drawn over it by the sleek
 * layer, so every piece of ball information a player has learned stays where
 * it was. Its colour, dimming, warm-up, heartbeat swell, flight stretch and
 * wall squash all come from the same functions the 2D ball uses.
 *
 * WHAT IS NEW. It rolls. A smooth glowing sphere cannot show that it turns, so
 * the shell is etched: a seam winding round it and a few vias, darker than the
 * glow and fixed to the ball, turning with it. The roll is worked out here from
 * how far the ball moved since the last frame - about the axis `up x motion`,
 * by `distance / radius` - and lives only in this renderer, in a map keyed by
 * ball. The simulation never sees it, so two-player lockstep cannot either.
 *
 * WHAT STAYS 2D. A stuck ball under Bug Squash melts into a liquid shape the
 * sphere cannot follow; while it is liquid the sphere hides and the sleek
 * layer's liquid shows, exactly as it always did.
 */
import {
  Color, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, FrontSide,
  type Group, type WebGLProgramParametersWithUniforms,
} from "three";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { getSquishEffect, BOSS_SQUISH_SCALE } from "@/lib/ballEffects";
import { BREATHE, flightStretch, heartbeat, heartPhase, heartRate } from "@/lib/rendering/ballLife";
import { warmup, WARMUP_EMBER } from "@/lib/rendering/ballTell";
import { getLightLook } from "@/lib/lightLook";
import { PALETTE, mix, BALL_FALLBACK } from "@/lib/rendering/sleek/palette";
import { BOARD_CENTRE } from "./floorCamera";

/** What a ball looks like this frame, in world units. */
export interface BallPose {
  /** Footprint centre (after any squash shifts the mass toward the wall). */
  x: number;
  z: number;
  /** Body radius, heartbeat included. */
  r: number;
  /** 2x2 deformation in the floor plane (squash then stretch), row-major. */
  a: [number, number, number, number];
  /** Vertical scale of the body. */
  sy: number;
  color: number;
  alpha: number;
  /** Brightness of the glow, 0..1 (warm-up, dormancy, lock fade). */
  glow: number;
  /** Liquid (Bug Squash): the sphere hides and the 2D melt shows. */
  liquid: boolean;
  dormant: boolean;
}

function parseColor(c: string): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : BALL_FALLBACK;
}

/**
 * The body's pose, from the same inputs ballLayer.drawBall reads, so the
 * sphere and everything the 2D layer draws round it agree about its size,
 * colour and shape.
 */
export function ballPose(ball: Ball, now: number, fastestId: string | null): BallPose {
  const p = ball.renderPosition ?? ball.position;
  const r = Math.max(1, ball.radius * (ball.assimScale ?? 1));
  const dormant = ball.state === "dormant";
  const held = ball.frozenUntil !== undefined && now < ball.frozenUntil;
  const beating = !dormant && ball.state === "active";
  const heart = beating
    ? heartbeat(now, heartPhase(ball.id), heartRate({ fastest: ball.id === fastestId, held }))
    : 0;
  const rBody = r * (1 + BREATHE * heart);

  const squish = getSquishEffect(ball.effects, ball.isBoss ? BOSS_SQUISH_SCALE : 1);
  const liquid = !!ball.splatScene && squish.active && (ball.effects.squishHoldUntil ?? 0) > 0;

  // Squash: flattened along the impact normal, spread across it.
  let a: [number, number, number, number] = [1, 0, 0, 1];
  let sy = 1;
  let cx = p.x, cz = p.y;
  if (squish.active) {
    const nx = squish.nx, ny = squish.ny;
    const sA = squish.scaleAlong, sP = squish.scalePerp;
    // A = sA n n^T + sP t t^T, t = (-ny, nx).
    a = [
      sA * nx * nx + sP * ny * ny, (sA - sP) * nx * ny,
      (sA - sP) * nx * ny, sA * ny * ny + sP * nx * nx,
    ];
    sy = sP;
    // The face stays on the wall: the centre moves in by what the squash took.
    const rc = held ? r : rBody;
    cx += nx * rc * (sA - 1);
    cz += ny * rc * (sA - 1);
  }

  // Flight stretch along the heading, faded out while a squash owns the shape.
  const vx = ball.velocity?.x ?? 0, vy = ball.velocity?.y ?? 0;
  const speed = Math.hypot(vx, vy);
  const squashing = Math.abs(squish.splat.d) + Math.abs(squish.splat.v) + Math.abs(squish.splat.w);
  const k = (held || !beating || speed < 1e-6) ? 0 : flightStretch(speed) * (1 - Math.min(1, squashing / 0.05));
  if (k > 0) {
    const ux = vx / speed, uy = vy / speed;
    const along = 1 + k, across = 1 - k * 0.55;
    const s = [
      along * ux * ux + across * uy * uy, (along - across) * ux * uy,
      (along - across) * ux * uy, along * uy * uy + across * ux * ux,
    ];
    a = [
      s[0] * a[0] + s[1] * a[2], s[0] * a[1] + s[1] * a[3],
      s[2] * a[0] + s[3] * a[2], s[2] * a[1] + s[3] * a[3],
    ];
    sy *= across;
  }

  // Colour, exactly as the 2D body takes it (bucketed the same way, though here
  // only to match - a uniform costs nothing to change).
  const fadeRaw = ball.assimColorFade ?? 0;
  const fade = fadeRaw > 0 ? Math.round(Math.min(1, fadeRaw) * 12) / 12 : 0;
  const warm = warmup(now, ball.spawnTime);
  const tellGain = getLightLook().tell;
  const warmHue = Math.round((1 - (1 - warm.hue) * tellGain) * 12) / 12;
  const warmGain = 1 - (1 - warm.gain) * tellGain;
  const base = parseColor(ball.color);
  const color = mix(WARMUP_EMBER, fade > 0 ? mix(base, PALETTE.accent, fade) : base, warmHue);
  const alpha = (dormant ? 0.5 : ball.state === "won" ? 0.72 : 1) * (0.32 + 0.68 * warmGain);

  return {
    x: cx, z: cz, r: rBody, a, sy, color, alpha,
    glow: dormant ? 0.15 : warmGain * (ball.state === "won" ? 0.6 : 1),
    liquid, dormant,
  };
}

/**
 * The roll since the last frame: about up x motion, by distance / radius.
 * Returns false (no roll) for a jump too long to be rolling - a portal, a
 * respawn, a lock teleport - so a ball never spins wildly on a warp.
 */
export function rollStep(q: Quaternion, dx: number, dz: number, radius: number): boolean {
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || radius <= 0 || d > radius * 4) return false;
  // up (0,1,0) x (dx,0,dz) = (dz, 0, -dx).
  const axis = new Vector3(dz / d, 0, -dx / d);
  const step = new Quaternion().setFromAxisAngle(axis, d / radius);
  q.premultiply(step).normalize();
  return true;
}

/** The etched shell and the inner glow, added to a standard material. */
function etch(material: MeshStandardMaterial, uniforms: { uGlow: { value: number }; uEtch: { value: number } }): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.uniforms.uEtch = uniforms.uEtch;
    shader.vertexShader = "varying vec3 vBallN;\n" + shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      "#include <beginnormal_vertex>\nvBallN = normal;",
    );
    shader.fragmentShader = `
uniform float uGlow;
uniform float uEtch;
varying vec3 vBallN;
float ballEtch(vec3 n) {
  // A seam winding round the ball like a tennis ball's, and six vias at the
  // poles of each axis. Antialiased with fwidth so a small ball does not
  // shimmer as it turns.
  float ang = atan(n.z, n.x);
  float seam = abs(n.y - 0.32 * sin(ang * 2.0));
  float w = 0.085;
  float aa = fwidth(seam) * 1.5 + 1e-4;
  float m = 1.0 - smoothstep(w - aa, w + aa, seam);
  vec3 an = abs(n);
  float via = max(max(an.x, an.y), an.z);
  float va = fwidth(via) * 1.5 + 1e-4;
  m = max(m, smoothstep(0.985 - va, 0.985 + va, via) * 0.85);
  return m;
}
` + shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
{
  vec3 bn = normalize(vBallN);
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  // A lamp: brightest through the middle, its hue at the rim, never dark.
  vec3 glowCol = totalEmissiveRadiance * mix(0.5, 1.15, facing)
    + vec3(1.0) * pow(facing, 5.0) * 0.55 * uGlow;
  glowCol *= uGlow;
  glowCol *= 1.0 - uEtch * ballEtch(bn);
  totalEmissiveRadiance = glowCol;
}`,
    );
  };
  material.customProgramCacheKey = () => "ball-lamp";
}

/**
 * How far toward the board centre a point `height` up must move so it lands
 * on screen where its foot does, for an eye `eye` above the centre.
 */
export function parallaxFactor(eye: number, height: number): number {
  return eye > height ? (eye - height) / eye : 1;
}

interface BallView {
  mesh: Mesh;
  material: MeshStandardMaterial;
  uniforms: { uGlow: { value: number }; uEtch: { value: number } };
  q: Quaternion;
  lastX: number;
  lastZ: number;
  seen: boolean;
}

const tmpColor = new Color();

/** The pool of ball spheres, kept in step with game.balls. */
export class Balls3D {
  private views = new Map<string, BallView>();
  private geometry: SphereGeometry;
  private m = new Matrix4();
  private r = new Matrix4();
  private a = new Matrix4();
  /** The last frame's poses, by ball id, for the light placement. */
  readonly poses = new Map<string, BallPose>();

  constructor(private parent: Group, segments: number) {
    this.geometry = new SphereGeometry(1, segments, Math.round(segments * 0.7));
  }

  private viewFor(ball: Ball): BallView {
    let v = this.views.get(ball.id);
    if (v) return v;
    const uniforms = { uGlow: { value: 1 }, uEtch: { value: 0.62 } };
    const material = new MeshStandardMaterial({ color: 0x222222, roughness: 0.32, metalness: 0 });
    // The ball's own light sits at its centre. Front faces only in the shadow
    // pass means that, seen from inside, the shell casts nothing - the lamp is
    // not blocked by its own glass - while every OTHER light still sees a solid.
    material.shadowSide = FrontSide;
    etch(material, uniforms);
    const mesh = new Mesh(this.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.parent.add(mesh);
    v = { mesh, material, uniforms, q: new Quaternion(), lastX: NaN, lastZ: NaN, seen: true };
    this.views.set(ball.id, v);
    return v;
  }

  /**
   * `eye` is the camera's height over the floor and `k` the tilt's shrink: the
   * sphere is nudged toward the camera by exactly the parallax its height
   * would add, so its CENTRE lands on the pixel the 2D layer draws its corona,
   * rings and marks round. Walls are left to lean, which is the point of them;
   * a ball whose glow sat a few pixels off its body would just look broken.
   */
  sync(game: CanvasGameState, now: number, eye = Infinity, k = 1): void {
    for (const v of this.views.values()) v.seen = false;
    this.poses.clear();
    for (const ball of game.balls) {
      const v = this.viewFor(ball);
      v.seen = true;
      const pose = ballPose(ball, now, game.fastestBallId ?? null);
      const f = Number.isFinite(eye) ? parallaxFactor(eye, pose.r * pose.sy * k) : 1;
      pose.x = BOARD_CENTRE + (pose.x - BOARD_CENTRE) * f;
      pose.z = BOARD_CENTRE + (pose.z - BOARD_CENTRE) * f;
      this.poses.set(ball.id, pose);

      const p = ball.renderPosition ?? ball.position;
      const rolling = !pose.dormant && ball.state === "active";
      if (rolling && Number.isFinite(v.lastX)) rollStep(v.q, p.x - v.lastX, p.y - v.lastZ, ball.radius);
      v.lastX = p.x; v.lastZ = p.y;

      v.mesh.visible = !pose.liquid && pose.alpha > 0.01;
      if (!v.mesh.visible) continue;

      // T * A(floor-plane deformation, vertical scale) * R(roll) * S(radius).
      const [a00, a01, a10, a11] = pose.a;
      this.a.set(
        a00, 0, a01, 0,
        0, pose.sy, 0, 0,
        a10, 0, a11, 0,
        0, 0, 0, 1,
      );
      this.r.makeRotationFromQuaternion(v.q);
      this.m.makeTranslation(pose.x, pose.r * pose.sy, pose.z)
        .multiply(this.a).multiply(this.r).scale(new Vector3(pose.r, pose.r, pose.r));
      v.mesh.matrix.copy(this.m);
      v.mesh.matrixWorldNeedsUpdate = true;

      tmpColor.setHex(pose.color);
      v.material.emissive.copy(tmpColor);
      v.material.color.setHex(mix(pose.color, 0x000000, 0.7));
      v.uniforms.uGlow.value = pose.glow;
      const translucent = pose.alpha < 0.99;
      v.material.transparent = translucent;
      v.material.depthWrite = !translucent;
      v.material.opacity = pose.alpha;
      v.mesh.castShadow = !pose.dormant;
    }
    for (const [id, v] of this.views) {
      if (v.seen) continue;
      this.parent.remove(v.mesh);
      v.material.dispose();
      this.views.delete(id);
    }
  }

  dispose(): void {
    for (const v of this.views.values()) {
      this.parent.remove(v.mesh);
      v.material.dispose();
    }
    this.views.clear();
    this.geometry.dispose();
  }
}

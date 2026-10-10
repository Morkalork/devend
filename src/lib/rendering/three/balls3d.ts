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
 * the light shines through a patterned shell fixed to the ball (each type its
 * own pattern, balls.yml), with a glint that holds still toward the key light
 * while the pattern turns under it (see `shell`). The roll is worked out here from
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
import { BALL_PATTERNS, getBallType, type BallPattern } from "@/lib/ballTypes";
import { getBallLook } from "@/lib/ballLook";
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

/**
 * How much of the shell's pattern to show, 0..1, from how far the ball turned
 * this frame and how big it is on screen.
 *
 * SPEED: past about half a radian a frame a pattern starts to strobe - the
 *   wagon-wheel effect, where a fast ball appears to spin slowly or backwards.
 *   The pattern fades out instead, which reads as motion blur. Measured per
 *   PRESENTED frame, which is what the eye samples, so a 120 Hz screen keeps
 *   its pattern to twice the speed a 60 Hz one does, which is right.
 * SIZE: below about 5 pixels of radius even big shapes are a smudge that
 *   crawls as it turns; the ball goes back to a plain bulb.
 */
export function shellContrast(spinPerFrame: number, radiusPx: number): number {
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return (1 - smooth(0.35, 0.9, spinPerFrame)) * smooth(4, 9, radiusPx);
}

/** The shell's uniforms, per ball. */
interface ShellUniforms {
  uGlow: { value: number };
  /** Pattern depth this frame: the look's shade times shellContrast. */
  uShade: { value: number };
  /** Index into BALL_PATTERNS. */
  uPattern: { value: number };
  uGlint: { value: number };
  /** Direction to the key light, in VIEW space. */
  uGlintDir: { value: Vector3 };
}

/**
 * The shell, added to a standard material: a lamp behind a patterned shade.
 *
 * A LAMPSHADE, NOT PAINT. The pattern is how much of the light inside gets
 * through: open panels glow at full strength, the ribs pass less. So the ball
 * stays the brightest thing on the board (the reason it became a lamp in the
 * first place) and the pattern still has real contrast, which a dark pattern
 * painted onto a glowing ball never did.
 *
 * THE GLINT stays where the key light is while the pattern turns under it.
 * That is what makes a billiard ball read as rolling: the shine holds still
 * and the stripes go round. It replaces most of the old hot spot in the dead
 * centre, which moved with nothing and so said nothing.
 *
 * Patterns are worked out from the OBJECT-space normal, so they are fixed to
 * the ball and turn with it, and antialiased with fwidth.
 */
function shell(material: MeshStandardMaterial, u: ShellUniforms): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = "varying vec3 vBallN;\n" + shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      "#include <beginnormal_vertex>\nvBallN = normal;",
    );
    shader.fragmentShader = `
uniform float uGlow;
uniform float uShade;
uniform float uPattern;
uniform float uGlint;
uniform vec3 uGlintDir;
varying vec3 vBallN;
float aastep(float edge, float v) {
  float w = fwidth(v) * 0.75 + 1e-4;
  return smoothstep(edge - w, edge + w, v);
}
// 1 on a rib (light held back), 0 on an open panel. Order is BALL_PATTERNS.
float ballShade(vec3 n) {
  if (uPattern < 0.5) {                                   // seam
    float f = abs(n.y - 0.32 * sin(2.0 * atan(n.z, n.x)));
    return 1.0 - aastep(0.15, f);
  } else if (uPattern < 1.5) {                            // stripe: lit band, shaded caps
    return aastep(0.4, abs(n.y));
  } else if (uPattern < 2.5) {                            // bands
    return aastep(0.0, sin(n.y * 6.2832));
  } else if (uPattern < 3.5) {                            // quarters: beach-ball gores
    return aastep(0.0, sin(2.0 * atan(n.z, n.x)));
  } else if (uPattern < 4.5) {                            // panels: cube faces, three shades
    vec3 a = abs(n);
    float xd = aastep(0.0, a.x - max(a.y, a.z));
    float zd = aastep(0.0, a.z - max(a.x, a.y));
    return xd + 0.55 * zd;
  } else if (uPattern < 5.5) {                            // dimples: twelve big dots
    const float P = 1.618034;
    float m = 0.0;
    for (int i = 0; i < 12; i++) {
      float s1 = (i & 1) == 0 ? 1.0 : -1.0;
      float s2 = (i & 2) == 0 ? 1.0 : -1.0;
      int k = i / 4;
      vec3 d = k == 0 ? vec3(0.0, s1, s2 * P) : k == 1 ? vec3(s1, s2 * P, 0.0) : vec3(s2 * P, 0.0, s1);
      m = max(m, aastep(0.955, dot(n, normalize(d))));
    }
    return m;
  }
  return 0.0;                                             // plain
}
` + shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
{
  vec3 N = normalize(normal);
  vec3 V = normalize(vViewPosition);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // A lamp: brightest through the middle, its hue at the rim, never dark.
  // Kept just under the output curve's knee (outputPass.ts): a body pushed
  // past it is flattened into one colour, and the shade's ribs with it.
  vec3 glowCol = totalEmissiveRadiance * mix(0.45, 0.85, facing)
    + vec3(1.0) * pow(facing, 5.0) * 0.2 * uGlow;
  glowCol *= uGlow;
  glowCol *= 1.0 - 0.9 * uShade * ballShade(normalize(vBallN));
  // The glint: fixed toward the key light, so the pattern rolls under it.
  vec3 H = normalize(uGlintDir + V);
  glowCol += vec3(1.0) * pow(max(dot(N, H), 0.0), 48.0) * uGlint * 1.6;
  totalEmissiveRadiance = glowCol;
}`,
    );
  };
  material.customProgramCacheKey = () => "ball-shell";
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
  uniforms: ShellUniforms;
  q: Quaternion;
  lastX: number;
  lastZ: number;
  /** Radians turned per frame, smoothed, for shellContrast. */
  spin: number;
  seen: boolean;
}

/** Where the scene is being looked at from, for the glint. */
export interface ShellView {
  /** The board group's matrix (the tilt). */
  board: Matrix4;
  /** The camera's world-to-view matrix. */
  view: Matrix4;
  /** The key light, in scene space: the lamp over its ball, else the monitor. */
  key: Vector3;
  /** 3D-frame pixels per world unit, for the size fade. */
  pxPerUnit: number;
}

/** The pattern a ball wears: the Playground's override, else its type's own. */
export function patternIndex(ball: Ball, override: BallPattern | "auto"): number {
  const p = override !== "auto" ? override : getBallType(ball.typeId)?.pattern ?? "seam";
  return Math.max(0, BALL_PATTERNS.indexOf(p));
}

const tmpColor = new Color();

/** The pool of ball spheres, kept in step with game.balls. */
export class Balls3D {
  private views = new Map<string, BallView>();
  private geometry: SphereGeometry;
  private m = new Matrix4();
  private r = new Matrix4();
  private a = new Matrix4();
  private c = new Vector3();
  /** The last frame's poses, by ball id, for the light placement. */
  readonly poses = new Map<string, BallPose>();

  constructor(private parent: Group, segments: number) {
    this.geometry = new SphereGeometry(1, segments, Math.round(segments * 0.7));
  }

  private viewFor(ball: Ball): BallView {
    let v = this.views.get(ball.id);
    if (v) return v;
    const uniforms: ShellUniforms = {
      uGlow: { value: 1 }, uShade: { value: 0 }, uPattern: { value: 0 },
      uGlint: { value: 0 }, uGlintDir: { value: new Vector3(0, 0, 1) },
    };
    const material = new MeshStandardMaterial({ color: 0x222222, roughness: 0.32, metalness: 0 });
    // The ball's own light sits at its centre. Front faces only in the shadow
    // pass means that, seen from inside, the shell casts nothing - the lamp is
    // not blocked by its own glass - while every OTHER light still sees a solid.
    material.shadowSide = FrontSide;
    shell(material, uniforms);
    const mesh = new Mesh(this.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.parent.add(mesh);
    v = { mesh, material, uniforms, q: new Quaternion(), lastX: NaN, lastZ: NaN, spin: 0, seen: true };
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
  sync(game: CanvasGameState, now: number, eye = Infinity, k = 1, look?: ShellView): void {
    for (const v of this.views.values()) v.seen = false;
    this.poses.clear();
    const dress = getBallLook();
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
      let turned = 0;
      if (rolling && Number.isFinite(v.lastX)
        && rollStep(v.q, p.x - v.lastX, p.y - v.lastZ, ball.radius)) {
        turned = Math.hypot(p.x - v.lastX, p.y - v.lastZ) / ball.radius;
      }
      v.lastX = p.x; v.lastZ = p.y;
      // Smoothed, so a single long frame does not blink the pattern off.
      v.spin = v.spin * 0.7 + turned * 0.3;

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
      v.uniforms.uPattern.value = patternIndex(ball, dress.pattern);
      v.uniforms.uShade.value = dress.shade
        * shellContrast(v.spin, pose.r * (look?.pxPerUnit ?? 1));
      v.uniforms.uGlint.value = pose.dormant ? 0 : dress.glint * pose.glow;
      if (look) {
        // The ball's centre in the scene, then the way to the key light, turned
        // into view space where the shader's normals are.
        this.c.set(pose.x, pose.r * pose.sy, pose.z).applyMatrix4(look.board);
        v.uniforms.uGlintDir.value.copy(look.key).sub(this.c).normalize().transformDirection(look.view);
      }
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

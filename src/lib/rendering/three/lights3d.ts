/**
 * The 3D board's lights: the monitor, the room's fill, and a fixed pool of
 * point lights that every ball, flash, spark and explosion borrows from.
 *
 * THE RULES ARE light.ts's, now made of real lights:
 *
 *   THE MONITOR is the key light, a spot past the bottom-right corner, pinned
 *     to the SCREEN rather than the board, so a rotated or tilting map turns
 *     under a light that stays put. It is placed so a slab's shadow is the
 *     length the 2D model was tuned to (SHADOW_LENGTH: 1.15x its height at
 *     the board's centre), and it flickers with monitorSignal like before.
 *   THE BALLS are lamps: each ball's light sits at its centre, its own glass
 *     does not block it (balls3d.ts), and every fence, slab and other ball
 *     around it throws a real shadow away from it.
 *   EVERYTHING ELSE that made light in 2D - lock flashes, a bounce's spark, a
 *     growing cut's hot tips, a mirror's return - comes from the same list the
 *     2D light pass builds (ballLightPass.worldLights), so the two renderers
 *     agree about what is lit. Explosions add theirs (explosions3d.ts).
 *
 * THE POOL. three.js compiles a shader per number of lights, so the pool is a
 * fixed size per quality tier and never grows. Each frame the wanted lights are
 * ranked - the lamp of a lamp map, then explosions, then balls by brightness,
 * then the rest - and the first few take the SHADOWED lights, the next ones the
 * plain ones, and anything past the pool is dropped (it is the dimmest).
 * An unused light is left at zero; an unused shadowed one also stops
 * re-rendering its six-sided shadow map, which is the expensive part.
 */
import {
  Color, HemisphereLight, PointLight, SpotLight, Object3D, type Group, type Scene,
} from "three";
import type { MoteLight } from "@/lib/rendering/motes";
import { PALETTE, mix } from "@/lib/rendering/sleek/palette";
import { MIN_MAP_LIGHT } from "@/lib/rendering/sleek/boardWash";
import type { QualityPreset } from "./quality";
import type { BlastLight } from "./explosions3d";

/** Where the monitor sits, in board widths past the bottom-right corner (light.ts). */
const LIGHT_OFFSET_X = 0.85;
const LIGHT_OFFSET_Y = 0.72;
/** Shadow length / caster height at the board centre (light.ts SHADOW_LENGTH). */
const SHADOW_LENGTH = 1.15;

/**
 * Brightness split. The board's colours were picked to read at roughly their
 * own value under the 2D wash, so the fill and the key together are set to
 * give back about that: three's Lambert term divides by pi, so a fill of
 * `FILL * pi` returns FILL of the albedo, and the key adds the rest where it
 * falls square.
 */
const FILL = 0.15;
const KEY = 0.4;
/** The spot cone's soft edge; the cone is widened so it falls outside the board. */
const MONITOR_PENUMBRA = 0.2;

/**
 * The room's brightness for a map's authored light (LevelConfig.light): 1 on a
 * normal map, falling to what the 2D wash leaves at MIN_MAP_LIGHT (boardWash.ts),
 * so a dark map is as dark in 3D as it was in 2D and the balls carry it.
 */
export function roomLevel(mapLight = 1): number {
  const t = Math.min(1, Math.max(0, (1 - mapLight) / (1 - MIN_MAP_LIGHT)));
  return 1 - 0.38 * t;
}

/** One light the frame wants, in untilted world units. */
export interface WantedLight {
  x: number;
  y: number;
  height: number;
  reach: number;
  intensity: number;
  color: number;
  /** Lower ranks first. */
  rank: number;
  /** A ball's light: placed at the ball's own centre. */
  ballId?: string;
  /**
   * Light that must END at its reach, evenly bright inside it: the charge's
   * blast radius, where "inside the red" has to mean exactly "inside the
   * blast". An ordinary pool fades out well past its reach instead.
   */
  cutoff?: boolean;
}

/** How one ball's own light is retoned this frame (the pocket glow). */
export interface BallTone {
  /** Brightness multiplier. */
  gain: number;
  /** Colour to blend toward, and how far (0 = the ball's own). */
  tint: number;
  mix: number;
}

/**
 * A point light's shadow bias, in WORLD units. three takes the bias in the
 * shadow map's own depth range (near to far), so a fixed number means a
 * different distance for every light: the same -0.002 that is half a unit for
 * a ball's 214-unit pool was six units for the lamp's 3000, which swallowed a
 * fence's whole shadow. Set per light from its range instead.
 */
const SHADOW_BIAS_WORLD = -0.5;

/**
 * The point lights' falloff, and the gain from the 2D light list's intensity
 * to three's units. Tuned against the 2D pools: a ball at full brightness
 * lifts the floor a ball's width away by about what its additive pool did
 * (the sheen in surfaceMaterial.ts is the other half of that).
 */
const POINT_DECAY = 1.3;
const POINT_GAIN = 1300;
/** A cut-off light's falloff and gain (WantedLight.cutoff). */
const CUTOFF_DECAY = 0.35;
const CUTOFF_GAIN = 18;

/**
 * The lamp: on most maps one ball holds it (lampBall.ts), and then it, not the
 * monitor, is the board's key light. High enough over its ball that a slab a
 * typical distance away throws about the 2D SHADOW_LENGTH (1.15x its height),
 * and as bright as the monitor it replaces.
 */
export const LAMP_HEIGHT = 200;
const LAMP_GAIN = 0.7;

/**
 * The monitor's spot, in the scene's screen-aligned world units.
 * Exported for the test that pins the shadow length.
 */
export function monitorPlacement(): { x: number; y: number; z: number } {
  const x = 900 * (1 + LIGHT_OFFSET_X);
  const z = 900 * (1 + LIGHT_OFFSET_Y);
  const d = Math.hypot(x - 450, z - 450);
  // A caster of height h at the centre throws h * d / (H - h) ~= h * d / H.
  return { x, y: d / SHADOW_LENGTH, z };
}

/** The widest angle from the spot's axis (aimed at the centre) to a board corner. */
export function monitorConeAngle(at: { x: number; y: number; z: number }): number {
  const ax = 450 - at.x, ay = -at.y, az = 450 - at.z;
  const al = Math.hypot(ax, ay, az);
  let widest = 0;
  for (const [cx, cz] of [[0, 0], [900, 0], [0, 900], [900, 900]]) {
    const bx = cx - at.x, by = -at.y, bz = cz - at.z;
    const cos = (ax * bx + ay * by + az * bz) / (al * Math.hypot(bx, by, bz));
    widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, cos))));
  }
  return widest;
}

/** The lamp of a lamp map this frame, in untilted world units (lampBall.ts). */
export interface LampLight {
  x: number;
  y: number;
  /** Brightness through a handover (it dips as the light travels). */
  level: number;
  color: number;
}

/** Rank and merge every light the frame wants. Pure, for the tests. */
export function wantedLights(
  worldLights: readonly MoteLight[],
  blasts: readonly BlastLight[],
  ballCentres: ReadonlyMap<string, { x: number; z: number; y: number }>,
  lamp: LampLight | null,
  /** Lights from the light mechanics (charges, sparks), already ranked. */
  extras: readonly WantedLight[] = [],
  /** Per-ball retoning of each ball's own light (the pocket glow). */
  tones?: ReadonlyMap<string, BallTone>,
): WantedLight[] {
  const out: WantedLight[] = [...extras];
  // The lamp stands high over where the 2D lamp scope puts it, so it throws the
  // monitor's kind of shadow from a new place, which is the whole lamp
  // mechanic (light.ts). Mostly white: in 2D its colour tinted rims, and a
  // board-wide light in a ball's full colour would repaint the whole board.
  if (lamp && lamp.level > 0.002) {
    out.push({
      x: lamp.x, y: lamp.y, height: LAMP_HEIGHT, reach: 0,
      intensity: lamp.level, color: mix(lamp.color, 0xffffff, 0.85), rank: 0,
    });
  }
  for (const b of blasts) {
    if (b.intensity <= 0.002) continue;
    out.push({ ...b, rank: 1 });
  }
  for (const l of worldLights) {
    const ball = l.ballId ? ballCentres.get(l.ballId) : undefined;
    const tone = l.ballId ? tones?.get(l.ballId) : undefined;
    out.push({
      // A ball's light at its centre: its glass does not block it (balls3d.ts).
      x: ball ? ball.x : l.x,
      y: ball ? ball.z : l.y,
      height: ball ? ball.y : 22,
      reach: l.reach,
      intensity: l.intensity * (tone?.gain ?? 1),
      color: tone && tone.mix > 0 ? mix(l.color, tone.tint, tone.mix) : l.color,
      rank: ball ? 2 : 3,
      ballId: l.ballId,
    });
  }
  out.sort((a, b) => a.rank - b.rank || b.intensity - a.intensity);
  return out;
}

export class Lights3D {
  readonly monitor: SpotLight;
  readonly fill: HemisphereLight;
  private shadowed: PointLight[] = [];
  private plain: PointLight[] = [];
  private target = new Object3D();
  private c = new Color();
  private room = 1;

  constructor(scene: Scene, private board: Group, preset: QualityPreset) {
    const at = monitorPlacement();
    // The monitor's cold blue, mostly whitened: in 2D its colour only tinted
    // rims, and a fully blue key light would turn the whole green board grey.
    this.monitor = new SpotLight(mix(PALETTE.monitor, 0xffffff, 0.55), KEY * Math.PI, 0, 1, MONITOR_PENUMBRA, 0);
    this.monitor.position.set(at.x, at.y, at.z);
    this.target.position.set(450, 0, 450);
    scene.add(this.target);
    this.monitor.target = this.target;
    // Wide enough to take in every corner of the board, plus the penumbra's
    // soft edge, so the cone's falloff never shows on the board itself.
    this.monitor.angle = Math.min(1.4, monitorConeAngle(at) / (1 - MONITOR_PENUMBRA) + 0.02);
    this.monitor.castShadow = true;
    this.monitor.shadow.mapSize.set(preset.keyShadowSize, preset.keyShadowSize);
    this.monitor.shadow.camera.near = Math.max(50, at.y * 0.5);
    this.monitor.shadow.camera.far = Math.hypot(at.x, at.y, at.z) + 400;
    this.monitor.shadow.bias = -0.0004;
    this.monitor.shadow.normalBias = 0.6;
    this.monitor.shadow.radius = 3;
    // Made once now whatever the lamp says: an unmade shadow map breaks every
    // draw (see the point lights below), and a lamp map yields the monitor's
    // shadow from its very first frame.
    this.monitor.shadow.needsUpdate = true;
    scene.add(this.monitor);

    // The room: a cool sky over a dark floor, so a face turned away from every
    // light is dim rather than black, and tops read brighter than sides.
    this.fill = new HemisphereLight(0xeef6ff, 0x0a1410, FILL * Math.PI);
    scene.add(this.fill);

    for (let i = 0; i < preset.shadowedLights; i++) {
      const l = new PointLight(0xffffff, 0, 100, POINT_DECAY);
      l.castShadow = true;
      l.shadow.mapSize.set(preset.pointShadowSize, preset.pointShadowSize);
      l.shadow.camera.near = 2;
      l.shadow.bias = -0.002;
      l.shadow.normalBias = 0.4;
      l.shadow.radius = 2;
      l.shadow.autoUpdate = false;
      // Rendered once now, so its map EXISTS. three binds an ordinary cube
      // texture to a shadowed point light whose map was never made, and a
      // colour texture in a depth-compare sampler invalidates every draw that
      // uses the shader - the whole board, not just that light.
      l.shadow.needsUpdate = true;
      board.add(l);
      this.shadowed.push(l);
    }
    for (let i = 0; i < preset.plainLights; i++) {
      const l = new PointLight(0xffffff, 0, 100, POINT_DECAY);
      board.add(l);
      this.plain.push(l);
    }
  }

  private place(l: PointLight, w: WantedLight | undefined): void {
    if (!w) {
      l.intensity = 0;
      if (l.castShadow) l.shadow.autoUpdate = false;
      return;
    }
    l.position.set(w.x, w.height, w.y);
    l.color.copy(this.c.setHex(w.color));
    if (w.rank === 0) {
      // The lamp: no falloff, like the monitor; the board's own angle to it
      // is all the shading it needs.
      l.decay = 0;
      l.distance = 0;
      l.intensity = w.intensity * LAMP_GAIN * Math.PI * KEY * this.room;
      if (l.castShadow) {
        l.shadow.autoUpdate = true;
        l.shadow.camera.far = 3000;
        l.shadow.bias = SHADOW_BIAS_WORLD / 3000;
      }
      return;
    }
    if (w.cutoff) {
      // Nearly flat out to the reach, then three's distance window takes it to
      // nothing right AT the reach, so the lit disc is the reach.
      l.decay = CUTOFF_DECAY;
      l.distance = Math.max(20, w.reach);
      l.intensity = w.intensity * CUTOFF_GAIN;
    } else {
      l.decay = POINT_DECAY;
      l.distance = Math.max(20, w.reach * 2.2);
      l.intensity = w.intensity * POINT_GAIN * Math.pow(Math.max(30, w.reach) / 97, POINT_DECAY);
    }
    if (l.castShadow) {
      l.shadow.autoUpdate = true;
      l.shadow.camera.far = l.distance;
      l.shadow.bias = SHADOW_BIAS_WORLD / l.distance;
    }
  }

  /**
   * Place this frame's lights. `monitorLevel` is the flicker; `lampLevel` dims
   * the monitor while a ball holds the lamp, which is the lamp mechanic.
   */
  sync(wanted: readonly WantedLight[], monitorLevel: number, lampLevel: number, room = 1): void {
    this.room = room;
    // While a ball holds the lamp the monitor yields to it (the lamp takes the
    // key light's job, light.ts), and the room fill stays: the 2D board never
    // got darker for a lamp, only lit from somewhere else.
    this.monitor.intensity = KEY * Math.PI * monitorLevel * room * (1 - 0.75 * lampLevel);
    this.fill.intensity = FILL * Math.PI * room;
    // The yielded monitor still fills, but its shadows would argue with the
    // lamp's about where the light is. Faded with the lamp, and not re-rendered
    // at all while the lamp is fully in charge, which saves a whole pass.
    this.monitor.shadow.intensity = 1 - lampLevel;
    this.monitor.shadow.autoUpdate = lampLevel < 0.999;
    let i = 0;
    for (const l of this.shadowed) this.place(l, wanted[i++]);
    for (const l of this.plain) this.place(l, wanted[i++]);
  }

  dispose(): void {
    for (const l of [...this.shadowed, ...this.plain]) {
      this.board.remove(l);
      l.dispose();
    }
    this.monitor.dispose();
    this.fill.dispose();
  }
}

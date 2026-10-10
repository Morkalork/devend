/**
 * The board's props as things standing on it: pickup tokens and chest loot as
 * faceted gems hovering over the floor, bugs as beetles on six legs, charge
 * fuses as canisters and circuit terminals as pedestals.
 *
 * The 2D prop layer drew all of these as discs with a painted shadow and a lit
 * limb, which is how a flat board fakes an object. Under the 3D board the
 * painted halves go (propLayer `hybrid`): the body here takes the real lights
 * and casts a real shadow, and what stays flat is what belongs to the floor -
 * a token's glow pooled under it, a fuse's blast ring, a terminal's dashed
 * link to the ball it wakes, a dangerous bug's warning ring.
 *
 * Read-only, like every 3D layer: each frame is built from the game state and
 * the clock (`propPoses`), so nothing here can drift from what the simulation
 * says. The meshes are pooled per kind and hidden when unused; a busy board
 * has a dozen props, so per-object meshes and materials cost nothing worth a
 * cleverer scheme.
 */
import {
  BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  OctahedronGeometry, SphereGeometry, type BufferGeometry,
} from "three";
import type { CanvasGameState } from "@/types/gameState";
import { PALETTE, PICKUP_COLORS, mix } from "@/lib/rendering/sleek/palette";
import { getBug } from "@/lib/bugs";
import { BUG_EXPIRY_WARN_SECONDS, BUG_RADIUS } from "@/lib/physics/bugs";

export type PropKind = "pickup" | "loot" | "bug" | "charge" | "terminal";

/** One prop as the 3D board draws it, in untilted world units (y up). */
export interface PropPose {
  kind: PropKind;
  x: number;
  /** Height of the body's centre (gems) or its base (everything else). */
  y: number;
  z: number;
  /** Body radius, world units. */
  size: number;
  /** Turn about the up axis, radians, in the board's own (x, y) sense. */
  yaw: number;
  /** Display hex. */
  color: number;
  /** Emissive gain: how much the prop glows of its own. */
  glow: number;
  opacity: number;
  /** Bugs: the leg cycle, from the flight code's wander phase. */
  legPhase: number;
}

/** A pickup gem's radius and the height it hovers at, world units. */
export const PICKUP_GEM = { radius: 12, hover: 19, bob: 2.5 } as const;
/** A loot gem's radius. */
export const LOOT_GEM = 7;
/** How tall a fuse canister and a terminal pedestal stand. */
export const CANISTER_HEIGHT = 9;
export const PEDESTAL_HEIGHT = 5;

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

/** Every prop on the board this frame, as poses. Pure: game state and clock. */
export function propPoses(game: CanvasGameState, now: number, out: PropPose[] = []): PropPose[] {
  out.length = 0;
  const play = game.activePlaySeconds;

  for (const p of game.pickups ?? []) {
    const seed = seedOf(p.id);
    const life = p.expiresAtSeconds - p.spawnedAtSeconds;
    const left = p.expiresAtSeconds - play;
    // The 2D token's fade, unchanged: frozen tokens never expire.
    const fade = game.freezePickups || life <= 0 ? 1 : Math.max(0.25, Math.min(1, left / (life * 0.35)));
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    out.push({
      kind: "pickup",
      x: p.position.x,
      y: PICKUP_GEM.hover + PICKUP_GEM.bob * Math.sin(now / 420 + seed),
      z: p.position.y,
      size: PICKUP_GEM.radius,
      yaw: now / 700 + seed,
      color: PICKUP_COLORS[p.effect] ?? PALETTE.amber,
      glow: (0.8 + 0.35 * pulse) * fade,
      opacity: fade,
      legPhase: 0,
    });
  }

  for (const g of game.chestLoot ?? []) {
    const seed = seedOf(g.id);
    out.push({
      kind: "loot",
      x: g.x,
      // Tumbling while it skids, resting on a point once it settles.
      y: LOOT_GEM * 1.2 + (g.settled ? 0 : 2.5 * Math.abs(Math.sin(now / 90 + seed))),
      z: g.y,
      size: LOOT_GEM,
      yaw: (g.settled ? now / 900 : now / 140) + seed,
      color: PALETTE.amber,
      glow: 0.6,
      opacity: 1,
      legPhase: 0,
    });
  }

  for (const bug of game.bugs ?? []) {
    const def = getBug(bug.effect);
    const left = bug.expiresAtSeconds - play;
    const fade = left <= BUG_EXPIRY_WARN_SECONDS ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 90)) : 1;
    out.push({
      kind: "bug",
      x: bug.position.x,
      y: 0,
      z: bug.position.y,
      size: BUG_RADIUS,
      yaw: Math.atan2(bug.velocity.y, bug.velocity.x),
      color: def ? Number.parseInt(def.color.replace("#", ""), 16) : PALETTE.amber,
      glow: 0.18 * fade,
      opacity: fade,
      legPhase: bug.wander * 2.1 + bug.wanderSeed,
    });
  }

  for (const ch of game.charges ?? []) {
    if (ch.blown) continue;
    const armed = ch.armedAt !== null;
    let glow = 0.5;
    if (armed) {
      // The 2D fuse's blink, faster as it burns down.
      const t = Math.max(0, Math.min(1, (play - (ch.armedAt ?? 0)) / Math.max(0.001, ch.delaySeconds)));
      glow = 0.6 + 1.6 * (0.5 + 0.5 * Math.sin(now / (170 - t * 110)));
    }
    out.push({
      kind: "charge",
      x: ch.fuse.x, y: 0, z: ch.fuse.y,
      size: Math.max(5, ch.radius * 0.5),
      yaw: 0,
      color: armed ? PALETTE.danger : PALETTE.amber,
      glow,
      opacity: 1,
      legPhase: 0,
    });
  }

  const circuit = game.circuit;
  if (circuit) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 340);
    for (const t of circuit.terminals) {
      out.push({
        kind: "terminal",
        x: t.x, y: 0, z: t.y,
        size: t.radius,
        yaw: 0,
        color: t.lit ? PALETTE.areaConst : 0x59b3a3,
        // A solved terminal holds steady; an open one breathes.
        glow: t.lit ? 1.3 : 0.35 + 0.55 * pulse,
        opacity: 1,
        legPhase: 0,
      });
    }
  }
  return out;
}

const tmp = new Color();

/** A material for one prop: its colour, a glow of its own, and fading. */
function propMaterial(roughness: number, metalness = 0, flat = false): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xffffff, roughness, metalness, flatShading: flat });
}

function setLook(mat: MeshStandardMaterial, color: number, glow: number, opacity: number, body = 1): void {
  mat.color.setHex(body === 1 ? color : mix(PALETTE.shadow, color, body));
  mat.emissive.copy(tmp.setHex(color)).multiplyScalar(glow);
  const fading = opacity < 0.999;
  if (mat.transparent !== fading) { mat.transparent = fading; mat.needsUpdate = true; }
  mat.opacity = opacity;
}

/** A prop's meshes, built once per pooled slot. */
interface Slot {
  root: Group;
  mats: MeshStandardMaterial[];
  legs: Mesh[];
}

export class Props3D {
  private group = new Group();
  private pools: Record<PropKind, Slot[]> = { pickup: [], loot: [], bug: [], charge: [], terminal: [] };
  private poses: PropPose[] = [];
  private gem = new OctahedronGeometry(1, 0);
  private sphere: SphereGeometry;
  /** Unit cylinder standing on its base. */
  private cylinder = new CylinderGeometry(1, 1, 1, 20).translate(0, 0.5, 0);
  /** Unit box reaching out along +x from its origin (a leg). */
  private leg = new BoxGeometry(1, 1, 1).translate(0.5, 0, 0);

  constructor(private parent: Group, segments = 24) {
    this.sphere = new SphereGeometry(1, Math.max(10, segments >> 1), Math.max(8, segments >> 2));
    parent.add(this.group);
  }

  private mesh(geo: BufferGeometry, mat: MeshStandardMaterial, root: Group): Mesh {
    const m = new Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  }

  private build(kind: PropKind): Slot {
    const root = new Group();
    const slot: Slot = { root, mats: [], legs: [] };
    if (kind === "pickup" || kind === "loot") {
      const mat = propMaterial(0.25, 0.1, true);
      slot.mats.push(mat);
      this.mesh(this.gem, mat, root).scale.set(1, 1.3, 1);
    } else if (kind === "bug") {
      const body = propMaterial(0.45);
      const legs = propMaterial(0.6);
      slot.mats.push(body, legs);
      const abdomen = this.mesh(this.sphere, body, root);
      abdomen.position.set(-0.35, 0.5, 0);
      abdomen.scale.set(0.95, 0.5, 0.7);
      const head = this.mesh(this.sphere, body, root);
      head.position.set(0.6, 0.45, 0);
      head.scale.setScalar(0.5);
      for (let i = 0; i < 6; i++) {
        const leg = this.mesh(this.leg, legs, root);
        leg.castShadow = false;
        leg.scale.set(1.35, 0.12, 0.12);
        slot.legs.push(leg);
      }
    } else {
      // Charge canister and terminal pedestal: a dark body with a lit cap.
      const body = propMaterial(0.5, 0.35);
      const cap = propMaterial(0.3);
      slot.mats.push(body, cap);
      const tall = kind === "charge" ? CANISTER_HEIGHT : PEDESTAL_HEIGHT;
      const wide = kind === "charge" ? 1 : 0.75;
      const lens = kind === "charge" ? 0.55 : 0.45;
      this.mesh(this.cylinder, body, root).scale.set(wide, tall, wide);
      const top = this.mesh(this.cylinder, cap, root);
      top.position.y = tall;
      top.scale.set(lens, kind === "charge" ? 2.5 : 1.5, lens);
      top.castShadow = false;
    }
    this.group.add(root);
    return slot;
  }

  sync(game: CanvasGameState, now: number): void {
    const poses = propPoses(game, now, this.poses);
    const used: Record<PropKind, number> = { pickup: 0, loot: 0, bug: 0, charge: 0, terminal: 0 };
    for (const p of poses) {
      const pool = this.pools[p.kind];
      const slot = pool[used[p.kind]] ?? (pool[used[p.kind]] = this.build(p.kind));
      used[p.kind]++;
      const root = slot.root;
      root.visible = true;
      root.position.set(p.x, p.y, p.z);
      // Board yaw a in (x, y) is a turn of -a about three's up axis (x, z).
      root.rotation.y = -p.yaw;
      if (p.kind === "pickup" || p.kind === "loot") {
        root.scale.setScalar(p.size);
        setLook(slot.mats[0], p.color, p.glow, p.opacity);
      } else if (p.kind === "bug") {
        root.scale.setScalar(p.size);
        setLook(slot.mats[0], p.color, p.glow, p.opacity, 0.7);
        setLook(slot.mats[1], p.color, p.glow * 0.5, p.opacity * 0.8, 0.6);
        // Three a side, swinging on the flight code's own phase (propLayer).
        for (let i = 0; i < 6; i++) {
          const k = i % 3;
          const side = i < 3 ? 1 : -1;
          const swing = Math.sin(p.legPhase + k) * 0.5;
          const leg = slot.legs[i];
          leg.position.set((k - 1) * 0.55, 0.3, 0);
          leg.rotation.set(0, -side * (Math.PI / 2 + swing * side), -0.35);
        }
      } else {
        root.scale.set(p.size, 1, p.size);
        setLook(slot.mats[0], p.color, 0.04, 1, 0.35);
        setLook(slot.mats[1], p.color, p.glow, 1);
      }
    }
    for (const kind of Object.keys(this.pools) as PropKind[]) {
      const pool = this.pools[kind];
      for (let i = used[kind]; i < pool.length; i++) pool[i].root.visible = false;
    }
  }

  dispose(): void {
    this.parent.remove(this.group);
    for (const pool of Object.values(this.pools)) {
      for (const slot of pool) for (const m of slot.mats) m.dispose();
    }
    this.gem.dispose();
    this.sphere.dispose();
    this.cylinder.dispose();
    this.leg.dispose();
  }
}

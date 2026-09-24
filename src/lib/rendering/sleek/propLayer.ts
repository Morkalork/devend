/**
 * Board props: circuit terminals, charge fuses, data-stream seams, pickup tokens
 * and chest loot.
 *
 * These split cleanly into two lighting classes, and getting the split right is
 * what keeps the scene coherent:
 *
 *   EMITTERS (terminals, armed fuses, live seams) are light SOURCES in their own
 *     right. They cast no shadow and take no ambient dimming - a glowing thing
 *     that gets darker in the corner of the room reads as painted-on.
 *   OBJECTS (pickup tokens, loot gems) are physical things resting on the board,
 *     so they get the full treatment: cast shadow, contact shading and a lit
 *     limb, exactly like a ball.
 *
 * Everything here is redrawn every frame: all of it animates.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { dashedLine } from "./dashedLine";
import { PALETTE, mix } from "./palette";
import { ambientAt, contactFor, shadowFor, slabHeight, type LightScope } from "./light";
import type { Pt } from "./pixelGrid";
import { getBug } from "@/lib/bugs";
import { BUG_BIRTH_SECONDS, BUG_EXPIRY_WARN_SECONDS, BUG_RADIUS } from "@/lib/physics/bugs";

type W2S = (x: number, y: number) => Pt;

/** Colour per pickup effect, so a token is identifiable before you read it. */
const PICKUP_COLORS: Record<string, number> = {
  overtime: 0x00ff88,
  capRaise: 0xffd76b,
  freezeCharge: 0xbfefff,
  fork: 0xff9ebf,
  freeShopItem: 0x9fe6ff,
  extraLife: 0xff5b7a,
  rainbowConvert: 0xffbf80,
};

export class PropLayer {
  readonly container = new Container();

  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private glows = new Graphics();
  private bodies = new Graphics();

  constructor() {
    // Glows sit under bodies so a token's core stays legible inside its halo.
    // No shadow child: cast shadows go to the shared floor plane.
    this.container.addChild(this.glows, this.bodies);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    shadows: Graphics,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    this.shadows = shadows;
    this.glows.clear();
    this.bodies.clear();

    this.drawDataStream(game, w2s, scale, now);
    this.drawCircuit(game, w2s, scale, now);
    this.drawCharges(game, w2s, scale, now);
    this.drawPickups(game, light, w2s, scale, now);
    this.drawBugs(game, light, w2s, scale, now);
    this.drawChestLoot(game, light, w2s, scale);
  }

  /**
   * The seam. Unharvested spans are a dim vein; harvested ones light up and stay
   * lit, so the player can see exactly how much of the payout they have taken.
   */
  private drawDataStream(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const ds = game.dataStream;
    if (!ds || ds.path.length < 2) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 420);

    for (let i = 0; i < ds.path.length - 1; i++) {
      const a = w2s(ds.path[i].x, ds.path[i].y);
      const b = w2s(ds.path[i + 1].x, ds.path[i + 1].y);
      const done = ds.harvested[i];
      const width = Math.max(1, ds.width * scale);

      this.glows
        .moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({
          width: width * (done ? 1.5 : 1.1),
          color: done ? PALETTE.accent : PALETTE.accentDim,
          alpha: done ? 0.30 : 0.12 + pulse * 0.05,
          cap: "round",
        });
      this.bodies
        .moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({
          width: Math.max(1, width * 0.3),
          color: done ? PALETTE.accentGlow : PALETTE.accentDim,
          alpha: done ? 0.95 : 0.45 + pulse * 0.15,
          cap: "round",
        });
    }
  }

  /**
   * Circuit terminals. An unlit terminal breathes (it wants routing through);
   * a lit one holds steady, because a solved thing should stop asking for
   * attention.
   */
  private drawCircuit(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const c = game.circuit;
    if (!c) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 340);

    for (const t of c.terminals) {
      const p = w2s(t.x, t.y);
      const r = Math.max(6, t.radius * scale);
      const color = t.lit ? PALETTE.areaConst : 0x59b3a3;

      // Dashed link to the sleeper this terminal wakes. Without it the player
      // can see terminals and can see caged balls, but nothing says WHICH node
      // wakes WHICH ball - and on a multi-terminal map that is the whole puzzle.
      const sleeper = game.balls.find(b => b.id === t.ballId);
      if (sleeper && sleeper.state === "dormant") {
        const bp = w2s(sleeper.position.x, sleeper.position.y);
        dashedLine(this.glows, p.x, p.y, bp.x, bp.y, 8 * scale, 6 * scale);
        this.glows.stroke({
          width: Math.max(1, 1.5 * scale),
          color,
          alpha: 0.2 + 0.25 * (t.lit ? 1 : pulse),
        });
      }

      this.glows
        .circle(p.x, p.y, r + (t.lit ? 5 : 4 + 6 * pulse) * scale)
        .fill({ color, alpha: t.lit ? 0.22 : 0.10 + pulse * 0.06 });
      this.bodies
        .circle(p.x, p.y, r + (t.lit ? 0 : 1.5 * pulse * scale))
        .stroke({ width: Math.max(2, 3 * scale), color, alpha: t.lit ? 1 : 0.7 + 0.3 * pulse });
      this.bodies
        .circle(p.x, p.y, Math.max(2, 3.5 * scale))
        .fill({ color, alpha: t.lit ? 1 : 0.6 + 0.4 * pulse });
    }
  }

  /**
   * Charge fuses. Unarmed is a quiet marker; ARMED is the loudest thing on the
   * board, because the player has a few seconds to get clear of the blast.
   */
  private drawCharges(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const ch of game.charges ?? []) {
      if (ch.blown) continue;
      const p = w2s(ch.fuse.x, ch.fuse.y);
      const r = Math.max(5, ch.radius * scale * 0.5);
      const armed = ch.armedAt !== null;

      if (armed) {
        // Urgency rises as the fuse burns down: faster blink, bigger halo.
        const elapsed = game.activePlaySeconds - (ch.armedAt ?? 0);
        const t = Math.max(0, Math.min(1, elapsed / Math.max(0.001, ch.delaySeconds)));
        const blink = 0.5 + 0.5 * Math.sin(now / (170 - t * 110));
        this.glows
          .circle(p.x, p.y, r + ch.blastRadius * scale * 0.12 * blink)
          .fill({ color: PALETTE.danger, alpha: 0.10 + blink * 0.16 });
        // The blast footprint, so "get clear" has an actual boundary.
        this.bodies
          .circle(p.x, p.y, ch.blastRadius * scale)
          .stroke({ width: 1, color: PALETTE.danger, alpha: 0.20 + blink * 0.25 });
        this.bodies
          .circle(p.x, p.y, r)
          .fill({ color: PALETTE.danger, alpha: 0.7 + blink * 0.3 });
      } else {
        this.glows.circle(p.x, p.y, r * 1.8).fill({ color: PALETTE.amber, alpha: 0.10 });
        this.bodies.circle(p.x, p.y, r).stroke({ width: Math.max(1, 2 * scale), color: PALETTE.amber, alpha: 0.8 });
        this.bodies.circle(p.x, p.y, r * 0.35).fill({ color: PALETTE.amber, alpha: 0.9 });
      }
    }
  }

  /**
   * Pickup tokens: real objects on the board, so they are lit and seated like
   * one. They also pulse, and fade as they approach expiry - the fade is the
   * only honest way to say "this is about to go".
   */
  private drawPickups(
    game: CanvasGameState,
    light: LightScope,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);

    for (const p of game.pickups) {
      const c = w2s(p.position.x, p.position.y);
      const r = Math.max(5, 14 * scale);
      const color = PICKUP_COLORS[p.effect] ?? PALETTE.amber;

      // Frozen tokens never expire, so they never fade.
      const life = p.expiresAtSeconds - p.spawnedAtSeconds;
      const left = p.expiresAtSeconds - game.activePlaySeconds;
      const fade = game.freezePickups || life <= 0 ? 1 : Math.max(0.25, Math.min(1, left / (life * 0.35)));

      const cast = shadowFor(light, c.x, c.y, slabHeight(scale));
      this.shadows
        .ellipse(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r * 0.95, r * 0.66)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * fade });
      const contact = contactFor(light, c.x, c.y, slabHeight(scale));
      this.shadows
        .ellipse(c.x + contact.dx * contact.length, c.y + contact.dy * contact.length, r * 0.9, r * 0.62)
        .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.4 * fade });

      this.glows
        .circle(c.x, c.y, r * (1.5 + pulse * 0.25))
        .fill({ color, alpha: (0.10 + pulse * 0.08) * fade });

      const amb = ambientAt(light, c.x, c.y);
      this.bodies
        .circle(c.x, c.y, r)
        .fill({ color: mix(PALETTE.shadow, color, 0.5 + amb * 0.5), alpha: fade });
      this.bodies
        .circle(c.x, c.y, r)
        .stroke({ width: 1, color, alpha: 0.9 * fade });

      // Lit limb, aimed at the monitor like every other round object.
      const bearing = Math.atan2(light.y - c.y, light.x - c.x);
      this.bodies
        .circle(c.x + Math.cos(bearing) * r * 0.4, c.y + Math.sin(bearing) * r * 0.4, r * 0.2)
        .fill({ color: 0xffffff, alpha: 0.5 * light.level * fade });

      if (game.freezePickups) {
        this.bodies.circle(c.x, c.y, r * 1.15).stroke({ width: 1, color: PALETTE.frost, alpha: 0.6 * fade });
      }
    }
  }

  /** Loot gems from a smashed chest: small lit objects that bounce and settle. */
  /**
   * The bugs.
   *
   * Drawn as OBJECTS in this file's lighting split - shadow, contact, lit limb -
   * because that is what sells them as things on the board rather than marks on
   * it, and a power-up a player is meant to aim at has to read as physical.
   *
   * Three things are doing work here beyond looking like an insect:
   *
   *   IT FACES WHERE IT IS GOING   the body points along the heading, so a
   *                                player can see which way it is about to
   *                                scuttle and lead a ball there. A symmetric
   *                                blob would hide the one piece of information
   *                                that makes the squash plannable.
   *   ITS LEGS RUN AT ITS SPEED    the leg cycle is driven by the wander phase
   *                                the flight code advances, so the darts and
   *                                the crawls are visible as darts and crawls
   *                                rather than as a constant jiggle.
   *   DANGER IS MARKED             a `danger` bug wears a broken warning ring.
   *                                Big Bang Release can end a map, and a
   *                                power-up that costs you the run without ever
   *                                having looked different is a trap, not a
   *                                choice.
   */
  private drawBugs(
    game: CanvasGameState,
    light: LightScope,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    const bugs = game.bugs;
    if (!bugs || bugs.length === 0) return;

    for (const bug of bugs) {
      const def = getBug(bug.effect);
      const color = def ? Number.parseInt(def.color.replace("#", ""), 16) : PALETTE.amber;
      const c = w2s(bug.position.x, bug.position.y);
      const r = Math.max(4, BUG_RADIUS * scale);

      // Blink out the last few seconds. Same cue the tokens use, so "this is
      // about to be gone" is one language on the board rather than two.
      const left = bug.expiresAtSeconds - game.activePlaySeconds;
      const expiring = left <= BUG_EXPIRY_WARN_SECONDS;
      const fade = expiring ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 90)) : 1;

      const heading = Math.atan2(bug.velocity.y, bug.velocity.x);
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);

      // Just out of a shard: a ring thrown outward from where it was released.
      //
      // The break already throws rubble, so without this a bug that came out of
      // a brick is indistinguishable from one that happened to be flying past
      // the brick as it broke - and "it is clear they are RELEASED from
      // breaking a specific shard" is the whole point of carrying them. The
      // ring is anchored to the bug's birthplace rather than to the bug, so it
      // marks the shard even as the bug leaves it.
      if (bug.bornAtSeconds !== undefined) {
        const age = game.activePlaySeconds - bug.bornAtSeconds;
        if (age >= 0 && age < BUG_BIRTH_SECONDS) {
          const t = age / BUG_BIRTH_SECONDS;
          const birth = w2s(bug.spawnPosition?.x ?? bug.position.x, bug.spawnPosition?.y ?? bug.position.y);
          this.glows
            .circle(birth.x, birth.y, r * (1 + t * 3.5))
            .stroke({ width: Math.max(1, scale * 1.5 * (1 - t)), color, alpha: (1 - t) * 0.85 });
        }
      }

      const cast = shadowFor(light, c.x, c.y, slabHeight(scale) * 0.5);
      this.shadows
        .ellipse(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r * 0.9, r * 0.6)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * 0.8 * fade });

      this.glows
        .circle(c.x, c.y, r * 2.1)
        .fill({ color, alpha: 0.09 * fade });

      // Six legs, three a side, swinging on the flight code's own phase.
      const amb = ambientAt(light, c.x, c.y);
      for (let i = 0; i < 3; i++) {
        const along = (i - 1) * r * 0.55;
        const swing = Math.sin(bug.wander * 2.1 + bug.wanderSeed + i) * 0.5;
        for (const side of [1, -1]) {
          const bx = c.x + cos * along;
          const by = c.y + sin * along;
          const a = heading + side * (Math.PI / 2 + swing * side);
          this.bodies
            .moveTo(bx, by)
            .lineTo(bx + Math.cos(a) * r * 1.35, by + Math.sin(a) * r * 1.35)
            .stroke({ width: Math.max(1, scale), color, alpha: 0.55 * fade });
        }
      }

      // Abdomen and head: two bodies along the heading, so it has a front.
      this.bodies
        .ellipse(c.x - cos * r * 0.35, c.y - sin * r * 0.35, r * 0.95, r * 0.7)
        .fill({ color: mix(PALETTE.shadow, color, 0.45 + amb * 0.45), alpha: fade });
      this.bodies
        .circle(c.x + cos * r * 0.6, c.y + sin * r * 0.6, r * 0.5)
        .fill({ color: mix(PALETTE.shadow, color, 0.6 + amb * 0.4), alpha: fade });
      this.bodies
        .ellipse(c.x - cos * r * 0.35, c.y - sin * r * 0.35, r * 0.95, r * 0.7)
        .stroke({ width: 1, color, alpha: 0.85 * fade });

      // The lit limb every round object on this board wears, aimed at the monitor.
      const bearing = Math.atan2(light.y - c.y, light.x - c.x);
      this.bodies
        .circle(c.x + Math.cos(bearing) * r * 0.3, c.y + Math.sin(bearing) * r * 0.3, r * 0.22)
        .fill({ color: 0xffffff, alpha: 0.45 * light.level * fade });

      if (def?.danger) {
        // A broken ring, turning slowly: unmistakably a warning, and never
        // confusable with the solid rings this renderer uses for lock cues.
        //
        // Flattened to a polyline rather than stroked with arc(). Pixi reads a
        // plain arc's instruction data as if it were an arcToSvg when it works
        // out where the path finished, so a stroked arc leaves a corrupt point
        // behind for the next mark on the SHARED Graphics to start from - which
        // here would be the next bug's shadow, as a beam across the board. The
        // rule and its history are in compassRing.ts; a test enforces it.
        const spin = now / 900;
        const rr = r * 1.9;
        const STEPS = 7;
        for (let i = 0; i < 4; i++) {
          const a0 = spin + (i / 4) * Math.PI * 2;
          const span = 0.9;
          this.bodies.moveTo(c.x + Math.cos(a0) * rr, c.y + Math.sin(a0) * rr);
          for (let k = 1; k <= STEPS; k++) {
            const a = a0 + (span * k) / STEPS;
            this.bodies.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
          }
          this.bodies.stroke({ width: Math.max(1, scale * 1.2), color, alpha: 0.75 * fade });
        }
      }
    }
  }

  private drawChestLoot(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    for (const g of game.chestLoot ?? []) {
      const c = w2s(g.x, g.y);
      const r = Math.max(3, 8 * scale);
      const cast = shadowFor(light, c.x, c.y, slabHeight(scale) * 0.6);
      this.shadows
        .ellipse(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r, r * 0.6)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * 0.8 });
      this.glows.circle(c.x, c.y, r * 2).fill({ color: PALETTE.amber, alpha: 0.14 });
      this.bodies.circle(c.x, c.y, r).fill({ color: PALETTE.amber, alpha: 0.95 });
      this.bodies.circle(c.x, c.y, r).stroke({ width: 1, color: 0xffe9b0, alpha: 0.9 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

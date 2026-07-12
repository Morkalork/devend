/**
 * Pixi ball layer — ports renderFrame's per-ball stack (section S).
 *
 * Per ball, child order mirrors the 2D draw order: pulse glow + hit halos,
 * motion trail, flame plume, then the body sprites (base, sphere shading, hex
 * overlay, specular) wrapped in a squash-and-stretch rig, then frost and the
 * fastest-ball ring. Body sprites reuse the SAME OffscreenCanvas bakes as the
 * 2D renderer (ballRenderCache / ballSphereCache) via textureFor().
 */
import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { CanvasGameState } from "@/types/gameState";
import { getBallBase, getBallSpecular, getHexOverlay } from "@/lib/ballRenderCache";
import { getBallSphere } from "@/lib/ballSphereCache";
import {
  getBaselinePulse,
  getWallHitEffect,
  getBallHitEffect,
  getSquishEffect,
} from "@/lib/ballEffects";
import { COLORS, FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";
import { glowTexture, textureFor, hashStr, mulberry } from "./textures";

const FLAME_SHEAR_SPEED = 380;
const FLAME_LIFE_MS = 620;
const MAX_TONGUES = 12;
const TRAIL_LEN = 8;

/** Per-colour flame palette: near-white hot core, ball colour mid, dark tip. */
const _palettes = new Map<string, [number, number, number]>();
function flamePalette(hex: string): [number, number, number] {
  let p = _palettes.get(hex);
  if (!p) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    const toward = (c: number, t: number) => Math.round(c + (255 - c) * t);
    const rgb = (rr: number, gg: number, bb: number) => (rr << 16) | (gg << 8) | bb;
    p = [
      rgb(toward(r, 0.75), toward(g, 0.75), toward(b, 0.75)),
      rgb(toward(r, 0.15), toward(g, 0.15), toward(b, 0.15)),
      rgb(Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)),
    ];
    _palettes.set(hex, p);
  }
  return p;
}

interface BallView {
  root: Container;
  pulse: Sprite;
  halos: Graphics;
  trail: Graphics;
  flame: Sprite[];
  // Squish rig: outer rotates to the impact axis, mid scales, inner rotates back.
  squishOuter: Container;
  squishMid: Container;
  squishInner: Container;
  base: Sprite;
  sphere: Sprite;
  hex: Sprite;
  hexMask: Graphics;
  specular: Sprite;
  frost: Graphics;
  ring: Graphics;
  label: Text | null;
}

export class BallLayer {
  readonly container = new Container();
  private views = new Map<string, BallView>();

  private createView(): BallView {
    const root = new Container();
    const pulse = new Sprite(glowTexture("pulse"));
    pulse.anchor.set(0.5);
    pulse.blendMode = "add";
    const halos = new Graphics();
    halos.blendMode = "add";
    const trail = new Graphics();
    trail.blendMode = "add";
    const flame: Sprite[] = [];
    for (let i = 0; i < MAX_TONGUES; i++) {
      const s = new Sprite(glowTexture("soft"));
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.visible = false;
      flame.push(s);
    }
    const squishOuter = new Container();
    const squishMid = new Container();
    const squishInner = new Container();
    squishOuter.addChild(squishMid);
    squishMid.addChild(squishInner);
    const base = new Sprite();
    base.anchor.set(0.5);
    const sphere = new Sprite();
    sphere.anchor.set(0.5);
    const hex = new Sprite();
    hex.anchor.set(0.5);
    // 'overlay' needs the advanced-blend import + backbuffer; additive at low
    // alpha reads close enough for the faint circuit texture (Stage A).
    hex.blendMode = "add";
    hex.alpha = 0.14;
    const hexMask = new Graphics();
    hex.mask = hexMask;
    const specular = new Sprite();
    specular.anchor.set(0.5);
    const frost = new Graphics();
    const ring = new Graphics();
    squishInner.addChild(base, sphere, hex, hexMask, specular);
    root.addChild(ring, pulse, halos, trail, ...flame, squishOuter, frost);
    return {
      root, pulse, halos, trail, flame,
      squishOuter, squishMid, squishInner,
      base, sphere, hex, hexMask, specular, frost,
      ring, label: null,
    };
  }

  sync(
    game: CanvasGameState,
    accentColor: string,
    scale: number,
    w2s: (x: number, y: number) => { x: number; y: number },
    flameTongues: number,
    showBallSpeeds: boolean,
    now: number,
  ): void {
    const seen = new Set<string>();

    for (const ball of game.balls) {
      const assimScale = ball.assimScale ?? 1;
      if (assimScale <= 0) continue;
      seen.add(ball.id);

      let v = this.views.get(ball.id);
      if (!v) {
        v = this.createView();
        this.views.set(ball.id, v);
        this.container.addChild(v.root);
      }

      const pos = ball.renderPosition ?? ball.position;
      const sp = w2s(pos.x, pos.y);
      const screenRadius = ball.radius * scale;
      v.root.position.set(sp.x, sp.y);
      v.root.alpha = assimScale;

      // ── Colour fade toward accent during the lock fade (bucketed like 2D) ──
      const fadeRaw = ball.assimColorFade ?? 0;
      const fade = fadeRaw > 0 ? Math.round(fadeRaw * 12) / 12 : 0;
      let blendedHex: string;
      if (fade === 0) {
        blendedHex = ball.color.slice(1);
      } else {
        const r0 = parseInt(ball.color.slice(1, 3), 16);
        const g0 = parseInt(ball.color.slice(3, 5), 16);
        const b0 = parseInt(ball.color.slice(5, 7), 16);
        const ar = parseInt(accentColor.slice(1, 3), 16);
        const ag = parseInt(accentColor.slice(3, 5), 16);
        const ab = parseInt(accentColor.slice(5, 7), 16);
        const r = Math.round(r0 + (ar - r0) * fade);
        const g = Math.round(g0 + (ag - g0) * fade);
        const b = Math.round(b0 + (ab - b0) * fade);
        blendedHex = `${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      }

      // ── Baseline pulse glow ──
      const pulse = getBaselinePulse(ball.effects);
      const pulseR = screenRadius * 1.08 + 12 * scale;
      v.pulse.tint = accentColor;
      v.pulse.alpha = pulse.glowAlpha;
      v.pulse.width = v.pulse.height = pulseR * 2;

      // ── Collision halos ──
      v.halos.clear();
      const wallHit = getWallHitEffect(ball.effects);
      if (wallHit.active) {
        const haloR = screenRadius * wallHit.ringRadius;
        v.halos
          .circle(0, 0, haloR)
          .fill({ color: accentColor, alpha: wallHit.glowAlpha * 0.28 })
          .circle(0, 0, haloR * 0.85)
          .stroke({ width: Math.max(2, 4 * scale * wallHit.intensity), color: accentColor, alpha: wallHit.glowAlpha * 0.5 });
      }
      const ballHit = getBallHitEffect(ball.effects, now);
      if (ballHit.active) {
        const haloR = screenRadius * ballHit.ringRadius;
        v.halos
          .circle(0, 0, haloR)
          .fill({ color: accentColor, alpha: ballHit.glowAlpha * 0.3 })
          .circle(0, 0, screenRadius * 1.2)
          .stroke({ width: 5 * scale * ballHit.intensity, color: 0xffffff, alpha: ballHit.intensity * 0.85 })
          .circle(0, 0, haloR * 0.8)
          .stroke({ width: Math.max(2, 5 * scale * ballHit.intensity), color: accentColor, alpha: ballHit.glowAlpha * 0.6 });
        if (ballHit.secondaryPulse > 0) {
          v.halos
            .circle(0, 0, screenRadius * (2.0 + ballHit.secondaryPulse * 1.5))
            .stroke({ width: 3 * scale, color: accentColor, alpha: ballHit.secondaryPulse * 0.7 });
        }
      }

      // ── Motion trail (same ring buffer + mutation contract as the 2D path) ──
      {
        let buf = ball.trailPositions;
        if (!buf || buf.length !== TRAIL_LEN) {
          buf = ball.trailPositions = Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0 }));
          ball.trailHead = 0;
          ball.trailCount = 0;
        }
        const slot = buf[ball.trailHead ?? 0];
        slot.x = pos.x;
        slot.y = pos.y;
        const head = ((ball.trailHead ?? 0) + 1) % TRAIL_LEN;
        ball.trailHead = head;
        const N = ball.trailCount = Math.min((ball.trailCount ?? 0) + 1, TRAIL_LEN);
        v.trail.clear();
        if (N > 1 && assimScale > 0.05) {
          for (let k = 0; k < N - 1; k++) {
            const fraction = (k + 1) / N;
            const idx = (head - N + k + TRAIL_LEN) % TRAIL_LEN;
            const tp = w2s(buf[idx].x, buf[idx].y);
            v.trail
              .circle(tp.x - sp.x, tp.y - sp.y, screenRadius * fraction * 0.5)
              .fill({ color: ball.color, alpha: fraction * 0.35 });
          }
        }
      }

      // ── Flame plume (stateless, seeded per ball like drawBallFlame) ──
      {
        const isFrozen = ball.frozenUntil !== undefined && now < ball.frozenUntil;
        const burning = ball.state === "active" && !isFrozen && screenRadius > 0.5;
        const palette = flamePalette(ball.color);
        const rng = mulberry(hashStr(`flame-${ball.id}`));
        const flameH = screenRadius * 4.8;
        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        const lean = speed > 0 ? Math.min(1, speed / FLAME_SHEAR_SPEED) : 0;
        const lx = speed > 0 ? -(ball.velocity.x / speed) * lean * 1.1 : 0;
        const ly = speed > 0 ? -(ball.velocity.y / speed) * lean * 0.35 : 0;
        for (let i = 0; i < MAX_TONGUES; i++) {
          const s = v.flame[i];
          const off = rng();
          const spd = 0.75 + rng() * 0.6;
          const lat = rng() - 0.5;
          if (!burning || i >= flameTongues) { s.visible = false; continue; }
          const ph = ((now / FLAME_LIFE_MS) * spd + off) % 1;
          const rise = (ph * 0.4 + ph * ph * 0.6) * flameH;
          const wob = Math.sin(now * 0.008 + off * 6.283 + rise * 0.04) * screenRadius * 0.5 * ph;
          const size = Math.max(0.5, screenRadius * (0.95 - 0.6 * ph) * (0.55 + off * 0.5));
          const a = (1 - ph) * 0.55;
          if (a <= 0.01) { s.visible = false; continue; }
          s.visible = true;
          s.position.set(lat * screenRadius * 0.7 + wob + lx * rise, -screenRadius * 0.2 - rise + ly * rise);
          s.width = s.height = size * 2;
          s.alpha = a;
          s.tint = ph < 0.35 ? palette[0] : ph < 0.65 ? palette[1] : palette[2];
        }
      }

      // ── Squash & stretch rig ──
      const squish = getSquishEffect(ball.effects);
      if (squish.active) {
        const ang = Math.atan2(squish.ny, squish.nx);
        v.squishOuter.rotation = ang;
        v.squishInner.rotation = -ang;
        v.squishMid.scale.set(squish.scaleAlong, squish.scalePerp);
      } else {
        v.squishOuter.rotation = 0;
        v.squishInner.rotation = 0;
        v.squishMid.scale.set(1, 1);
      }

      // ── Body sprites from the shared 2D bakes ──
      const ballIdHash = ball.id.charCodeAt(ball.id.length - 1) || 0;
      const baseBake = getBallBase(blendedHex, screenRadius, scale);
      v.base.texture = textureFor(baseBake.canvas);
      v.base.width = v.base.height = baseBake.halfSize * 2;
      const sphereBake = getBallSphere(screenRadius, scale, ball.rotation, ballIdHash);
      v.sphere.texture = textureFor(sphereBake.canvas);
      v.sphere.width = v.sphere.height = sphereBake.halfSize * 2;
      v.hex.texture = textureFor(getHexOverlay(accentColor));
      v.hex.width = v.hex.height = screenRadius * 2;
      v.hex.rotation = ball.rotation * 0.3;
      v.hexMask.clear().circle(0, 0, screenRadius).fill(0xffffff);
      const specBake = getBallSpecular(screenRadius, scale);
      v.specular.texture = textureFor(specBake);
      v.specular.width = v.specular.height = (screenRadius + 2) * 2;

      // ── Frost overlay for frozen balls ──
      v.frost.clear();
      if (ball.frozenUntil !== undefined && now < ball.frozenUntil) {
        const frost = 0xbfefff;
        v.frost
          .circle(0, 0, screenRadius)
          .fill({ color: frost, alpha: 0.22 })
          .circle(0, 0, screenRadius + 2 * scale)
          .stroke({ width: Math.max(1.5, 2 * scale), color: frost, alpha: 0.9 });
        const spikes = 6;
        for (let s = 0; s < spikes; s++) {
          const a = (s / spikes) * Math.PI * 2 + ball.rotation * 0.2;
          const r0 = screenRadius + 2 * scale;
          const r1 = screenRadius + 7 * scale;
          v.frost
            .moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
            .lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
            .stroke({ width: Math.max(1, 1.5 * scale), color: frost, alpha: 0.9 });
        }
        const durMs = ball.freezeReadyAt !== undefined
          ? (ball.freezeReadyAt - ball.frozenUntil) / FREEZE_COOLDOWN_MULTIPLIER
          : 0;
        if (durMs > 0) {
          const frac = Math.max(0, Math.min(1, (ball.frozenUntil - now) / durMs));
          v.frost
            .arc(0, 0, screenRadius + 5 * scale, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
            .stroke({ width: Math.max(2, 3 * scale), color: frost, alpha: 0.95 });
        }
      }

      // ── Fastest-ball highlight ring ──
      v.ring.clear();
      if (ball.id === game.fastestBallId) {
        v.ring
          .circle(0, 0, screenRadius + 15 * scale)
          .stroke({ width: 8 * scale, color: COLORS.fastestBallHighlight, alpha: 0.25 })
          .circle(0, 0, screenRadius + 15 * scale)
          .stroke({ width: 3 * scale, color: COLORS.fastestBallHighlight, alpha: 1 });
      }

      // ── Admin speed label ──
      if (showBallSpeeds && ball.state === "active") {
        if (!v.label) {
          v.label = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: Math.max(10, Math.round(11 * scale)),
              fill: 0xffffff,
              stroke: { color: 0x000000, width: 3 },
            }),
          });
          v.label.anchor.set(0.5, 1);
          v.root.addChild(v.label);
        }
        v.label.visible = true;
        v.label.text = String(Math.round(ball.speed));
        v.label.position.set(0, -screenRadius - 6 * scale);
      } else if (v.label) {
        v.label.visible = false;
      }
    }

    // Drop views for balls that no longer render.
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.root.destroy({ children: true });
        this.views.delete(id);
      }
    }
  }

  destroy(): void {
    for (const [, v] of this.views) v.root.destroy({ children: true });
    this.views.clear();
    this.container.destroy({ children: true });
  }
}

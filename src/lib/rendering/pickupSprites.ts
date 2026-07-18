/**
 * Baked pickup-token sprites, shared by both renderers (the 2D path blits the
 * OffscreenCanvas, the Pixi path wraps it via textureFor). One bake per
 * (effect, accent, pixel size) — cheap, tiny, and cleared with the other bake
 * caches on resize/teardown.
 *
 * A token reads as: soft glow halo → neon ring → dark core → effect glyph.
 */
import { PickupEffect, PickupFeedback } from "@/types/pickups";

/** Sprite canvas is this many times the token's on-screen radius (glow room). */
export const PICKUP_SPRITE_SCALE = 2.4;

const _cache = new Map<string, OffscreenCanvas>();

/** Per-effect ring/glyph colour (accent for the money-ish effects). */
export function pickupColor(effect: PickupEffect, accent: string): string {
  switch (effect) {
    case "freezeCharge":    return "#88ddff";
    case "fork":            return "#ffd93d";
    case "freeShopItem":    return "#ff9ff3";
    case "extraLife":       return "#ff6b6b";
    case "rainbowConvert":  return "#ff4db8";
    case "overtimePercent": return "#ffd54a";
    default:                 return accent;
  }
}

export function getPickupSprite(effect: PickupEffect, accent: string, radiusPx: number): OffscreenCanvas {
  const r = Math.max(6, Math.round(radiusPx));
  const key = `${effect}_${accent}_${r}`;
  let oc = _cache.get(key);
  if (oc) return oc;

  const half = Math.ceil(r * PICKUP_SPRITE_SCALE);
  oc = new OffscreenCanvas(half * 2, half * 2);
  const c = oc.getContext("2d")!;
  const col = pickupColor(effect, accent);
  const cx = half, cy = half;

  // Halo
  const glow = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, half);
  glow.addColorStop(0, hexA(col, 0.5));
  glow.addColorStop(0.55, hexA(col, 0.16));
  glow.addColorStop(1, hexA(col, 0));
  c.fillStyle = glow;
  c.fillRect(0, 0, half * 2, half * 2);

  // Dark core + neon ring
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = "rgba(8, 20, 14, 0.9)";
  c.fill();
  c.lineWidth = Math.max(1.5, r * 0.14);
  c.strokeStyle = col;
  c.stroke();

  // Glyph
  c.strokeStyle = "#ffffff";
  c.fillStyle = "#ffffff";
  c.lineWidth = Math.max(1.2, r * 0.13);
  c.lineCap = "round";
  c.lineJoin = "round";
  const g = r * 0.52; // glyph half-extent
  switch (effect) {
    case "overtime": {
      // "+h" — the overtime hours currency
      c.font = `bold ${Math.round(r * 1.05)}px 'JetBrains Mono', monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("+h", cx, cy + r * 0.06);
      break;
    }
    case "fork": {
      // Branching path: one stem splitting into two
      c.beginPath();
      c.moveTo(cx, cy + g);
      c.lineTo(cx, cy);
      c.moveTo(cx, cy);
      c.lineTo(cx - g * 0.8, cy - g);
      c.moveTo(cx, cy);
      c.lineTo(cx + g * 0.8, cy - g);
      c.stroke();
      c.beginPath(); c.arc(cx - g * 0.8, cy - g, r * 0.12, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(cx + g * 0.8, cy - g, r * 0.12, 0, Math.PI * 2); c.fill();
      break;
    }
    case "capRaise": {
      // Arrow pushing against a raised ceiling bar
      c.beginPath();
      c.moveTo(cx - g, cy - g);
      c.lineTo(cx + g, cy - g);
      c.moveTo(cx, cy + g);
      c.lineTo(cx, cy - g * 0.35);
      c.moveTo(cx - g * 0.55, cy + g * 0.15);
      c.lineTo(cx, cy - g * 0.35);
      c.lineTo(cx + g * 0.55, cy + g * 0.15);
      c.stroke();
      break;
    }
    case "freezeCharge": {
      // Six-spoke snowflake
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * g, cy + Math.sin(a) * g);
      }
      c.stroke();
      break;
    }
    case "freeShopItem": {
      // Price tag, tilted: a pentagon-ish tag outline with a punched hole.
      c.save();
      c.translate(cx, cy);
      c.rotate(-Math.PI / 6);
      c.beginPath();
      c.moveTo(-g, -g * 0.55);
      c.lineTo(g * 0.25, -g * 0.55);
      c.lineTo(g, 0);
      c.lineTo(g * 0.25, g * 0.55);
      c.lineTo(-g, g * 0.55);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.arc(-g * 0.55, 0, r * 0.12, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      break;
    }
    case "extraLife": {
      // A heart: two lobes into a point.
      c.beginPath();
      c.moveTo(cx, cy + g * 0.9);
      c.bezierCurveTo(cx - g * 1.2, cy - g * 0.2, cx - g * 0.4, cy - g, cx, cy - g * 0.3);
      c.bezierCurveTo(cx + g * 0.4, cy - g, cx + g * 1.2, cy - g * 0.2, cx, cy + g * 0.9);
      c.closePath();
      c.fill();
      break;
    }
    case "overtimePercent": {
      // A percent sign.
      c.font = `bold ${Math.round(r * 1.05)}px 'JetBrains Mono', monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("%", cx, cy + r * 0.06);
      break;
    }
    case "rainbowConvert": {
      // A four-point sparkle/star.
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
        const nx = Math.cos(a), ny = Math.sin(a);
        c.moveTo(cx, cy);
        c.lineTo(cx + nx * g, cy + ny * g);
      }
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      c.fill();
      break;
    }
  }

  _cache.set(key, oc);
  return oc;
}

export function clearPickupSpriteCache(): void {
  _cache.clear();
}

/**
 * The claim-feedback label for a token. Overtime is language-neutral ("+Nh");
 * the rest come pre-translated via rctx (capRaise carries a `{n}` slot).
 */
export function pickupFeedbackLabel(
  fb: PickupFeedback,
  labels?: { fork?: string; capRaise?: string; freezeCharge?: string; freeShopItem?: string; extraLife?: string; rainbowConvert?: string },
): string {
  switch (fb.effect) {
    case "overtime":       return `+${fb.value}h`;
    case "capRaise":       return (labels?.capRaise ?? "Cap +{n}h").replace("{n}", String(fb.value));
    case "freezeCharge":   return labels?.freezeCharge ?? "Freeze +1";
    case "fork":           return labels?.fork ?? "Ball split!";
    case "freeShopItem":   return labels?.freeShopItem ?? "Free store item!";
    case "extraLife":      return labels?.extraLife ?? "+1 Life";
    case "rainbowConvert": return labels?.rainbowConvert ?? "Rainbow ball!";
    // overtimePercent resolves to an "overtime" feedback at claim time; this
    // arm only exists for exhaustiveness.
    case "overtimePercent": return `+${fb.value}h`;
  }
}

function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

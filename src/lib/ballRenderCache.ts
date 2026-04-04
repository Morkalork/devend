/**
 * Ball Render Cache
 *
 * Pre-renders static ball layers (outer glow + 3D base gradient, specular glare)
 * onto OffscreenCanvases so the render loop can blit them with a single drawImage
 * call instead of creating 4 CanvasGradient objects per ball per frame.
 *
 * Cache keys:
 *   ballBaseCache  — `${blendedHex}:${Math.round(screenRadius)}`  (colour + size)
 *   ballSpecularCache — `${Math.round(screenRadius)}`             (size only; pure white)
 *
 * The cache is invalidated (cleared) on window resize, when `screenRadius` changes
 * because `scale` changes.  During normal gameplay both colour and size are fixed so
 * the cache is effectively build-once per ball.
 */

interface BallBaseEntry {
  canvas: OffscreenCanvas;
  /** Distance from ball centre to top-left corner of the OffscreenCanvas */
  halfSize: number;
}

const ballBaseCache = new Map<string, BallBaseEntry>();
const ballSpecularCache = new Map<string, OffscreenCanvas>();

/** Return (creating if needed) an OffscreenCanvas with the outer glow and 3D sphere
 *  base gradient centred at its midpoint. */
export function getBallBase(
  blendedHex: string, // 6-char hex WITHOUT '#',  e.g. "ff4400"
  screenRadius: number,
  scale: number,
): BallBaseEntry {
  const key = `${blendedHex}:${Math.round(screenRadius)}`;
  const existing = ballBaseCache.get(key);
  if (existing) return existing;

  const r = parseInt(blendedHex.substring(0, 2), 16);
  const g = parseInt(blendedHex.substring(2, 4), 16);
  const b = parseInt(blendedHex.substring(4, 6), 16);

  const blendedColor = `rgb(${r},${g},${b})`;
  const lighterColor = `rgb(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)})`;
  const darkerColor  = `rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)})`;
  const darkestColor = `rgb(${Math.max(0, r - 100)},${Math.max(0, g - 100)},${Math.max(0, b - 100)})`;

  // Canvas must contain: outer glow (R + 10s) + shadow bloom (~20s) + a few px margin
  const halfSize = Math.ceil(screenRadius + 28 * scale) + 4;
  const size = halfSize * 2;
  const cx = halfSize;
  const cy = halfSize;

  const oc = new OffscreenCanvas(size, size);
  const ctx = oc.getContext("2d")!;

  // ── Outer glow (ambient light halo) ──────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, screenRadius + 10 * scale, 0, Math.PI * 2);
  const outerGlow = ctx.createRadialGradient(
    cx, cy, screenRadius * 0.7,
    cx, cy, screenRadius + 10 * scale,
  );
  outerGlow.addColorStop(0,   `rgba(${r},${g},${b},0.4)`);
  outerGlow.addColorStop(0.6, `rgba(${r},${g},${b},0.15)`);
  outerGlow.addColorStop(1,   "transparent");
  ctx.fillStyle = outerGlow;
  ctx.fill();

  // ── Ball base sphere gradient (3-D depth illusion) ────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, screenRadius, 0, Math.PI * 2);
  const baseGrad = ctx.createRadialGradient(
    cx - screenRadius * 0.3, cy - screenRadius * 0.3, 0,
    cx + screenRadius * 0.15, cy + screenRadius * 0.15, screenRadius * 1.3,
  );
  baseGrad.addColorStop(0,    lighterColor);
  baseGrad.addColorStop(0.35, blendedColor);
  baseGrad.addColorStop(0.75, darkerColor);
  baseGrad.addColorStop(1,    darkestColor);
  ctx.fillStyle   = baseGrad;
  ctx.shadowColor = blendedColor;
  ctx.shadowBlur  = 15 * scale;
  ctx.fill();
  ctx.restore();

  const entry: BallBaseEntry = { canvas: oc, halfSize };
  ballBaseCache.set(key, entry);
  return entry;
}

/** Return (creating if needed) an OffscreenCanvas with the specular glare overlay.
 *  Colour-independent (pure white), keyed by radius only. */
export function getBallSpecular(screenRadius: number, scale: number): OffscreenCanvas {
  const key = `${Math.round(screenRadius)}`;
  const existing = ballSpecularCache.get(key);
  if (existing) return existing;

  const R   = screenRadius;
  const dim = Math.ceil(R * 2) + 4; // +4 for sub-pixel safety
  const cx  = dim / 2;
  const cy  = dim / 2;

  const oc  = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext("2d")!;

  // Clip to ball circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Primary highlight (top-left)
  const glareGrad = ctx.createRadialGradient(
    cx - R * 0.4, cy - R * 0.4, 0,
    cx - R * 0.4, cy - R * 0.4, R * 0.6,
  );
  glareGrad.addColorStop(0,    "rgba(255,255,255,0.65)");
  glareGrad.addColorStop(0.25, "rgba(255,255,255,0.3)");
  glareGrad.addColorStop(0.6,  "rgba(255,255,255,0.05)");
  glareGrad.addColorStop(1,    "transparent");
  ctx.fillStyle = glareGrad;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Sharp specular dot
  ctx.beginPath();
  ctx.arc(cx - R * 0.35, cy - R * 0.35, R * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();

  // Rim light (bottom-right)
  const rimGrad = ctx.createRadialGradient(
    cx + R * 0.35, cy + R * 0.45, 0,
    cx + R * 0.35, cy + R * 0.45, R * 0.35,
  );
  rimGrad.addColorStop(0, "rgba(255,255,255,0.2)");
  rimGrad.addColorStop(1, "transparent");
  ctx.fillStyle = rimGrad;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  ctx.restore();

  const canvas = oc;
  ballSpecularCache.set(key, canvas);
  return canvas;
}

/** Drop all cached surfaces — call on window resize (scale changes). */
export function clearBallRenderCache(): void {
  ballBaseCache.clear();
  ballSpecularCache.clear();
  hexOverlayCache.clear();
}

// ── Circuit-board hex overlay ─────────────────────────────────────────────

const hexOverlayCache = new Map<string, OffscreenCanvas>();

/** Return (creating if needed) an OffscreenCanvas with a tileable circuit-board
 *  hex pattern drawn in `color`. Caller controls opacity via globalAlpha. */
export function getHexOverlay(color: string): OffscreenCanvas {
  if (hexOverlayCache.has(color)) return hexOverlayCache.get(color)!;
  const SIZE = 128;
  const oc = new OffscreenCanvas(SIZE, SIZE);
  const hCtx = oc.getContext('2d')!;
  const R = 10;
  const s3 = Math.sqrt(3);
  hCtx.strokeStyle = color;
  hCtx.lineWidth = 0.7;
  hCtx.globalAlpha = 1;
  hCtx.lineCap = 'round';
  for (let col = -1; col <= Math.ceil(SIZE / (R * 1.5)) + 1; col++) {
    for (let row = -1; row <= Math.ceil(SIZE / (R * s3)) + 1; row++) {
      const cx = col * 1.5 * R;
      const cy = row * R * s3 + (col % 2 === 0 ? 0 : R * s3 / 2);
      hCtx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = cx + R * Math.cos(a);
        const py = cy + R * Math.sin(a);
        if (i === 0) hCtx.moveTo(px, py); else hCtx.lineTo(px, py);
      }
      hCtx.closePath();
      hCtx.stroke();
    }
  }
  hexOverlayCache.set(color, oc);
  return oc;
}

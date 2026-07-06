/**
 * Ball Sphere Shading Cache (perf prototype)
 *
 * The animated "sphere" shading on each ball (latitude bands, longitude
 * meridians, equatorial band, polar caps) was the one hot path in the renderer
 * drawn LIVE every frame for every ball: a clip plus ~18 ellipse/arc path ops
 * per ball, scaling linearly with ball count. That was the dominant per-frame
 * render cost as the board filled up.
 *
 * These layers are a pure function of the ball's rotation (plus a per-ball hash
 * that de-correlates the band phases between balls). So we bucket the rotation
 * into a fixed number of steps and pre-render the whole shading stack to an
 * OffscreenCanvas once per (radius, hash, rotation-bucket) — then the render
 * loop blits it with a single drawImage. ~18 path ops + a clip collapse to one
 * blit. 32 buckets is visually indistinguishable from continuous rotation.
 *
 * The layers are pure black-on-transparent (colour-independent), so colour is
 * NOT part of the key. The circuit-board hex overlay (layer 5) is intentionally
 * NOT baked here: it uses an 'overlay' composite that must blend against the
 * coloured base disc beneath it, so it stays live in renderFrame.
 *
 * Cache key: `${round(screenRadius)}|${hash}|${rotBucket}`
 * Invalidated (cleared) on resize/teardown, same as the sibling ball caches.
 */

interface BallSphereEntry {
  canvas: OffscreenCanvas;
  /** Distance from ball centre to the sprite's top-left corner. */
  halfSize: number;
}

const ROT_BUCKETS = 32;
const TWO_PI = Math.PI * 2;

const ballSphereCache = new Map<string, BallSphereEntry>();

/**
 * Return (building if needed) the pre-rendered sphere-shading sprite for a ball
 * at the given radius/rotation. `hash` is the ball's id hash (charCodeAt of its
 * last id char), matching the phase de-correlation used by the live renderer.
 */
export function getBallSphere(
  screenRadius: number,
  scale: number,
  rotation: number,
  hash: number,
): BallSphereEntry {
  // Quantise rotation to a bucket, then rebuild the exact phase inputs from the
  // bucket centre so every ball at this bucket shares one sprite.
  const norm = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
  const bucket = Math.round(norm / TWO_PI * ROT_BUCKETS) % ROT_BUCKETS;
  const rBucket = Math.round(screenRadius);
  const key = `${rBucket}|${hash}|${bucket}`;
  const existing = ballSphereCache.get(key);
  if (existing) return existing;

  const rot = (bucket / ROT_BUCKETS) * TWO_PI;
  const primaryPhase = rot;
  const secondaryPhase = rot * 0.7 + hash * 0.5;
  const tertiaryPhase = rot * 1.3 + hash * 0.3;

  const halfSize = Math.ceil(screenRadius) + 2;
  const size = halfSize * 2;
  const C = halfSize;

  const oc = new OffscreenCanvas(Math.max(1, size), Math.max(1, size));
  const ctx = oc.getContext("2d")!;

  // Clip everything to the ball circle (matches the live renderer's clip).
  ctx.beginPath();
  ctx.arc(C, C, screenRadius, 0, TWO_PI);
  ctx.clip();

  // Layer 1: Latitude bands
  ctx.save();
  ctx.translate(C, C);
  const tiltAngle = Math.sin(secondaryPhase) * 0.4;
  ctx.rotate(tiltAngle);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 1.8 * scale;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const baseY = i * screenRadius * 0.35;
    const compression = 0.6 + 0.4 * Math.cos(primaryPhase + i * 0.3);
    const yOffset = baseY * compression;
    if (Math.abs(yOffset) < screenRadius * 0.95) {
      const xExtent = Math.sqrt(Math.max(0, screenRadius * screenRadius - yOffset * yOffset));
      ctx.beginPath();
      ctx.ellipse(0, yOffset, xExtent, screenRadius * 0.08, 0, 0, TWO_PI);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Layer 2: Longitude meridians
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate(primaryPhase);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 2 * scale;
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const xOffset = Math.sin(angle) * screenRadius * 0.9;
    const foreShorten = Math.abs(Math.cos(angle));
    if (foreShorten > 0.15) {
      ctx.beginPath();
      ctx.ellipse(xOffset * 0.5, 0, Math.max(1, screenRadius * 0.15 * foreShorten), screenRadius * 0.85, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Layer 3: Equatorial band
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate(tertiaryPhase);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(-screenRadius, 0);
  ctx.lineTo(screenRadius, 0);
  ctx.stroke();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  const segmentCount = 8;
  for (let i = 0; i < segmentCount; i++) {
    const segAngle = (i / segmentCount) * Math.PI * 2;
    const xPos = Math.cos(segAngle) * screenRadius * 0.65;
    const yPos = Math.sin(segAngle) * screenRadius * 0.15;
    const visibility = Math.cos(segAngle);
    if (visibility > -0.3) {
      const segSize = (2.5 + visibility * 1.5) * scale;
      ctx.beginPath();
      ctx.arc(xPos, yPos, segSize, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.restore();

  // Layer 4: Polar caps
  ctx.save();
  ctx.translate(C, C);
  const tiltX = Math.sin(secondaryPhase) * screenRadius * 0.1;
  const tiltY = Math.cos(secondaryPhase) * screenRadius * 0.1;
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.beginPath();
  ctx.ellipse(tiltX, -screenRadius * 0.7 + tiltY, screenRadius * 0.35, screenRadius * 0.15, secondaryPhase * 0.3, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-tiltX, screenRadius * 0.7 - tiltY, screenRadius * 0.35, screenRadius * 0.15, -secondaryPhase * 0.3, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  const entry: BallSphereEntry = { canvas: oc, halfSize };
  ballSphereCache.set(key, entry);
  return entry;
}

/** Drop all cached sphere sprites — call on resize (scale change) and teardown. */
export function clearBallSphereCache(): void {
  ballSphereCache.clear();
}

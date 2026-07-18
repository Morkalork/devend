/**
 * Rainbow ball colour — a hue that cycles over time, shared by both renderers.
 *
 * The hue is QUANTIZED to HUE_STEPS buckets. Both renderers bake a cached
 * canvas per colour key (ballRenderCache); a smoothly-varying hue would spawn a
 * fresh canvas every frame and leak memory, so bucketing caps the rainbow at
 * HUE_STEPS cache entries while still looking like a smooth cycle. A per-ball
 * phase (hashed from the id) desyncs multiple rainbow balls.
 */
const CYCLE_MS = 3200;
const HUE_STEPS = 30;
const HUE_QUANTUM = 360 / HUE_STEPS;

function phaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(id.length - 1 - i)) >>> 0;
  return h % 360;
}

/** HSL (h 0-360, s/l 0-1) to `#rrggbb`. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The current (bucketed) rainbow colour for a ball, as `#rrggbb`. Pass the
 * frame's timestamp so every use within a frame agrees.
 */
export function rainbowBaseColor(id: string, nowMs: number): string {
  const raw = ((nowMs / CYCLE_MS) * 360 + phaseFor(id)) % 360;
  const stepped = Math.floor(raw / HUE_QUANTUM) * HUE_QUANTUM;
  return hslToHex(stepped, 0.9, 0.6);
}

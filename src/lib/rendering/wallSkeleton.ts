/**
 * wallSkeleton — the circuit "skeleton" drawn inside every wall/line.
 *
 * Each fence and board-edge line is a thin neon bar. To make the board read
 * less artificial and more alive, a faint PCB-style circuit runs the length of
 * the bar (a jogging trace with right-angle bends, solder vias, and short
 * branch stubs) beneath a slightly-translucent core, so the circuitry shows
 * *through* the wall.
 *
 * The geometry is PURE and DETERMINISTIC: it depends only on a segment's screen
 * endpoints, the render scale, the wall thickness, and a seed derived from the
 * wall's world coordinates. That makes it stable frame-to-frame (a wall's
 * circuit never shimmers or reshuffles) and lets BOTH renderers (Canvas2D
 * `renderWallWithEffects` and the Pixi `strokeWall`) consume the same shapes.
 *
 * Output is in SCREEN space. Walls are straight segments, so screen mapping is
 * affine and the whole skeleton can be laid out from the segment's screen
 * endpoints + scale without a world→screen matrix.
 */

// ── Master toggle + tunables ────────────────────────────────────────────────
export const WALL_CIRCUITS_ENABLED = true;

// Render-only line-thickening. The physics `thickness` (ball collisions, seal
// gaps, cut rasterization) is left untouched; only the DRAWN wall body + its
// circuit are scaled up, giving the skeleton room to read. 1 = no change.
export const WALL_RENDER_THICKEN = 1.6;

// Segments shorter than this (screen px) get no circuit — too small to read.
const MIN_SEGMENT_PX = 46;
// Spacing between circuit features along the wall (world units).
const NODE_SPACING_WORLD = 17;
// Lateral offset of one "lane" as a fraction of wall thickness. The trace
// staircases between lanes {-1,0,1}; branch stubs reach ~1.6 lanes. At 0.26,
// 1.6 lanes = ~0.42·thickness, comfortably inside the band's half-width.
const LANE_FRAC = 0.26;
// Node radii as a fraction of thickness (world units).
const VIA_R_FRAC = 0.26;
const PAD_R_FRAC = 0.2;
// Probability a node sprouts a perpendicular branch stub.
const BRANCH_PROB = 0.45;
// Translucency of the wall body so the circuit reads through it. The white core
// AND the accent centerline are both dimmed — otherwise the opaque centerline
// hides the traces. 1 = opaque (old look), lower = more see-through.
export const WALL_CORE_ALPHA = 0.6;
export const WALL_CENTERLINE_ALPHA = 0.64;

// ── Deterministic RNG (mulberry32) ──────────────────────────────────────────
function hashCoords(a: number, b: number, c: number, d: number): number {
  let h = 0x811c9dc5;
  for (const v of [a, b, c, d]) {
    h ^= v & 0xffff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xffff; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Geometry types ──────────────────────────────────────────────────────────
export interface SkeletonNode {
  x: number; y: number; r: number;
  kind: 'via' | 'pad';
}
export interface WallSkeleton {
  /** Flat screen-space polylines: [x0,y0,x1,y1,...]. First entry = main trace. */
  traces: number[][];
  nodes: SkeletonNode[];
}

// ── Geometry cache (walls are static; avoid per-frame allocation) ───────────
const _cache = new Map<string, WallSkeleton | null>();
const CACHE_CAP = 4096;

export function clearWallSkeletonCache(): void {
  _cache.clear();
}

/**
 * Build (or fetch cached) circuit geometry for one wall SEGMENT.
 *
 * @param sx,sy,ex,ey  segment endpoints in SCREEN px
 * @param scale        world→screen scale (boardRect.scale)
 * @param thickness    wall thickness in WORLD units (baseWidthPx / scale)
 * @param seedX..seedY the segment's WORLD endpoints, used only to seed the RNG
 * @returns geometry, or null if the segment is too short to carry a circuit
 */
export function buildWallSkeleton(
  sx: number, sy: number, ex: number, ey: number,
  scale: number, thickness: number,
  seedX0: number, seedY0: number, seedX1: number, seedY1: number,
): WallSkeleton | null {
  const key = `${Math.round(sx)}_${Math.round(sy)}_${Math.round(ex)}_${Math.round(ey)}_${Math.round(scale * 100)}`;
  const cached = _cache.get(key);
  if (cached !== undefined) return cached;

  const geom = compute(sx, sy, ex, ey, scale, thickness, seedX0, seedY0, seedX1, seedY1);
  if (_cache.size > CACHE_CAP) _cache.clear();
  _cache.set(key, geom);
  return geom;
}

function compute(
  sx: number, sy: number, ex: number, ey: number,
  scale: number, thickness: number,
  seedX0: number, seedY0: number, seedX1: number, seedY1: number,
): WallSkeleton | null {
  const dx = ex - sx, dy = ey - sy;
  const lenPx = Math.hypot(dx, dy);
  if (lenPx < MIN_SEGMENT_PX || scale <= 0 || thickness <= 0) return null;

  const ux = dx / lenPx, uy = dy / lenPx;   // unit tangent (screen)
  const nx = -uy, ny = ux;                    // unit normal (screen)
  const lenWorld = lenPx / scale;

  const marginWorld = Math.min(thickness * 1.4, lenWorld * 0.18);
  const usableWorld = lenWorld - 2 * marginWorld;
  if (usableWorld <= NODE_SPACING_WORLD * 0.6) return null;

  const nSeg = Math.max(1, Math.round(usableWorld / NODE_SPACING_WORLD));
  const stepWorld = usableWorld / nSeg;
  const laneOffWorld = thickness * LANE_FRAC;

  const rng = mulberry(hashCoords(
    Math.round(seedX0 * 8), Math.round(seedY0 * 8),
    Math.round(seedX1 * 8), Math.round(seedY1 * 8),
  ));

  // (distanceAlong world, lane units) → screen point
  const toScreen = (dWorld: number, lane: number): [number, number] => {
    const along = dWorld * scale;
    const lat = lane * laneOffWorld * scale;
    return [sx + ux * along + nx * lat, sy + uy * along + ny * lat];
  };

  const viaR = Math.max(1.1, VIA_R_FRAC * thickness * scale);
  const padR = Math.max(0.9, PAD_R_FRAC * thickness * scale);

  // Lane per node: ends pinned to centre; interior toggles centre<->side so the
  // trace reads as a staircasing PCB run rather than a straight wire.
  const lanes: number[] = [];
  let prevLane = 0;
  for (let i = 0; i <= nSeg; i++) {
    if (i === 0 || i === nSeg) { lanes.push(0); prevLane = 0; continue; }
    let lane = prevLane;
    if (rng() < 0.62) lane = prevLane === 0 ? (rng() < 0.5 ? -1 : 1) : 0;
    lanes.push(lane); prevLane = lane;
  }

  const traces: number[][] = [];
  const nodes: SkeletonNode[] = [];

  const main: number[] = [];
  prevLane = lanes[0];
  const [px, py] = toScreen(marginWorld, prevLane);
  main.push(px, py);

  for (let i = 1; i <= nSeg; i++) {
    const dWorld = marginWorld + i * stepWorld;
    const lane = lanes[i];
    if (lane !== prevLane) {
      // Right-angle corner: run to this distance at the old lane, then jog across.
      const [cx, cy] = toScreen(dWorld, prevLane);
      main.push(cx, cy);
      nodes.push({ x: cx, y: cy, r: viaR, kind: 'via' });
    }
    const [nxp, nyp] = toScreen(dWorld, lane);
    main.push(nxp, nyp);
    if (i < nSeg) nodes.push({ x: nxp, y: nyp, r: viaR, kind: 'via' });

    // Perpendicular branch stub ending in a pad, reaching toward the band edge.
    if (i > 0 && i < nSeg && rng() < BRANCH_PROB) {
      const side = lane === 0 ? (rng() < 0.5 ? 1 : -1) : -Math.sign(lane);
      const [bx, by] = toScreen(dWorld, lane + side * 1.6);
      traces.push([nxp, nyp, bx, by]);
      nodes.push({ x: bx, y: by, r: padR, kind: 'pad' });
    }
    prevLane = lane;
  }

  traces.unshift(main);
  return { traces, nodes };
}

// ── Colours ─────────────────────────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}
const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
function mixHex(hex: string, tr: number, tg: number, tb: number, t: number): string {
  const [r, g, b] = parseHex(hex);
  return `#${to2(r + (tr - r) * t)}${to2(g + (tg - g) * t)}${to2(b + (tb - b) * t)}`;
}

export interface CircuitPalette {
  trace: string;   // dark etched vein (high contrast on the translucent wall)
  traceAlpha: number;
  traceWidthFrac: number; // trace line width as a fraction of wall thickness
  via: string;     // dark solder ring for definition
  viaAlpha: number;
  spark: string;   // bright glowing via centre (drawn additively where possible)
  sparkAlpha: number;
}

/** Circuit colours derived from the level accent, cached per accent. */
const _paletteCache = new Map<string, CircuitPalette>();
export function circuitPalette(accentHex: string): CircuitPalette {
  const cached = _paletteCache.get(accentHex);
  if (cached) return cached;
  const p: CircuitPalette = {
    trace: mixHex(accentHex, 0, 0, 0, 0.62),       // deep etched groove
    traceAlpha: 0.72,
    traceWidthFrac: 0.2,
    via: mixHex(accentHex, 0, 0, 0, 0.6),          // dark solder ring
    viaAlpha: 0.85,
    spark: mixHex(accentHex, 255, 255, 255, 0.85), // near-white glowing centre
    sparkAlpha: 1,
  };
  _paletteCache.set(accentHex, p);
  return p;
}

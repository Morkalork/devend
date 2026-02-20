// Assimilation animation: tentacles emerge from the region boundary walls and constrict a captured ball
import { Vector2 } from './polygon';
import { BoardRect } from './boardConstants';

interface Tentacle {
  // Fence trace segment (straight, follows fence direction)
  fenceStartX: number;
  fenceStartY: number;
  fenceEndX: number;    // where the tentacle leaves the fence and curves inward
  fenceEndY: number;
  fenceDirX: number;    // normalized fence direction (for the straight segment)
  fenceDirY: number;
  fenceLen: number;     // world units of fence tracing (target ~5)
  // Bezier from fenceEnd to ball anchor
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  anchorAngle: number;  // Angle on ball perimeter where tentacle arrives
  progress: number;     // 0→1 growth (covers fence trace + bezier together)
  baseWidth: number;
  wobblePhase: number;
  wobbleSpeed: number;
  spawnDelay: number;   // ms after startTime before this tentacle begins emerging
}

export interface AssimilationState {
  ballId: string;
  startTime: number;
  delayMs: number;
  tentacles: Tentacle[];
  phase: 'waiting' | 'emerging' | 'constricting' | 'assimilated';
  ballCenter: Vector2;
  ballRadius: number;
  // Offscreen cache for frozen assimilated state
  cachedCanvas: OffscreenCanvas | HTMLCanvasElement | null;
  cachedX: number; // screen X offset the cache was rendered at
  cachedY: number; // screen Y offset
  cachedW: number;
  cachedH: number;
}

// Pre-compute edge data for the boundary polygon
interface EdgeInfo {
  a: Vector2;
  b: Vector2;
  len: number;
  dirX: number; // normalized direction along edge (a→b)
  dirY: number;
}

function computeEdges(vertices: Vector2[]): { edges: EdgeInfo[]; perimeter: number } {
  const n = vertices.length;
  const edges: EdgeInfo[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    edges.push({
      a, b, len,
      dirX: len > 0 ? (b.x - a.x) / len : 0,
      dirY: len > 0 ? (b.y - a.y) / len : 0,
    });
    perimeter += len;
  }
  return { edges, perimeter };
}

// Pick a random point on the perimeter and return which edge it's on + position along that edge
function randomPointOnEdge(
  edges: EdgeInfo[],
  perimeter: number
): { point: Vector2; edgeIdx: number; tOnEdge: number } {
  let target = Math.random() * perimeter;
  for (let i = 0; i < edges.length; i++) {
    if (target <= edges[i].len) {
      const t = edges[i].len > 0 ? target / edges[i].len : 0;
      const e = edges[i];
      return {
        point: { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t },
        edgeIdx: i,
        tOnEdge: t,
      };
    }
    target -= edges[i].len;
  }
  return { point: { ...edges[0].a }, edgeIdx: 0, tOnEdge: 0 };
}

// Try to create a tentacle that traces 5 world units along the fence from a random start point.
// Returns null if not enough fence length available.
function tryCreateTentacle(
  edges: EdgeInfo[],
  perimeter: number,
  ball: { position: Vector2; radius: number },
  baseAngle: number,
  tentacleIndex: number,
  totalCount: number,
  spawnDelay: number,
): Tentacle | null {
  const TRACE_LEN = 5; // world units to trace along fence

  const { point, edgeIdx, tOnEdge } = randomPointOnEdge(edges, perimeter);
  const edge = edges[edgeIdx];

  // Pick a random direction along the fence (toward a or toward b)
  const goForward = Math.random() < 0.5;
  let dirX: number, dirY: number;
  let availableLen: number;

  if (goForward) {
    dirX = edge.dirX;
    dirY = edge.dirY;
    availableLen = edge.len * (1 - tOnEdge);
    if (availableLen < TRACE_LEN) {
      const nextIdx = (edgeIdx + 1) % edges.length;
      const nextEdge = edges[nextIdx];
      const dot = dirX * nextEdge.dirX + dirY * nextEdge.dirY;
      if (dot > 0.99) {
        availableLen += nextEdge.len;
      }
    }
  } else {
    dirX = -edge.dirX;
    dirY = -edge.dirY;
    availableLen = edge.len * tOnEdge;
    if (availableLen < TRACE_LEN) {
      const prevIdx = (edgeIdx - 1 + edges.length) % edges.length;
      const prevEdge = edges[prevIdx];
      const dotPrev = dirX * (-prevEdge.dirX) + dirY * (-prevEdge.dirY);
      if (dotPrev > 0.99) {
        availableLen += prevEdge.len;
      }
    }
  }

  if (availableLen < TRACE_LEN) {
    return null;
  }

  const fenceStartX = point.x;
  const fenceStartY = point.y;
  const fenceEndX = point.x + dirX * TRACE_LEN;
  const fenceEndY = point.y + dirY * TRACE_LEN;

  const anchorAngle = baseAngle + (tentacleIndex / totalCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
  const anchorX = ball.position.x + Math.cos(anchorAngle) * ball.radius;
  const anchorY = ball.position.y + Math.sin(anchorAngle) * ball.radius;

  const dx = anchorX - fenceEndX;
  const dy = anchorY - fenceEndY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;

  const offset1 = (Math.random() - 0.3) * len * 0.5;
  const offset2 = (Math.random() - 0.7) * len * 0.5;

  return {
    fenceStartX,
    fenceStartY,
    fenceEndX,
    fenceEndY,
    fenceDirX: dirX,
    fenceDirY: dirY,
    fenceLen: TRACE_LEN,
    cp1x: fenceEndX + dx * 0.33 + perpX * offset1,
    cp1y: fenceEndY + dy * 0.33 + perpY * offset1,
    cp2x: fenceEndX + dx * 0.66 + perpX * offset2,
    cp2y: fenceEndY + dy * 0.66 + perpY * offset2,
    anchorAngle,
    progress: 0,
    baseWidth: 1.5 + Math.random() * 1.5,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.8 + Math.random() * 0.6,
    spawnDelay,
  };
}

// Ease-out-back: slight overshoot
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function createAssimilation(
  ball: { id: string; position: Vector2; radius: number },
  boundary: Vector2[],
  timestamp: number
): AssimilationState {
  const { edges, perimeter } = computeEdges(boundary);

  // Wave structure: 1 → 3 → 20-30 → 30 → 30 = ~84-94 tentacles
  const waveCounts = [1, 3, 20 + Math.floor(Math.random() * 11), 30, 30];
  const waveStarts = [0, 500, 1000, 1500, 2000];
  const count = waveCounts.reduce((a, b) => a + b, 0);
  const tentacles: Tentacle[] = [];
  const baseAngle = Math.random() * Math.PI * 2;

  // Build spawn delays per-tentacle based on waves
  const spawnDelays: number[] = [];
  for (let w = 0; w < waveCounts.length; w++) {
    for (let k = 0; k < waveCounts[w]; k++) {
      spawnDelays.push(waveStarts[w] + Math.random() * 300);
    }
  }
  // Shuffle so wave assignment doesn't correlate with anchor angle order
  for (let i = spawnDelays.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnDelays[i], spawnDelays[j]] = [spawnDelays[j], spawnDelays[i]];
  }

  for (let i = 0; i < count; i++) {
    let tentacle: Tentacle | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      tentacle = tryCreateTentacle(edges, perimeter, ball, baseAngle, i, count, spawnDelays[i]);
      if (tentacle) break;
    }
    if (tentacle) {
      tentacles.push(tentacle);
    }
  }

  return {
    ballId: ball.id,
    startTime: timestamp,
    delayMs: 0,
    tentacles,
    phase: 'emerging',
    ballCenter: { ...ball.position },
    ballRadius: ball.radius,
    cachedCanvas: null,
    cachedX: 0,
    cachedY: 0,
    cachedW: 0,
    cachedH: 0,
  };
}

export function updateAssimilation(
  anim: AssimilationState,
  ball: { wonSpinSpeed: number; assimScale: number; assimColorFade: number },
  dt: number,
  timestamp: number
): void {
  const elapsed = timestamp - anim.startTime;

  if (anim.phase === 'waiting') {
    if (elapsed >= anim.delayMs) {
      anim.phase = 'emerging';
    }
    return;
  }

  const phaseElapsed = elapsed - anim.delayMs;

  if (anim.phase === 'emerging') {
    const emergeDuration = 1500;
    let allDone = true;

    for (const ten of anim.tentacles) {
      const tenElapsed = phaseElapsed - ten.spawnDelay;
      if (tenElapsed < 0) {
        allDone = false;
        continue;
      }

      const rawT = Math.min(tenElapsed / emergeDuration, 1);
      ten.progress = Math.min(easeOutBack(rawT), 1.15);
      if (rawT < 1) allDone = false;

      // Slithering on bezier CPs
      const slither = Math.sin(timestamp * 0.005 * ten.wobbleSpeed + ten.wobblePhase) * 2.0;
      const slither2 = Math.sin(timestamp * 0.004 * ten.wobbleSpeed + ten.wobblePhase + 2.0) * 1.5;
      ten.cp1x += slither * dt * 0.4;
      ten.cp1y += slither * dt * 0.4;
      ten.cp2x += slither2 * dt * 0.4;
      ten.cp2y += slither2 * dt * 0.4;
    }

    if (allDone) {
      anim.phase = 'constricting';
      for (const ten of anim.tentacles) {
        ten.progress = 1;
      }
    }
    return;
  }

  if (anim.phase === 'constricting') {
    ball.wonSpinSpeed *= Math.pow(0.97, dt * 60);
    ball.assimScale = 1 + 0.02 * Math.sin(timestamp * 0.005);

    const lerpRate = 0.3 * dt;
    for (const ten of anim.tentacles) {
      const anchorX = anim.ballCenter.x + Math.cos(ten.anchorAngle) * anim.ballRadius;
      const anchorY = anim.ballCenter.y + Math.sin(ten.anchorAngle) * anim.ballRadius;
      const midX = (ten.fenceEndX + anchorX) * 0.5;
      const midY = (ten.fenceEndY + anchorY) * 0.5;
      ten.cp1x += (midX - ten.cp1x) * lerpRate;
      ten.cp1y += (midY - ten.cp1y) * lerpRate;
      ten.cp2x += (midX - ten.cp2x) * lerpRate;
      ten.cp2y += (midY - ten.cp2y) * lerpRate;

      const slither = Math.sin(timestamp * 0.004 * ten.wobbleSpeed + ten.wobblePhase) * 1.0;
      ten.cp1x += slither * dt * 0.2;
      ten.cp1y += slither * dt * 0.2;
    }

    if (phaseElapsed >= 6000) {
      anim.phase = 'assimilated';
    }
    return;
  }

  // assimilated — frozen, no more animation updates (performance)
  ball.wonSpinSpeed = 0;
  ball.assimScale = 1;

  const fadeDuration = 2000;
  const assimStart = anim.startTime + anim.delayMs + 6000;
  const fadeT = Math.min((timestamp - assimStart) / fadeDuration, 1);
  ball.assimColorFade = fadeT;
  // Tentacles are frozen — no CP updates
}

// Cubic bezier point at parameter t
function bezierPoint(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t2 * t * x3,
    y: mt2 * mt * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t2 * t * y3,
  };
}

// Tangent of cubic bezier at parameter t
function bezierTangent(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (x1 - x0) + 6 * mt * t * (x2 - x1) + 3 * t * t * (x3 - x2),
    y: 3 * mt * mt * (y1 - y0) + 6 * mt * t * (y2 - y1) + 3 * t * t * (y3 - y2),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Draw all tentacles to a given 2D context (used for both live and cache rendering)
function drawTentacles(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  anim: AssimilationState,
  toScreenX: (wx: number) => number,
  toScreenY: (wy: number) => number,
  boardScale: number,
  accentColor: string,
  timestamp: number,
  ballScreenX: number,
  ballScreenY: number,
  ballScreenR: number,
): void {
  // Clip out the ball interior so tentacles stop at the ball edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.arc(ballScreenX, ballScreenY, ballScreenR * 0.92, 0, Math.PI * 2, true);
  ctx.clip();

  const SAMPLE_COUNT = 10; // reduced from 16

  for (const ten of anim.tentacles) {
    if (ten.progress <= 0) continue;

    const vizProgress = Math.min(ten.progress, 1);

    const anchorX = anim.ballCenter.x + Math.cos(ten.anchorAngle) * anim.ballRadius;
    const anchorY = anim.ballCenter.y + Math.sin(ten.anchorAngle) * anim.ballRadius;

    const bezDx = anchorX - ten.fenceEndX;
    const bezDy = anchorY - ten.fenceEndY;
    const bezLenEst = Math.sqrt(bezDx * bezDx + bezDy * bezDy);
    const totalLenEst = ten.fenceLen + bezLenEst;
    const fenceFrac = totalLenEst > 0 ? ten.fenceLen / totalLenEst : 0;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.75;

    // Build the full path as points first, then draw with varying lineWidth
    for (let i = 0; i < SAMPLE_COUNT - 1; i++) {
      const t1 = (i / (SAMPLE_COUNT - 1)) * vizProgress;
      const t2 = ((i + 1) / (SAMPLE_COUNT - 1)) * vizProgress;

      let sx1: number, sy1: number, sx2: number, sy2: number;

      const getWorldPos = (t: number): { x: number; y: number } => {
        if (t <= fenceFrac) {
          const fenceT = fenceFrac > 0 ? t / fenceFrac : 0;
          return {
            x: ten.fenceStartX + (ten.fenceEndX - ten.fenceStartX) * fenceT,
            y: ten.fenceStartY + (ten.fenceEndY - ten.fenceStartY) * fenceT,
          };
        } else {
          const bezT = fenceFrac < 1 ? (t - fenceFrac) / (1 - fenceFrac) : 0;
          return bezierPoint(
            ten.fenceEndX, ten.fenceEndY,
            ten.cp1x, ten.cp1y,
            ten.cp2x, ten.cp2y,
            anchorX, anchorY,
            bezT
          );
        }
      };

      const p1 = getWorldPos(t1);
      const p2 = getWorldPos(t2);

      const segFrac = (t1 + t2) * 0.5;
      if (segFrac > fenceFrac) {
        const bezFrac = fenceFrac < 1 ? (segFrac - fenceFrac) / (1 - fenceFrac) : 0;
        const tang = bezierTangent(
          ten.fenceEndX, ten.fenceEndY,
          ten.cp1x, ten.cp1y,
          ten.cp2x, ten.cp2y,
          anchorX, anchorY,
          bezFrac
        );
        const tangLen = Math.sqrt(tang.x * tang.x + tang.y * tang.y) || 1;
        const perpX = -tang.y / tangLen;
        const perpY = tang.x / tangLen;

        const waveFreq = 3.5;
        const baseAmp = anim.phase === 'assimilated' ? 0.6 : 1.4;
        const amp = baseAmp * (1 - bezFrac * 0.6);
        const wave = Math.sin(
          timestamp * 0.006 * ten.wobbleSpeed + ten.wobblePhase + bezFrac * waveFreq * Math.PI * 2
        ) * amp;

        sx1 = toScreenX(p1.x + perpX * wave);
        sy1 = toScreenY(p1.y + perpY * wave);
        sx2 = toScreenX(p2.x + perpX * wave);
        sy2 = toScreenY(p2.y + perpY * wave);
      } else {
        sx1 = toScreenX(p1.x);
        sy1 = toScreenY(p1.y);
        sx2 = toScreenX(p2.x);
        sy2 = toScreenY(p2.y);
      }

      const overallFrac = i / (SAMPLE_COUNT - 1);
      const taper = 1 - overallFrac * (7 / 8);
      const lineW = ten.baseWidth * boardScale * taper;

      ctx.lineWidth = Math.max(lineW, 0.5);
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    }
  }

  ctx.restore(); // end clip
}

export function renderAssimilation(
  ctx: CanvasRenderingContext2D,
  anim: AssimilationState,
  boardRect: BoardRect,
  scale: number,
  accentColor: string,
  timestamp: number
): void {
  const toScreenX = (wx: number) => boardRect.left + wx * boardRect.scale;
  const toScreenY = (wy: number) => boardRect.top + wy * boardRect.scale;
  const ballScreenX = toScreenX(anim.ballCenter.x);
  const ballScreenY = toScreenY(anim.ballCenter.y);
  const ballScreenR = anim.ballRadius * boardRect.scale;

  // Glow on ball center in later phases
  if (anim.phase === 'constricting' || anim.phase === 'assimilated') {
    const glowAlpha = anim.phase === 'assimilated' ? 0.25 : 0.15;
    const gradient = ctx.createRadialGradient(
      ballScreenX, ballScreenY, ballScreenR * 0.3,
      ballScreenX, ballScreenY, ballScreenR * 1.8
    );
    gradient.addColorStop(0, hexToRgba(accentColor, glowAlpha));
    gradient.addColorStop(1, hexToRgba(accentColor, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ballScreenX, ballScreenY, ballScreenR * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Assimilated: use offscreen cache (render once, blit every frame)
  if (anim.phase === 'assimilated') {
    if (!anim.cachedCanvas) {
      // Build cache: render tentacles + text to an offscreen canvas
      // Size the cache to cover the full canvas (tentacles span from fence to ball)
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      let offscreen: OffscreenCanvas | HTMLCanvasElement;
      try {
        offscreen = new OffscreenCanvas(cw, ch);
      } catch {
        // Fallback for browsers without OffscreenCanvas
        offscreen = document.createElement('canvas');
        offscreen.width = cw;
        offscreen.height = ch;
      }
      const offCtx = offscreen.getContext('2d')!;

      // Draw tentacles
      drawTentacles(
        offCtx, anim, toScreenX, toScreenY, boardRect.scale,
        accentColor, timestamp, ballScreenX, ballScreenY, ballScreenR
      );

      // Draw "THREAD LOCKED" text
      const fontSize = ballScreenR * 3;
      offCtx.font = `bold ${Math.round(fontSize)}px sans-serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';
      offCtx.shadowColor = accentColor;
      offCtx.shadowBlur = 12 * scale;
      offCtx.fillStyle = accentColor;
      offCtx.globalAlpha = 0.9;
      offCtx.fillText('THREAD LOCKED', ballScreenX, ballScreenY);
      offCtx.shadowBlur = 4 * scale;
      offCtx.globalAlpha = 1;
      offCtx.fillText('THREAD LOCKED', ballScreenX, ballScreenY);

      anim.cachedCanvas = offscreen;
      anim.cachedX = 0;
      anim.cachedY = 0;
      anim.cachedW = cw;
      anim.cachedH = ch;
    }

    // Blit cached image — one drawImage call instead of ~900 strokes
    ctx.drawImage(anim.cachedCanvas as any, anim.cachedX, anim.cachedY);
    return;
  }

  // Live rendering for emerging/constricting phases (no shadowBlur)
  drawTentacles(
    ctx, anim, toScreenX, toScreenY, boardRect.scale,
    accentColor, timestamp, ballScreenX, ballScreenY, ballScreenR
  );
}

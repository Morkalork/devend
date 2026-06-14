// Assimilation animation: straight tentacle lines from region boundary to captured ball
import { Vector2 } from './polygon';
import { hexToRgba } from '@/lib/gameUtils';
import { BoardRect } from './boardConstants';

interface Tentacle {
  originX: number;      // Point on boundary
  originY: number;
  anchorAngle: number;  // Angle on ball perimeter where tentacle arrives
  progress: number;     // 0→1 growth
  baseWidth: number;    // Width at origin (3x tip width for heavy base)
  spawnDelay: number;   // ms after startTime before emerging
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
  cachedX: number;
  cachedY: number;
  cachedW: number;
  cachedH: number;
}

// Half the visual wall thickness — used to push tentacle origins
// from the contour (wall centerline) to the outer edge of the wall
const WALL_HALF_THICKNESS = 3;

interface EdgeInfo {
  a: Vector2;
  b: Vector2;
  len: number;
  // Outward normal (away from region interior / toward outside)
  nx: number;
  ny: number;
}

function computeEdges(vertices: Vector2[], center: Vector2): { edges: EdgeInfo[]; perimeter: number } {
  const n = vertices.length;
  const edges: EdgeInfo[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

    // Edge midpoint
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    // Perpendicular candidates (edge direction is (dx, dy), perps are (-dy, dx) and (dy, -dx))
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pLen = len || 1;
    // Candidate outward normal: the one pointing AWAY from the region center
    let nx = -dy / pLen;
    let ny = dx / pLen;
    // If this normal points toward the center, flip it
    const toCenter_x = center.x - mx;
    const toCenter_y = center.y - my;
    if (nx * toCenter_x + ny * toCenter_y > 0) {
      nx = -nx;
      ny = -ny;
    }

    edges.push({ a, b, len, nx, ny });
    perimeter += len;
  }
  return { edges, perimeter };
}

function randomPointOnPerimeter(edges: EdgeInfo[], perimeter: number): { point: Vector2; nx: number; ny: number } {
  let target = Math.random() * perimeter;
  for (const e of edges) {
    if (target <= e.len) {
      const t = e.len > 0 ? target / e.len : 0;
      return {
        point: { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t },
        nx: e.nx,
        ny: e.ny,
      };
    }
    target -= e.len;
  }
  return { point: { ...edges[0].a }, nx: edges[0].nx, ny: edges[0].ny };
}

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
  const { edges, perimeter } = computeEdges(boundary, ball.position);

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
  for (let i = spawnDelays.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnDelays[i], spawnDelays[j]] = [spawnDelays[j], spawnDelays[i]];
  }

  for (let i = 0; i < count; i++) {
    const { point, nx, ny } = randomPointOnPerimeter(edges, perimeter);
    // Push origin outward along edge normal so it sits at the outer edge of the wall
    const originX = point.x + nx * WALL_HALF_THICKNESS;
    const originY = point.y + ny * WALL_HALF_THICKNESS;
    const anchorAngle = baseAngle + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;

    tentacles.push({
      originX,
      originY,
      anchorAngle,
      progress: 0,
      baseWidth: 3 + Math.random() * 2, // heavy base
      spawnDelay: spawnDelays[i],
    });
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
    if (elapsed >= anim.delayMs) anim.phase = 'emerging';
    return;
  }

  const phaseElapsed = elapsed - anim.delayMs;

  if (anim.phase === 'emerging') {
    const emergeDuration = 1500;
    let allDone = true;

    for (const ten of anim.tentacles) {
      const tenElapsed = phaseElapsed - ten.spawnDelay;
      if (tenElapsed < 0) { allDone = false; continue; }
      const rawT = Math.min(tenElapsed / emergeDuration, 1);
      ten.progress = Math.min(easeOutBack(rawT), 1.05);
      if (rawT < 1) allDone = false;
    }

    if (allDone) {
      anim.phase = 'constricting';
      for (const ten of anim.tentacles) ten.progress = 1;
    }
    return;
  }

  if (anim.phase === 'constricting') {
    ball.wonSpinSpeed *= Math.pow(0.97, dt * 60);
    ball.assimScale = 1 + 0.02 * Math.sin(timestamp * 0.005);

    if (phaseElapsed >= 6000) anim.phase = 'assimilated';
    return;
  }

  // assimilated — frozen
  ball.wonSpinSpeed = 0;
  ball.assimScale = 1;

  const fadeDuration = 2000;
  const assimStart = anim.startTime + anim.delayMs + 6000;
  const fadeT = Math.min((timestamp - assimStart) / fadeDuration, 1);
  ball.assimColorFade = fadeT;
}

// Draw all tentacles as straight tapered lines
function drawTentacles(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  anim: AssimilationState,
  toScreenX: (wx: number) => number,
  toScreenY: (wy: number) => number,
  boardScale: number,
  accentColor: string,
  ballScreenX: number,
  ballScreenY: number,
  ballScreenR: number,
): void {
  // Clip out ball interior
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.arc(ballScreenX, ballScreenY, ballScreenR * 0.92, 0, Math.PI * 2, true);
  ctx.clip();

  const SEGMENTS = 6; // enough for visible taper

  for (const ten of anim.tentacles) {
    if (ten.progress <= 0) continue;

    const vizProgress = Math.min(ten.progress, 1);
    const anchorX = anim.ballCenter.x + Math.cos(ten.anchorAngle) * anim.ballRadius;
    const anchorY = anim.ballCenter.y + Math.sin(ten.anchorAngle) * anim.ballRadius;

    // Straight line from origin to anchor, drawn as segments for taper
    ctx.lineCap = 'round';
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.75;

    for (let i = 0; i < SEGMENTS; i++) {
      const t1 = (i / SEGMENTS) * vizProgress;
      const t2 = ((i + 1) / SEGMENTS) * vizProgress;

      const x1 = ten.originX + (anchorX - ten.originX) * t1;
      const y1 = ten.originY + (anchorY - ten.originY) * t1;
      const x2 = ten.originX + (anchorX - ten.originX) * t2;
      const y2 = ten.originY + (anchorY - ten.originY) * t2;

      // Taper: 3x width at base → 1x at tip
      const frac = (t1 + t2) * 0.5;
      const taper = 3 - frac * 2; // 3 at base → 1 at tip
      const lineW = (ten.baseWidth / 3) * taper * boardScale;

      ctx.lineWidth = Math.max(lineW, 0.5);
      ctx.beginPath();
      ctx.moveTo(toScreenX(x1), toScreenY(y1));
      ctx.lineTo(toScreenX(x2), toScreenY(y2));
      ctx.stroke();
    }
  }

  // Impact glows where tentacles meet the ball
  ctx.restore(); // remove clip so glows render on the ball surface
  for (const ten of anim.tentacles) {
    if (ten.progress < 0.95) continue;
    const anchorSX = toScreenX(anim.ballCenter.x + Math.cos(ten.anchorAngle) * anim.ballRadius);
    const anchorSY = toScreenY(anim.ballCenter.y + Math.sin(ten.anchorAngle) * anim.ballRadius);
    const glowR = boardScale * 4;
    const grad = ctx.createRadialGradient(anchorSX, anchorSY, 0, anchorSX, anchorSY, glowR);
    grad.addColorStop(0, hexToRgba(accentColor, 0.45));
    grad.addColorStop(1, hexToRgba(accentColor, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(anchorSX, anchorSY, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
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

  // Assimilated: use offscreen cache
  if (anim.phase === 'assimilated') {
    if (!anim.cachedCanvas) {
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      let offscreen: OffscreenCanvas | HTMLCanvasElement;
      try {
        offscreen = new OffscreenCanvas(cw, ch);
      } catch {
        offscreen = document.createElement('canvas');
        offscreen.width = cw;
        offscreen.height = ch;
      }
      const offCtx = offscreen.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

      drawTentacles(
        offCtx, anim, toScreenX, toScreenY, boardRect.scale,
        accentColor, ballScreenX, ballScreenY, ballScreenR
      );

      // "THREAD LOCKED" text
      const fontSize = ballScreenR * 3;
      offCtx.font = `bold ${Math.round(fontSize)}px sans-serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';

      // Black drop shadow pass
      offCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      offCtx.shadowBlur = 6 * scale;
      offCtx.shadowOffsetX = 2 * scale;
      offCtx.shadowOffsetY = 2 * scale;
      offCtx.fillStyle = accentColor;
      offCtx.globalAlpha = 0.9;
      offCtx.fillText('THREAD LOCKED', ballScreenX, ballScreenY);

      // Crisp top layer with accent glow
      offCtx.shadowColor = accentColor;
      offCtx.shadowBlur = 4 * scale;
      offCtx.shadowOffsetX = 0;
      offCtx.shadowOffsetY = 0;
      offCtx.globalAlpha = 1;
      offCtx.fillText('THREAD LOCKED', ballScreenX, ballScreenY);

      anim.cachedCanvas = offscreen;
      anim.cachedX = 0;
      anim.cachedY = 0;
      anim.cachedW = cw;
      anim.cachedH = ch;
    }

    ctx.drawImage(anim.cachedCanvas as CanvasImageSource, anim.cachedX, anim.cachedY);
    return;
  }

  // Live rendering for emerging/constricting
  drawTentacles(
    ctx, anim, toScreenX, toScreenY, boardRect.scale,
    accentColor, ballScreenX, ballScreenY, ballScreenR
  );
}

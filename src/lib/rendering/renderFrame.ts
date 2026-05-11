/**
 * renderFrame — stateless per-frame draw call.
 *
 * Extracted from GameCanvas.tsx to isolate all Canvas 2D rendering logic.
 * The function is pure with respect to React; all mutable state is accessed
 * via `game` (CanvasGameState) and `rctx` (RenderContext).
 */

import { CanvasGameState } from "@/types/gameState";
import { RenderContext } from "./types";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
  clipLineAgainstPolygons,
  Vector2,
} from "@/lib/polygon";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { computeBallTrajectory } from "@/lib/gameUtils";
import { getBallBase, getBallSpecular, getHexOverlay } from "@/lib/ballRenderCache";
import { renderBallEffects } from "@/lib/ballEffects";
import { renderWallWithEffects } from "@/lib/wallImpactEffects";
import { BOARD_WIDTH, BOARD_HEIGHT, BoardRect } from "@/lib/boardConstants";
import {
  LOCK_PULSE_DURATION,
  LOCK_FLOOD_DURATION,
  LOCK_DUST_DURATION,
  COLORS,
} from "@/lib/gameConstants";

const RAIN_SYMBOLS = '01{}()=>;./#@*';

export function createRainParticles(count: number): import("./types").RainParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 15 + Math.random() * (BOARD_WIDTH - 30),
    y: -10 - (i / count) * BOARD_HEIGHT,
    symbol: RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)],
    alpha: 0.03 + Math.random() * 0.04,
    speed: 30 + Math.random() * 50,
    size: 15 + Math.random() * 10,
  }));
}

// ── Coordinate helper ─────────────────────────────────────────────────────

function worldToScreen(worldX: number, worldY: number, boardRect: BoardRect) {
  return {
    x: boardRect.left + worldX * boardRect.scale,
    y: boardRect.top  + worldY * boardRect.scale,
  };
}

// ── Main render entry point ───────────────────────────────────────────────

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  game: CanvasGameState,
  rctx: RenderContext,
): void {
  const {
    regions,
    walls,
    balls,
    activeWall: wall,
    screenSize,
    boardRect,
    backgroundColor: _backgroundColor,
    regionColor: _regionColor,
    swipeStart,
    swipeRegionId,
    currentSwipePos,
  } = game;
  const { width: screenWidth, height: screenHeight } = screenSize;
  const { scale } = boardRect;
  const { accentColor, activeModifiers, boardGridCanvas, regionCanvas, rain } = rctx;

  const w2s = (wx: number, wy: number) => worldToScreen(wx, wy, boardRect);

  // ── Clear ─────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, screenWidth, screenHeight);

  // ── Ambient data rain ─────────────────────────────────────────────────────
  {
    const now = performance.now();
    const dtRain = rain.lastTime ? Math.min((now - rain.lastTime) / 1000, 0.05) : 0;
    rain.lastTime = now;
    const { scale: s, left: bx, top: by } = game.boardRect;
    ctx.save();
    ctx.font = `${Math.round(14 * s)}px 'JetBrains Mono', monospace`;
    ctx.textBaseline = 'top';
    for (const p of rain.particles) {
      p.y += p.speed * dtRain;
      if (p.y > BOARD_HEIGHT + 20) {
        p.y = -(10 + Math.random() * 60);
        p.x = 15 + Math.random() * (BOARD_WIDTH - 30);
        p.symbol = RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)];
        p.alpha = 0.03 + Math.random() * 0.04;
        p.speed = 30 + Math.random() * 50;
      }
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = accentColor;
      ctx.fillText(p.symbol, bx + p.x * s, by + p.y * s);
    }
    ctx.restore();
  }

  // ── Board grid + region fill ──────────────────────────────────────────────
  ctx.drawImage(boardGridCanvas, 0, 0);
  ctx.drawImage(regionCanvas, 0, 0);

  // ── Wall shadow quads ─────────────────────────────────────────────────────
  {
    const shadowW = 7 * scale;
    ctx.save();
    // Clip to board polygon so shadow quads don't bleed into the margin.
    if (game.boardPolygon) {
      ctx.beginPath();
      const sv = game.boardPolygon.vertices;
      const sv0 = w2s(sv[0].x, sv[0].y);
      ctx.moveTo(sv0.x, sv0.y);
      for (let i = 1; i < sv.length; i++) { const svp = w2s(sv[i].x, sv[i].y); ctx.lineTo(svp.x, svp.y); }
      ctx.closePath();
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
      ctx.clip();
    }
    for (const w of walls) {
      if (!w.id.startsWith('wall-')) continue;
      const s = w2s(w.start.x, w.start.y);
      const e = w2s(w.end.x, w.end.y);
      const dxW = e.x - s.x;
      const dyW = e.y - s.y;
      const lenW = Math.sqrt(dxW * dxW + dyW * dyW);
      if (lenW < 1) continue;
      const nx = -dyW / lenW;
      const ny =  dxW / lenW;
      const midX = (s.x + e.x) / 2;
      const midY = (s.y + e.y) / 2;
      const grad = ctx.createLinearGradient(
        midX + nx * shadowW, midY + ny * shadowW,
        midX - nx * shadowW, midY - ny * shadowW,
      );
      grad.addColorStop(0,   'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(s.x + nx * shadowW, s.y + ny * shadowW);
      ctx.lineTo(e.x + nx * shadowW, e.y + ny * shadowW);
      ctx.lineTo(e.x - nx * shadowW, e.y - ny * shadowW);
      ctx.lineTo(s.x - nx * shadowW, s.y - ny * shadowW);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── buildSmoothPath helper (Catmull-Rom spline) ───────────────────────────
  const buildSmoothPath = (verts: { x: number; y: number }[]) => {
    const n = verts.length;
    if (n < 3) return;
    const sv = verts.map(v => w2s(v.x, v.y));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = sv[(i - 1 + n) % n];
      const p1 = sv[i];
      const p2 = sv[(i + 1) % n];
      const p3 = sv[(i + 2) % n];
      if (i === 0) ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y,
      );
    }
    ctx.closePath();
  };

  // ── Moving obstacles ──────────────────────────────────────────────────────
  if (game.movers.length > 0) {
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);  // 0–1 pulse
    const MOVER_COLOR = '#ff8800';
    const TRACK_COLOR = 'rgba(255,136,0,0.18)';

    ctx.save();
    ctx.beginPath();
    ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
    ctx.clip();

    for (const mover of game.movers) {
      const dx = mover.axis === 'horizontal' ? mover.offset : 0;
      const dy = mover.axis === 'vertical'   ? mover.offset : 0;
      const cx = mover.homeX + dx;
      const cy = mover.homeY + dy;
      const sc = w2s(cx, cy);
      const half = mover.range / 2;

      // Track line
      const trackA = mover.axis === 'horizontal'
        ? w2s(mover.homeX - half, mover.homeY)
        : w2s(mover.homeX, mover.homeY - half);
      const trackB = mover.axis === 'horizontal'
        ? w2s(mover.homeX + half, mover.homeY)
        : w2s(mover.homeX, mover.homeY + half);
      ctx.strokeStyle = TRACK_COLOR;
      ctx.lineWidth   = 2 * scale;
      ctx.setLineDash([6 * scale, 5 * scale]);
      ctx.beginPath();
      ctx.moveTo(trackA.x, trackA.y);
      ctx.lineTo(trackB.x, trackB.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Body fill + glow
      const verts = mover.polygon.vertices;
      ctx.beginPath();
      const p0s = w2s(verts[0].x, verts[0].y);
      ctx.moveTo(p0s.x, p0s.y);
      for (let vi = 1; vi < verts.length; vi++) {
        const ps = w2s(verts[vi].x, verts[vi].y);
        ctx.lineTo(ps.x, ps.y);
      }
      ctx.closePath();

      ctx.fillStyle   = `rgba(255,${Math.round(80 + pulse * 30)},0,0.22)`;
      ctx.fill();
      ctx.strokeStyle = MOVER_COLOR;
      ctx.lineWidth   = (1.5 + pulse * 1.5) * scale;
      ctx.shadowColor = MOVER_COLOR;
      ctx.shadowBlur  = (6 + pulse * 10) * scale;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Hazard arrow showing current direction of travel
      const arrowSize = (mover.shape === 'circle' ? (mover.radius ?? 30) : Math.min(mover.width ?? 60, mover.height ?? 60) / 2) * 0.55 * scale;
      const arrowDx = mover.axis === 'horizontal' ? mover.direction : 0;
      const arrowDy = mover.axis === 'vertical'   ? mover.direction : 0;
      const tip  = { x: sc.x + arrowDx * arrowSize, y: sc.y + arrowDy * arrowSize };
      const base = { x: sc.x - arrowDx * arrowSize * 0.5, y: sc.y - arrowDy * arrowSize * 0.5 };
      const perp = arrowSize * 0.45;
      ctx.fillStyle   = MOVER_COLOR;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(base.x - arrowDy * perp, base.y + arrowDx * perp);
      ctx.lineTo(base.x + arrowDy * perp, base.y - arrowDx * perp);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── Obstacle outlines (non-mirror) ───────────────────────────────────────
  // Straight lineTo paths keep the visual boundary pixel-identical to the
  // physics polygon. buildSmoothPath (Catmull-Rom) bows outward, making the
  // visual oval larger than the physics rect — fences correctly stopped at
  // the physics edge but visually appeared to enter the obstacle interior.
  {
    const mirrorSet = new Set(game.mirrorPolygons);
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = WALL_THICKNESS * scale;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 6 * scale;
    for (const poly of game.obstaclePolygons) {
      if (mirrorSet.has(poly)) continue;
      const sv = poly.vertices.map(v => w2s(v.x, v.y));
      ctx.beginPath();
      ctx.moveTo(sv[0].x, sv[0].y);
      for (let i = 1; i < sv.length; i++) ctx.lineTo(sv[i].x, sv[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Unified wall render loop ───────────────────────────────────────────────
  ctx.save();
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = accentColor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
  ctx.clip();

  const obstacles = game.obstaclePolygons;

  const strokeSegment = (
    ss: { x: number; y: number }, es: { x: number; y: number },
    ws: { x: number; y: number }, we: { x: number; y: number },
    baseWidth: number,
  ) => {
    renderWallWithEffects(ctx, ss, es, ws, we, scale, accentColor, baseWidth);
  };

  // ── Pass 1: user-drawn fence walls, clipped to the board polygon ──────────
  // The square-cap extension in renderWallWithEffects pushes fence endpoints
  // tangentially past the board wall centre line into the margin.  Clipping to
  // the board polygon (not just boardRect) eliminates that protrusion.
  if (game.boardPolygon) {
    ctx.save();
    ctx.beginPath();
    const bpv = game.boardPolygon.vertices;
    const bp0 = w2s(bpv[0].x, bpv[0].y);
    ctx.moveTo(bp0.x, bp0.y);
    for (let i = 1; i < bpv.length; i++) {
      const bpt = w2s(bpv[i].x, bpv[i].y);
      ctx.lineTo(bpt.x, bpt.y);
    }
    ctx.closePath();
    // Punch obstacle polygons as holes so thick stroke can't bleed inside them.
    for (const poly of obstacles) {
      const sv = poly.vertices.map(v => w2s(v.x, v.y));
      ctx.moveTo(sv[0].x, sv[0].y);
      for (let i = 1; i < sv.length; i++) ctx.lineTo(sv[i].x, sv[i].y);
      ctx.closePath();
    }
    ctx.clip('evenodd');

    for (let wi = walls.length - 1; wi >= 0; wi--) {
      const w = walls[wi];
      if (!w.id.startsWith("wall-")) continue;
      const wallLineWidth = w.thickness * scale;
      if (obstacles.length > 0) {
        const segments = clipLineAgainstPolygons(w.start, w.end, obstacles);
        for (const seg of segments) {
          strokeSegment(w2s(seg.start.x, seg.start.y), w2s(seg.end.x, seg.end.y), seg.start, seg.end, wallLineWidth);
        }
      } else {
        strokeSegment(w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y), w.start, w.end, wallLineWidth);
      }
    }
    ctx.restore();
  }

  // ── Pass 2: board-edge walls, drawn on top (clipped to boardRect only) ────
  for (let wi = walls.length - 1; wi >= 0; wi--) {
    const w = walls[wi];
    if (w.isMirror) continue;
    if (!w.id.startsWith("board-")) continue;
    const wallLineWidth = w.thickness * scale;
    if (obstacles.length > 0) {
      const segments = clipLineAgainstPolygons(w.start, w.end, obstacles);
      for (const seg of segments) {
        strokeSegment(w2s(seg.start.x, seg.start.y), w2s(seg.end.x, seg.end.y), seg.start, seg.end, wallLineWidth);
      }
    } else {
      strokeSegment(w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y), w.start, w.end, wallLineWidth);
    }
  }
  ctx.restore();

  // ── Hard-clear outside boardRect (first pass) ────────────────────────────
  {
    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const sw = game.screenSize.width;
    const sh = game.screenSize.height;
    ctx.clearRect(0,       0,        sw,             bt);
    ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));
    ctx.clearRect(0,       bt,       bl,             bh);
    ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);
  }

  // ── Neon rim light ────────────────────────────────────────────────────────
  {
    const { left: rl, top: rt, width: rw, height: rh } = boardRect;
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.0014);
    const cornerSz = 6 * scale;
    const layers = [
      { lw: 10 * scale, blur: 20 * scale, alpha: 0.10 * pulse },
      { lw: 4  * scale, blur: 10 * scale, alpha: 0.30 * pulse },
      { lw: 1.5 * scale, blur: 4 * scale, alpha: 0.85 * pulse },
    ];
    ctx.save();
    ctx.strokeStyle = accentColor;
    for (const { lw, blur, alpha } of layers) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = blur;
      ctx.strokeRect(rl, rt, rw, rh);
    }
    ctx.globalAlpha = 0.9 * pulse;
    ctx.shadowBlur = 8 * scale;
    ctx.fillStyle = accentColor;
    for (const [cx, cy] of [[rl, rt], [rl + rw, rt], [rl, rt + rh], [rl + rw, rt + rh]] as [number, number][]) {
      ctx.fillRect(cx - cornerSz / 2, cy - cornerSz / 2, cornerSz, cornerSz);
    }
    ctx.restore();
  }

  // ── Mirror polygon fills + outlines ──────────────────────────────────────
  if (game.mirrorPolygons.length > 0) {
    ctx.save();
    ctx.fillStyle = "rgba(136, 221, 255, 0.15)";
    for (const poly of game.mirrorPolygons) {
      if (poly.vertices.length < 3) continue;
      buildSmoothPath(poly.vertices);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = WALL_THICKNESS * scale;
    ctx.strokeStyle = "#88ddff";
    ctx.shadowColor = "#88ddff";
    ctx.shadowBlur = 8 * scale;
    for (const poly of game.mirrorPolygons) {
      buildSmoothPath(poly.vertices);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1 * scale;
    ctx.shadowBlur = 0;
    for (const poly of game.mirrorPolygons) {
      buildSmoothPath(poly.vertices);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Cut preview line during drag ──────────────────────────────────────────
  if (swipeStart && swipeRegionId && currentSwipePos && !wall) {
    const delta = vec2Sub(currentSwipePos, swipeStart);
    const dist = vec2Length(delta);

    if (dist >= 5) {
      const direction = vec2Normalize(delta);
      const negDir = { x: -direction.x, y: -direction.y };
      const fwdPreview = castRayWithReflections(swipeStart, direction, walls);
      const bwdPreview = castRayWithReflections(swipeStart, negDir, walls);

      if (fwdPreview && bwdPreview) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
        ctx.clip();

        const previewThickness = WALL_THICKNESS;
        const allWaypoints = [fwdPreview.waypoints, bwdPreview.waypoints];
        for (const waypoints of allWaypoints) {
          for (let i = 0; i < waypoints.length - 1; i++) {
            const s = w2s(waypoints[i].x, waypoints[i].y);
            const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
            const dx = e.x - s.x, dy = e.y - s.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) continue;
            const invLen = 1 / len;

            const drawPoly = (hw: number, color: string) => {
              const px = -dy * invLen * hw, py = dx * invLen * hw;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(s.x + px, s.y + py);
              ctx.lineTo(e.x + px, e.y + py);
              ctx.lineTo(e.x - px, e.y - py);
              ctx.lineTo(s.x - px, s.y - py);
              ctx.closePath();
              ctx.fill();
            };

            drawPoly((previewThickness + 8) * scale / 2, "#ffffff");
            drawPoly((previewThickness + 4) * scale / 2, accentColor);
          }
        }

        ctx.globalAlpha = 0.4;
        for (const waypoints of allWaypoints) {
          for (let i = 1; i < waypoints.length - 1; i++) {
            const pt = w2s(waypoints[i].x, waypoints[i].y);
            ctx.fillStyle = "#88ddff";
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4 * scale, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
  }

  // ── Ball trajectory prediction (SCRUM Master modifier) ───────────────────
  if (activeModifiers.ballPathPredictionBounces > 0 && activeModifiers.ballPathPredictionBalls > 0) {
    const numBounces = activeModifiers.ballPathPredictionBounces;
    const maxBalls = activeModifiers.ballPathPredictionBalls;

    const activeBalls = balls
      .filter(b => b.state === 'active')
      .sort((a, b) => b.speed - a.speed);
    const trackedBalls = maxBalls >= 100 ? activeBalls : activeBalls.slice(0, maxBalls);

    ctx.save();
    for (const ball of trackedBalls) {
      const waypoints = computeBallTrajectory(ball.position, ball.velocity, walls, numBounces);
      if (waypoints.length < 2) continue;

      const totalSegs = waypoints.length - 1;

      ctx.lineCap = 'round';
      ctx.setLineDash([6 * scale, 8 * scale]);
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 6 * scale;

      const segLengths: number[] = [];
      let totalLength = 0;
      for (let i = 0; i < totalSegs; i++) {
        const dx = waypoints[i + 1].x - waypoints[i].x;
        const dy = waypoints[i + 1].y - waypoints[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalLength += len;
      }

      const cumDist: number[] = [0];
      for (let i = 0; i < totalSegs; i++) cumDist.push(cumDist[i] + segLengths[i]);

      const pathAlpha = (d: number) => {
        const t = totalLength > 0 ? d / totalLength : 0;
        const fadeStart = 2 / 3;
        if (t <= fadeStart) return 0.55;
        return 0.55 * (1 - (t - fadeStart) / (1 - fadeStart));
      };

      ctx.globalAlpha = 1;
      for (let i = 0; i < totalSegs; i++) {
        const a0 = pathAlpha(cumDist[i]);
        const a1 = pathAlpha(cumDist[i + 1]);
        if (a0 <= 0 && a1 <= 0) continue;

        const s = w2s(waypoints[i].x, waypoints[i].y);
        const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);

        const grad = ctx.createLinearGradient(s.x, s.y, e.x, e.y);
        grad.addColorStop(0, `rgba(0,255,136,${a0.toFixed(3)})`);
        grad.addColorStop(1, `rgba(0,255,136,${a1.toFixed(3)})`);
        ctx.strokeStyle = grad;
        ctx.shadowColor = `rgba(0,255,136,${Math.max(a0, a1).toFixed(3)})`;
        ctx.shadowBlur = 6 * scale;
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      for (let i = 1; i < waypoints.length - 1; i++) {
        const alpha = pathAlpha(cumDist[i]) * (0.75 / 0.55);
        const pt = w2s(waypoints[i].x, waypoints[i].y);
        const r = 4 * scale;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - r);
        ctx.lineTo(pt.x + r, pt.y);
        ctx.lineTo(pt.x, pt.y + r);
        ctx.lineTo(pt.x - r, pt.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Balls ─────────────────────────────────────────────────────────────────
  for (const ball of balls) {
    const screenPos = w2s(
      (ball.renderPosition ?? ball.position).x,
      (ball.renderPosition ?? ball.position).y,
    );
    const assimScale = ball.assimScale ?? 1;
    if (assimScale <= 0) continue;

    const screenRadius = ball.radius * scale;
    const isFastest = false;

    const ballIdHash = ball.id.charCodeAt(ball.id.length - 1) || 0;
    const primaryPhase = ball.rotation;
    const secondaryPhase = ball.rotation * 0.7 + ballIdHash * 0.5;
    const tertiaryPhase = ball.rotation * 1.3 + ballIdHash * 0.3;

    if (isFastest) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius + 15 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.fastestBallHighlight;
      ctx.lineWidth = 3 * scale;
      ctx.shadowColor = COLORS.fastestBallHighlight;
      ctx.shadowBlur = 15 * scale;
      ctx.stroke();
      ctx.restore();
    }

    const fade = ball.assimColorFade ?? 0;
    const r0 = parseInt(ball.color.slice(1, 3), 16);
    const g0 = parseInt(ball.color.slice(3, 5), 16);
    const b0 = parseInt(ball.color.slice(5, 7), 16);
    const ar = parseInt(accentColor.slice(1, 3), 16);
    const ag = parseInt(accentColor.slice(3, 5), 16);
    const ab = parseInt(accentColor.slice(5, 7), 16);
    const r = Math.round(r0 + (ar - r0) * fade);
    const g = Math.round(g0 + (ag - g0) * fade);
    const b = Math.round(b0 + (ab - b0) * fade);
    const blendedHex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    ctx.save();
    ctx.globalAlpha = assimScale;

    renderBallEffects(
      ctx, ball.effects, screenPos.x, screenPos.y,
      screenRadius, accentColor, ball.color, performance.now(), scale,
    );

    // Motion trail
    {
      const trailPos = ball.renderPosition ?? ball.position;
      if (!ball.trailPositions) ball.trailPositions = [];
      ball.trailPositions.push({ x: trailPos.x, y: trailPos.y });
      if (ball.trailPositions.length > 8) ball.trailPositions.shift();
      const N = ball.trailPositions.length;
      if (N > 1 && assimScale > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let ti = 0; ti < N - 1; ti++) {
          const fraction = (ti + 1) / N;
          const tp = w2s(ball.trailPositions[ti].x, ball.trailPositions[ti].y);
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, screenRadius * fraction * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r0},${g0},${b0},${fraction * 0.35})`;
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const { canvas: baseCanvas, halfSize: baseHalf } = getBallBase(blendedHex, screenRadius, scale);
    ctx.drawImage(baseCanvas, screenPos.x - baseHalf, screenPos.y - baseHalf);

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    ctx.clip();

    // Layer 1: Latitude bands
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
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
        ctx.ellipse(0, yOffset, xExtent, screenRadius * 0.08, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Layer 2: Longitude meridians
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
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
    ctx.translate(screenPos.x, screenPos.y);
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
        ctx.arc(xPos, yPos, segSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Layer 4: Polar caps
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
    const tiltX = Math.sin(secondaryPhase) * screenRadius * 0.1;
    const tiltY = Math.cos(secondaryPhase) * screenRadius * 0.1;
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(tiltX, -screenRadius * 0.7 + tiltY, screenRadius * 0.35, screenRadius * 0.15, secondaryPhase * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-tiltX, screenRadius * 0.7 - tiltY, screenRadius * 0.35, screenRadius * 0.15, -secondaryPhase * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Layer 5: Circuit-board hex overlay
    if (screenRadius > 0) {
      const hexOC = getHexOverlay(accentColor);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.18;
      ctx.translate(screenPos.x, screenPos.y);
      ctx.rotate(ball.rotation * 0.3);
      ctx.drawImage(hexOC, -screenRadius, -screenRadius, screenRadius * 2, screenRadius * 2);
      ctx.restore();
    }

    ctx.restore(); // end clip

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    ctx.clip();
    const specCanvas = getBallSpecular(screenRadius, scale);
    ctx.drawImage(specCanvas, screenPos.x - screenRadius - 2, screenPos.y - screenRadius - 2);
    ctx.restore();
    ctx.restore(); // globalAlpha
  }


  // ── Lock flash / assimilations ────────────────────────────────────────────
  if (game.assimilations.size > 0) {
    const acR = parseInt(accentColor.slice(1, 3), 16);
    const acG = parseInt(accentColor.slice(3, 5), 16);
    const acB = parseInt(accentColor.slice(5, 7), 16);
    const now = performance.now();

    for (const [, flash] of game.assimilations) {
      if (flash.polygon.length === 0) continue;
      const elapsed = now - flash.startTime;

      let fillAlpha = 0;
      let glowAlpha = 0;

      if (elapsed < LOCK_PULSE_DURATION) {
        const t = elapsed / LOCK_PULSE_DURATION;
        fillAlpha = Math.abs(Math.sin(t * Math.PI * 3)) * 0.5;
        glowAlpha = fillAlpha * 0.7;
      } else if (elapsed < LOCK_PULSE_DURATION + LOCK_FLOOD_DURATION) {
        const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
        const ease = ft < 0.5 ? 2 * ft * ft : 1 - Math.pow(-2 * ft + 2, 2) / 2;
        fillAlpha = 0.2 + ease * 0.65;
        glowAlpha = (1 - ft) * 0.9;
      } else {
        // Animation complete — hold a subtle permanent fill over the captured region.
        fillAlpha = 0.22;
        glowAlpha = 0;
      }

      ctx.save();
      if (flash.polygon.length >= 3) {
        ctx.beginPath();
        const fp = w2s(flash.polygon[0].x, flash.polygon[0].y);
        ctx.moveTo(fp.x, fp.y);
        for (let i = 1; i < flash.polygon.length; i++) {
          const p = w2s(flash.polygon[i].x, flash.polygon[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${acR}, ${acG}, ${acB}, ${fillAlpha})`;
        ctx.fill();
      }

      if (elapsed >= LOCK_PULSE_DURATION && glowAlpha > 0) {
        const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
        const c = w2s(flash.centroid.x, flash.centroid.y);
        const burstR = 120 * scale * (0.3 + ft * 1.8);
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, burstR);
        grad.addColorStop(0, `rgba(${acR}, ${acG}, ${acB}, ${glowAlpha})`);
        grad.addColorStop(0.5, `rgba(${acR}, ${acG}, ${acB}, ${glowAlpha * 0.4})`);
        grad.addColorStop(1, `rgba(${acR}, ${acG}, ${acB}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, burstR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (elapsed < LOCK_DUST_DURATION && flash.particles.length > 0) {
        const pR = parseInt(flash.ballColor.slice(1, 3), 16);
        const pG = parseInt(flash.ballColor.slice(3, 5), 16);
        const pB = parseInt(flash.ballColor.slice(5, 7), 16);
        ctx.save();
        ctx.lineCap = 'round';
        for (const p of flash.particles) {
          if (elapsed > p.lifetime) continue;
          const progress = elapsed / p.lifetime;
          const drag = Math.pow(1 - progress, 1.8);
          const tSec = elapsed / 1000;
          const wx = flash.ballPos.x + Math.cos(p.angle) * p.speed * tSec * drag;
          const wy = flash.ballPos.y + Math.sin(p.angle) * p.speed * tSec * drag
                   + 18 * tSec * tSec;
          const sp = w2s(wx, wy);
          const alpha = Math.pow(1 - progress, 1.4);
          const tailLen = p.lengthPx * (1 - progress);
          const tx = sp.x - Math.cos(p.angle) * tailLen;
          const ty = sp.y - Math.sin(p.angle) * tailLen;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(sp.x, sp.y);
          ctx.strokeStyle = `rgba(${pR}, ${pG}, ${pB}, ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ── Captured region accent-color fade ────────────────────────────────────
  if (game.capturedFills.length > 0) {
    const now = performance.now();
    const DURATION = 580;
    const PEAK     = 0.18; // fraction of DURATION at which alpha peaks
    game.capturedFills = game.capturedFills.filter(fill => {
      const age = now - fill.startTime;
      if (age > DURATION) return false;
      const t = age / DURATION;
      // Quick fade-in, then slow fade-out
      const alpha = t < PEAK
        ? (t / PEAK) * 0.52
        : ((1 - t) / (1 - PEAK)) * 0.52;

      if (fill.vertices.length < 3) return true;
      const first = w2s(fill.vertices[0].x, fill.vertices[0].y);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = accentColor;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < fill.vertices.length; i++) {
        const p = w2s(fill.vertices[i].x, fill.vertices[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return true;
    });
  }

  // ── Growing wall (active fence) ───────────────────────────────────────────
  if (wall) {
    const activeRegion = regions.find((r) => r.id === wall.activeRegionId);

    ctx.save();

    // Clip to the active region with obstacle polygons punched out as holes.
    // Even-odd rule means any area covered by an odd number of sub-paths is
    // "inside" the clip — the obstacle sub-paths cancel the outer region,
    // making them true holes. This blocks every pixel (including stroke
    // bleed from thick fences) from ever landing inside an obstacle.
    ctx.beginPath();
    if (activeRegion && activeRegion.polygon.vertices.length > 0) {
      const first = w2s(activeRegion.polygon.vertices[0].x, activeRegion.polygon.vertices[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < activeRegion.polygon.vertices.length; i++) {
        const pt = w2s(activeRegion.polygon.vertices[i].x, activeRegion.polygon.vertices[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    } else {
      const { left, top, width, height } = game.boardRect;
      ctx.rect(left, top, width, height);
    }
    for (const poly of obstacles) {
      const sv = poly.vertices.map(v => w2s(v.x, v.y));
      ctx.moveTo(sv[0].x, sv[0].y);
      for (let i = 1; i < sv.length; i++) ctx.lineTo(sv[i].x, sv[i].y);
      ctx.closePath();
    }
    ctx.clip('evenodd');

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Build a connected path for one arm of the growing fence (origin → current tip).
    const buildArmPath = (waypoints: Vector2[], segIdx: number, cur: Vector2) => {
      const o = w2s(waypoints[0].x, waypoints[0].y);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      for (let i = 0; i < segIdx; i++) {
        const pt = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
        ctx.lineTo(pt.x, pt.y);
      }
      const tip = w2s(cur.x, cur.y);
      ctx.lineTo(tip.x, tip.y);
    };

    const lw = wall.thickness * scale;

    // Outer glow via additive compositing (wide → narrow)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = accentColor;
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 3.5; ctx.globalAlpha = 0.10; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 2.0; ctx.globalAlpha = 0.20; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    ctx.restore();

    // White-bright core + accent centerline
    ctx.globalAlpha = 1;
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 1.0; ctx.strokeStyle = accentColor; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();

    // ── Pulsating end-cap glows on the growing tips ──────────────────────────
    if (!wall.isComplete) {
      const now = performance.now();
      const throb   = 0.5 + 0.5 * Math.sin(now * 0.009);  // slow 0→1 throb ~0.7 Hz
      const shimmer = 0.5 + 0.5 * Math.sin(now * 0.023);  // faster shimmer

      const coreR = wall.thickness * 0.65 * scale;

      for (const tip of [wall.startPoint, wall.endPoint]) {
        const ts = w2s(tip.x, tip.y);

        // Outer bloom — pulsing radius and opacity
        const bloomR = coreR * (3.5 + throb * 2.5);
        const bloom = ctx.createRadialGradient(ts.x, ts.y, 0, ts.x, ts.y, bloomR);
        bloom.addColorStop(0,   accentColor + 'bb');
        bloom.addColorStop(0.3, accentColor + '44');
        bloom.addColorStop(1,   accentColor + '00');
        ctx.globalAlpha = 0.5 + 0.5 * throb;
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(ts.x, ts.y, bloomR, 0, Math.PI * 2);
        ctx.fill();

        // White-hot core with accent shadow
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = (8 + shimmer * 12) * scale;
        ctx.beginPath();
        ctx.arc(ts.x, ts.y, coreR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    ctx.restore();
  }

  // ── Final hard-clear outside boardRect ───────────────────────────────────
  {
    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const sw = game.screenSize.width;
    const sh = game.screenSize.height;
    ctx.clearRect(0,       0,        sw,             bt);
    ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));
    ctx.clearRect(0,       bt,       bl,             bh);
    ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);
  }
}

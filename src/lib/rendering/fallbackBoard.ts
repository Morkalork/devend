/**
 * Emergency Canvas-2D board.
 *
 * This is NOT a renderer in the sense the sleek one is. It exists for exactly
 * one situation: WebGL failed to initialise (an old Android WebView, a
 * blocklisted GPU, a lost context at startup) and the player would otherwise be
 * staring at a black rectangle. It is the difference between "the game looks
 * plain on this device" and "the game is broken on this device".
 *
 * It therefore has ONE job: make the board legible and playable. It draws the
 * captured/live split, the obstacles, the fences, the balls and the cut preview,
 * in flat colours, and nothing else. No lighting, no shadows, no transitions, no
 * effects. Deliberately so - every feature added here is a feature that has to
 * be maintained twice, which is exactly the trap the old 2700-line parity
 * renderer fell into.
 *
 * If you find yourself wanting to make this pretty, don't. Make WebGL work.
 */

import type { CanvasGameState } from "@/types/gameState";
import type { RenderContext } from "./types";
import { traceActiveContours } from "./regionContour";
import { PALETTE, withAlpha } from "./sleek/palette";

export function renderFallbackBoard(
  ctx: CanvasRenderingContext2D,
  game: CanvasGameState,
  _rctx: RenderContext,
): void {
  const { boardRect, spaceGrid } = game;
  const scale = boardRect.scale;
  const w2s = (x: number, y: number) => ({
    x: boardRect.left + x * scale,
    y: boardRect.top + y * scale,
  });

  ctx.clearRect(0, 0, game.screenSize.width, game.screenSize.height);

  // Captured territory, then live space punched on top of it.
  ctx.fillStyle = withAlpha(PALETTE.captured, 1);
  ctx.fillRect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);

  if (spaceGrid) {
    ctx.fillStyle = withAlpha(PALETTE.active, 1);
    ctx.beginPath();
    for (const loop of traceActiveContours(spaceGrid)) {
      if (loop.length < 3) continue;
      const p0 = w2s(loop[0].x, loop[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < loop.length; i++) {
        const p = w2s(loop[i].x, loop[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }

  // Obstacles: flat fills, so the player can see what they must cut around.
  ctx.fillStyle = withAlpha(PALETTE.obstacle, 1);
  for (const poly of game.obstaclePolygons) {
    if (poly.vertices.length < 3) continue;
    ctx.beginPath();
    const v0 = w2s(poly.vertices[0].x, poly.vertices[0].y);
    ctx.moveTo(v0.x, v0.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      const v = w2s(poly.vertices[i].x, poly.vertices[i].y);
      ctx.lineTo(v.x, v.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Fences + board edges.
  ctx.lineCap = "butt";
  for (const wall of game.walls) {
    if (wall.isObstacleBoundary) continue;
    const isEdge = wall.isBoardEdge ?? wall.id.startsWith("board-");
    const a = w2s(wall.start.x, wall.start.y);
    const b = w2s(wall.end.x, wall.end.y);
    ctx.strokeStyle = withAlpha(isEdge ? PALETTE.edge : PALETTE.accent, 1);
    ctx.lineWidth = Math.max(1, wall.thickness * scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Growing fences: the player must be able to see their cut extend.
  for (const gw of game.activeWalls) {
    const a = w2s(gw.startPoint.x, gw.startPoint.y);
    const b = w2s(gw.endPoint.x, gw.endPoint.y);
    ctx.strokeStyle = withAlpha(PALETTE.accent, 1);
    ctx.lineWidth = Math.max(1, gw.thickness * scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Balls.
  for (const ball of game.balls) {
    if (ball.state === "dormant") continue;
    const p = ball.renderPosition ?? ball.position;
    const c = w2s(p.x, p.y);
    ctx.fillStyle = ball.color;
    ctx.globalAlpha = ball.state === "won" ? 0.6 : 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, ball.radius * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Board outline last, so it frames everything.
  ctx.strokeStyle = withAlpha(PALETTE.accent, 0.8);
  ctx.lineWidth = 1;
  ctx.strokeRect(boardRect.left + 0.5, boardRect.top + 0.5, boardRect.width - 1, boardRect.height - 1);
}

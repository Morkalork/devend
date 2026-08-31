import { useRef, useEffect, useState, useCallback } from 'react';
import { Minus, Plus as PlusIcon } from 'lucide-react';
import { FIT_VIEW, computeEditorBoardRect, zoomAboutPoint, type EditorView } from '@/lib/editorView';
import { ColoredArea, LevelConfig, LevelEntity, isMirrorEntity, BallConfig, WallCircleEntity, WallPolygonEntity, WallRectEntity, GravityWell } from '@/types/level';
import { BOARD_WIDTH, BOARD_HEIGHT, BoardRect } from '@/lib/boardConstants';
import { AREA_MIN_SIZE, areaStyle, isGateArea } from '@/lib/coloredAreas';
import {
  isMoverEntity, moverPath, moverHome, moverFootprintAt, moverTraverseSeconds,
  moverEscapesBoard, rangeFromHandle, axisFromDelta,
} from '@/lib/moverPath';
import { ARENA_MARGIN } from '@/lib/gameConstants';
import { hexToRgba } from '@/lib/gameUtils';
import { PULL_VECTORS } from '@/lib/physics/gravityWells';
import { hasBend } from "@/lib/bend";
import { clampZoneSpeed, type FenceZone } from "@/lib/physics/fenceZones";
import {
  bendHandlePos, bendFromHandle, curveHandlePos, curveFromHandle, withCurve,
  previewOutline, anglePivot, angleHandlePos, angleFromHandle, MAX_BEND,
} from "@/lib/admin/bendHandles";

interface MapCanvasProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  /** Index into level.gravityWells (they have no id), or null. */
  selectedWellIndex?: number | null;
  onSelectWell?: (index: number | null) => void;
  onUpdateWell?: (index: number, updates: Partial<GravityWell>) => void;
  /** Index into level.fenceZones (they have no id), or null. */
  selectedZoneIndex?: number | null;
  onSelectZone?: (index: number | null) => void;
  onUpdateZone?: (index: number, updates: Partial<FenceZone>) => void;
  /** Index into level.coloredAreas (they have no id), or null. */
  selectedAreaIndex: number | null;
  snapToGrid: boolean;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onSelectArea: (index: number | null) => void;
  onUpdateEntity: (id: string, updates: Partial<LevelEntity>) => void;
  onUpdateBall: (id: string, updates: Partial<BallConfig>) => void;
  onUpdateArea: (index: number, updates: Partial<ColoredArea>) => void;
}

const GRID_SIZE = 25;

const BALL_RADIUS = 25;
const HANDLE_SIZE = 16;
const HANDLE_HIT_SIZE = 20; // Larger hit area for easier clicking
const POINT_HANDLE_SIZE = 12;
const EDGE_HANDLE_SIZE = 10;

type RectHandle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';

type DragMode =
  | { type: 'none' }
  | { type: 'entity'; id: string; startX: number; startY: number; originalEntity: LevelEntity }
  | { type: 'area'; index: number; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'area-resize'; index: number; handle: RectHandle; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'ball'; id: string; startX: number; startY: number; originalX: number; originalY: number }
  | { type: 'circle-radius'; id: string; startDistance: number; originalRadius: number }
  | { type: 'polygon-point'; id: string; pointIndex: number; startX: number; startY: number }
  | { type: 'polygon-edge'; id: string; edgeIndex: number; startX: number; startY: number; originalPoints: [number, number][] }
  | { type: 'well'; index: number; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'well-resize'; index: number; handle: RectHandle; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'zone'; index: number; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'zone-resize'; index: number; handle: RectHandle; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  | { type: 'rect-resize'; id: string; handle: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r'; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } }
  // Dragging the far end of a mover's patrol. Sets `range` from the distance to
  // home, and flips `axis` when the drag is mostly the other way, so the path
  // is authored by pulling it rather than by typing a number and re-checking.
  | { type: 'mover-end'; id: string }
  // Bow the whole object, and bow one edge of it. Both write a parameter
  // rather than points, so a bend stays re-editable and map.yml stays short.
  | { type: 'bend'; id: string }
  | { type: 'curve'; id: string; edgeIndex: number }
  // Turning an object on the spot. Writes `angle`, so a rect stays a rect.
  | { type: 'angle'; id: string };

export function MapCanvas({
  level,
  selectedEntityId,
  selectedBallId,
  selectedAreaIndex,
  selectedWellIndex = null,
  onSelectWell,
  onUpdateWell,
  selectedZoneIndex = null,
  onSelectZone,
  onUpdateZone,
  snapToGrid,
  onSelectEntity,
  onSelectBall,
  onSelectArea,
  onUpdateEntity,
  onUpdateBall,
  onUpdateArea,
}: MapCanvasProps) {
  const snap = useCallback((v: number) => snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v), [snapToGrid]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardRect, setBoardRect] = useState<BoardRect | null>(null);
  const [view, setView] = useState<EditorView>(FIT_VIEW);
  // Read from listeners that are bound once; a ref keeps them looking at the
  // live view without re-binding on every zoom step.
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef({ w: 0, h: 0 });
  const panRef = useRef<{ sx: number; sy: number; panX: number; panY: number } | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>({ type: 'none' });
  
  // Ball positions derived from level config (startX/startY) or default
  const ballPositions: Record<string, { x: number; y: number }> = {};
  level.balls.forEach((ball, index) => {
    ballPositions[ball.id] = {
      x: ball.startX ?? BOARD_WIDTH / 2 + (index - (level.balls.length - 1) / 2) * 80,
      y: ball.startY ?? BOARD_HEIGHT / 2,
    };
  });

  // Resize handling — use ResizeObserver for reliable sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const updateSize = () => {
      // Use the canvas element's own CSS display size for the buffer
      const cssRect = canvas.getBoundingClientRect();
      const w = Math.round(cssRect.width);
      const h = Math.round(cssRect.height);
      if (w === 0 || h === 0) return;

      canvas.width = w;
      canvas.height = h;
      sizeRef.current = { w, h };
      setBoardRect(computeEditorBoardRect(w, h, viewRef.current));
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);

    /**
     * Wheel to zoom, anchored on the cursor.
     *
     * A native NON-PASSIVE listener rather than React's onWheel, because the
     * handler has to preventDefault: with ctrl held the browser reads the same
     * gesture as page zoom, which is exactly why zooming here appeared not to
     * work. A passive listener is not permitted to cancel that.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (canvas.width / r.width);
      const sy = (e.clientY - r.top) * (canvas.height / r.height);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const { w, h } = sizeRef.current;
      setView(v => zoomAboutPoint(v, v.zoom * factor, sx, sy, w, h));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Re-derive the rect whenever the view changes: wheel, buttons or a pan.
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (w > 0 && h > 0) setBoardRect(computeEditorBoardRect(w, h, view));
  }, [view]);

  // Convert pointer event to canvas-buffer coordinates (handles CSS/buffer mismatch)
  const getCanvasCoords = useCallback((e: React.PointerEvent): { sx: number; sy: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: 0, sy: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      sx: (e.clientX - rect.left) * (canvas.width / rect.width),
      sy: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  // World <-> Screen coordinate conversion
  const worldToScreen = useCallback((wx: number, wy: number): { x: number; y: number } => {
    if (!boardRect) return { x: 0, y: 0 };
    return {
      x: boardRect.left + wx * boardRect.scale,
      y: boardRect.top + wy * boardRect.scale,
    };
  }, [boardRect]);

  const screenToWorld = useCallback((sx: number, sy: number): { x: number; y: number } => {
    if (!boardRect) return { x: 0, y: 0 };
    return {
      x: (sx - boardRect.left) / boardRect.scale,
      y: (sy - boardRect.top) / boardRect.scale,
    };
  }, [boardRect]);

  /**
   * An entity's authored outline in world space, straight, before bending.
   *
   * A circle is sampled at 64 sides to match what initGame builds, so a bent
   * circle in the editor is the same shape the game will deal rather than a
   * smoother or coarser one.
   */
  const authoredOutline = useCallback((entity: LevelEntity): { x: number; y: number }[] => {
    if (entity.shape === 'rect') {
      return [
        { x: entity.x, y: entity.y },
        { x: entity.x + entity.width, y: entity.y },
        { x: entity.x + entity.width, y: entity.y + entity.height },
        { x: entity.x, y: entity.y + entity.height },
      ];
    }
    if (entity.shape === 'polygon') return entity.points.map(([x, y]) => ({ x, y }));
    return Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return { x: entity.cx + Math.cos(a) * entity.radius, y: entity.cy + Math.sin(a) * entity.radius };
    });
  }, []);

  /** The outline to DRAW: bent when the entity is bent, authored when it is not. */
  const drawnOutline = useCallback((entity: LevelEntity): { x: number; y: number }[] => {
    const points = authoredOutline(entity);
    if (!hasBend(entity)) return points;
    return previewOutline({
      points, bend: entity.bend, bendAxis: entity.bendAxis,
      curves: entity.curves, angle: entity.angle,
    });
  }, [authoredOutline]);

  // Get edge midpoints and normals for a polygon
  const getEdgeInfo = useCallback((points: [number, number][]) => {
    const edges: { midpoint: { x: number; y: number }; normal: { x: number; y: number }; p1Index: number; p2Index: number }[] = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      const midpoint = {
        x: (p1[0] + p2[0]) / 2,
        y: (p1[1] + p2[1]) / 2,
      };
      
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      
      const normal = len > 0 ? { x: -dy / len, y: dx / len } : { x: 0, y: -1 };
      
      edges.push({ midpoint, normal, p1Index: i, p2Index: (i + 1) % points.length });
    }
    return edges;
  }, []);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !boardRect) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw board background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);

    // Draw playable area
    const margin = 0.05;
    const playableLeft = boardRect.left + BOARD_WIDTH * margin * boardRect.scale;
    const playableTop = boardRect.top + BOARD_HEIGHT * margin * boardRect.scale;
    const playableWidth = BOARD_WIDTH * (1 - 2 * margin) * boardRect.scale;
    const playableHeight = BOARD_HEIGHT * (1 - 2 * margin) * boardRect.scale;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(playableLeft, playableTop, playableWidth, playableHeight);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(playableLeft, playableTop, playableWidth, playableHeight);

    // Draw grid
    ctx.lineWidth = 1;
    for (let x = 0; x <= BOARD_WIDTH; x += GRID_SIZE) {
      const isMajor = x % 100 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)';
      const sx = boardRect.left + x * boardRect.scale;
      ctx.beginPath();
      ctx.moveTo(sx, boardRect.top);
      ctx.lineTo(sx, boardRect.top + boardRect.height);
      ctx.stroke();
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += GRID_SIZE) {
      const isMajor = y % 100 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)';
      const sy = boardRect.top + y * boardRect.scale;
      ctx.beginPath();
      ctx.moveTo(boardRect.left, sy);
      ctx.lineTo(boardRect.left + boardRect.width, sy);
      ctx.stroke();
    }

    // Draw Colored Areas (win-gate zones) beneath the entities, mirroring the
    // in-game look: light fill, dashed border, centred kind label + multiplier.
    (level.coloredAreas || []).forEach((area, index) => {
      const st = areaStyle(area.kind);
      const gate = isGateArea(area);
      const isSelected = index === selectedAreaIndex ||
        ((dragMode.type === 'area' || dragMode.type === 'area-resize') && dragMode.index === index);
      const tl = worldToScreen(area.x, area.y);
      const aw = area.width * boardRect.scale;
      const ah = area.height * boardRect.scale;

      // Same distinction as in game: gate solid + bright, bonus faint + dotted.
      ctx.fillStyle = hexToRgba(st.color, isSelected ? 0.28 : (gate ? 0.14 : 0.08));
      ctx.fillRect(tl.x, tl.y, aw, ah);
      ctx.strokeStyle = hexToRgba(st.color, isSelected ? 1 : (gate ? 0.75 : 0.5));
      ctx.lineWidth = isSelected ? 3 : (gate ? 2 : 1.25);
      ctx.setLineDash(gate ? [9, 6] : [3, 5]);
      ctx.strokeRect(tl.x, tl.y, aw, ah);
      ctx.setLineDash([]);

      const cx = tl.x + aw / 2;
      const cy = tl.y + ah / 2;
      const labelPx = Math.max(12, Math.min(aw, ah) * 0.2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = hexToRgba(st.color, gate ? 0.95 : 0.7);
      ctx.font = `bold ${labelPx}px monospace`;
      ctx.fillText(st.label, cx, cy + labelPx * 0.15);
      ctx.font = `bold ${labelPx * 0.6}px monospace`;
      ctx.fillText(`x${st.multiplier}`, cx, cy + labelPx * 1.05);

      if (isSelected) {
        // Move handle at the centre + the eight resize handles (same as rects).
        ctx.fillStyle = '#4488ff';
        ctx.beginPath();
        ctx.arc(cx, cy, HANDLE_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2255cc';
        ctx.lineWidth = 2;
        ctx.stroke();

        rectHandlePositions(tl.x, tl.y, aw, ah).forEach(({ pos, name }) => {
          const isCorner = name.length === 2;
          const size = isCorner ? HANDLE_SIZE : EDGE_HANDLE_SIZE;
          ctx.fillStyle = isCorner ? '#fff' : '#00ff88';
          ctx.fillRect(pos.x - size / 2, pos.y - size / 2, size, size);
          ctx.strokeStyle = isCorner ? st.color : '#008844';
          ctx.lineWidth = 2;
          ctx.strokeRect(pos.x - size / 2, pos.y - size / 2, size, size);
        });

    // Fence-speed ground. Drawn first and hatched rather than filled: it is
    // terrain, not an object, and a solid fill at this size is indistinguishable
    // from a colored area. Slow ground reads cold, fast ground warm, so which
    // one you are looking at is legible without reading the number.
    (level.fenceZones || []).forEach((zone, index) => {
      const isSel = index === selectedZoneIndex ||
        ((dragMode.type === 'zone' || dragMode.type === 'zone-resize') && dragMode.index === index);
      const tl = worldToScreen(zone.x, zone.y);
      const zw = zone.width * boardRect.scale;
      const zh = zone.height * boardRect.scale;
      const speed = clampZoneSpeed(zone.speed);
      const COLOR = speed < 1 ? '#5b8dd9' : '#e0954a';

      ctx.save();
      ctx.beginPath();
      ctx.rect(tl.x, tl.y, zw, zh);
      ctx.clip();
      ctx.fillStyle = hexToRgba(COLOR, isSel ? 0.16 : 0.09);
      ctx.fillRect(tl.x, tl.y, zw, zh);
      // Diagonal hatching, leaning the way the speed goes: slow ground leans
      // back, fast ground leans forward.
      ctx.strokeStyle = hexToRgba(COLOR, isSel ? 0.6 : 0.35);
      ctx.lineWidth = 1;
      const step = 12;
      const lean = speed < 1 ? -1 : 1;
      for (let o = -zh; o < zw + zh; o += step) {
        ctx.beginPath();
        ctx.moveTo(tl.x + o, tl.y);
        ctx.lineTo(tl.x + o + lean * zh, tl.y + zh);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = hexToRgba(COLOR, isSel ? 1 : 0.55);
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.strokeRect(tl.x, tl.y, zw, zh);

      if (zw > 40 && zh > 20) {
        ctx.fillStyle = hexToRgba(COLOR, 0.95);
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${speed}x fence`, tl.x + zw / 2, tl.y + zh / 2);
      }

      if (isSel) {
        for (const handle of rectHandlePositions(tl.x, tl.y, zw, zh)) {
          const size = handle.name.length === 2 ? HANDLE_SIZE : EDGE_HANDLE_SIZE;
          ctx.fillStyle = '#fff';
          ctx.fillRect(handle.pos.x - size / 2, handle.pos.y - size / 2, size, size);
          ctx.strokeStyle = COLOR;
          ctx.lineWidth = 2;
          ctx.strokeRect(handle.pos.x - size / 2, handle.pos.y - size / 2, size, size);
        }
        ctx.fillStyle = '#4488ff';
        ctx.beginPath();
        ctx.arc(tl.x + zw / 2, tl.y + zh / 2, HANDLE_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Gravity wells (issue #77). Drawn after the areas and in their own colour,
    // because they are a different KIND of thing: an area scores a lock, a well
    // bends a ball. The glyph is the in-game one cut down to what survives at
    // editor size, so a map reads the same here as it does in play.
    (level.gravityWells || []).forEach((well, index) => {
      const isSel = index === selectedWellIndex ||
        ((dragMode.type === 'well' || dragMode.type === 'well-resize') && dragMode.index === index);
      const tl = worldToScreen(well.x, well.y);
      const ww = well.width * boardRect.scale;
      const wh = well.height * boardRect.scale;
      const COLOR = '#ffa23c';

      ctx.fillStyle = hexToRgba(COLOR, isSel ? 0.22 : 0.1);
      ctx.fillRect(tl.x, tl.y, ww, wh);
      ctx.strokeStyle = hexToRgba(COLOR, isSel ? 1 : 0.6);
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.strokeRect(tl.x, tl.y, ww, wh);

      const wcx = tl.x + ww / 2;
      const wcy = tl.y + wh / 2;
      const unit = Math.min(ww, wh);
      const arm = Math.min(unit * 0.3, 22);

      // The glyph points the way the well pulls, authored once in the pull's
      // own frame. `f` runs along the pull, `s` across it, exactly as in the
      // game renderer, so a well reads identically in both places.
      const pv = PULL_VECTORS[well.pull ?? 'down'];
      const sx = pv.y, sy = -pv.x;
      const at = (sOff: number, fOff: number) => ({
        x: wcx + sx * sOff + pv.x * fOff,
        y: wcy + sy * sOff + pv.y * fOff,
      });
      const across = pv.x !== 0 ? wh : ww;

      ctx.strokeStyle = hexToRgba(COLOR, 0.9);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const frac of [-0.34, 0.34]) {
        const o = frac * across;
        const tail = at(o, -arm), tip = at(o, arm);
        const l = at(o - arm * 0.42, arm * 0.58), r = at(o + arm * 0.42, arm * 0.58);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y); ctx.lineTo(tip.x, tip.y);
        ctx.moveTo(l.x, l.y); ctx.lineTo(tip.x, tip.y);
        ctx.moveTo(r.x, r.y); ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
      const ballC = at(0, unit * 0.14);
      ctx.beginPath();
      ctx.arc(ballC.x, ballC.y, Math.max(3, unit * 0.15), 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // A dormant well says so in words. The builder has no clock and no
      // cleared space, so there is no state it could show instead, and an
      // unlabelled well that simply does nothing in play is the kind of thing
      // an author discovers ten minutes into testing.
      if (well.activeFrom != null) {
        ctx.fillStyle = hexToRgba(COLOR, 0.95);
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`wakes at ${well.activeFrom}%`, wcx, tl.y + wh - 6);
        ctx.textAlign = 'start';
      }
    });
      }
    });

    /**
     * Mover patrols, drawn UNDER the bodies so an object never hides its own
     * path. Each one shows the two extremes as dashed ghosts, the line between
     * them, an arrow for the direction it sets off in, and a filled marker
     * where it actually starts.
     *
     * This is the whole reason movers were worth adding to the builder rather
     * than leaving in YAML. A mover is authored as a home plus a range, so the
     * two positions that collide with things are not numbers in the file, and
     * the only way to find out that the far end walks into a wall was to run
     * the map.
     */
    (level.entities || []).forEach(entity => {
      if (!isMoverEntity(entity)) return;
      const isSelected = entity.id === selectedEntityId
        || (dragMode.type !== 'none' && 'id' in dragMode && dragMode.id === entity.id);
      const path = moverPath(entity);
      // The far end walking off the board is the classic authored-mover bug and
      // it is invisible in the YAML: home sits comfortably inside the arena and
      // the extreme is half a range past the wall. Flag it in red on the canvas
      // rather than leaving it to a playtest.
      const escapes = moverEscapesBoard(entity, BOARD_WIDTH, BOARD_WIDTH * ARENA_MARGIN);
      const pathColor = escapes ? '239, 68, 68' : '251, 191, 36';
      const a = worldToScreen(path.min.x, path.min.y);
      const b = worldToScreen(path.max.x, path.max.y);
      const start = worldToScreen(path.start.x, path.start.y);

      // Ghost footprints at both ends: the actual space the mover sweeps into,
      // not just the centre line, since it is the body that hits the wall.
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = `rgba(${pathColor}, ${isSelected || escapes ? 0.85 : 0.4})`;
      ctx.lineWidth = 1.5;
      for (const offset of [-entity.range / 2, entity.range / 2]) {
        const f = moverFootprintAt(entity, offset);
        const tl = worldToScreen(f.x, f.y);
        if (entity.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(tl.x + (f.width / 2) * boardRect.scale, tl.y + (f.height / 2) * boardRect.scale,
            (f.width / 2) * boardRect.scale, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(tl.x, tl.y, f.width * boardRect.scale, f.height * boardRect.scale);
        }
      }
      ctx.restore();

      // The travel line.
      ctx.save();
      ctx.strokeStyle = `rgba(${pathColor}, ${isSelected || escapes ? 0.9 : 0.45})`;
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // End caps, so the extremes read as stops rather than a line running out.
      const capLength = 7;
      for (const p of [a, b]) {
        ctx.beginPath();
        if (entity.axis === 'horizontal') {
          ctx.moveTo(p.x, p.y - capLength); ctx.lineTo(p.x, p.y + capLength);
        } else {
          ctx.moveTo(p.x - capLength, p.y); ctx.lineTo(p.x + capLength, p.y);
        }
        ctx.stroke();
      }

      // Direction arrow at the start. Movers always set off toward +axis
      // (right or down) whatever their phase, which is initGame's `direction: 1`
      // and not obvious from anything in the YAML.
      const arrow = 8;
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      if (entity.axis === 'horizontal') {
        ctx.moveTo(start.x + arrow, start.y);
        ctx.lineTo(start.x - arrow * 0.5, start.y - arrow * 0.7);
        ctx.lineTo(start.x - arrow * 0.5, start.y + arrow * 0.7);
      } else {
        ctx.moveTo(start.x, start.y + arrow);
        ctx.lineTo(start.x - arrow * 0.7, start.y - arrow * 0.5);
        ctx.lineTo(start.x + arrow * 0.7, start.y - arrow * 0.5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (isSelected) {
        // The end handle: drag it to stretch the patrol or flip its axis.
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#0b0b12';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Travel and one-way time, right on the path rather than only in the
        // panel: placement is a canvas job and the timing is what a neck is
        // authored against.
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const label = escapes
          ? `${Math.round(entity.range)}u  leaves the board`
          : `${Math.round(entity.range)}u  ${moverTraverseSeconds(entity).toFixed(1)}s`;
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(11, 11, 18, 0.8)';
        ctx.fillRect(mid.x - w / 2 - 4, mid.y - 20, w + 8, 15);
        ctx.fillStyle = escapes ? '#ef4444' : '#fbbf24';
        ctx.fillText(label, mid.x, mid.y - 7);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    });

    // Draw entities
    (level.entities || []).forEach(entity => {
      /**
       * Trace an entity's bent outline. Returns false when it is straight, so
       * each shape keeps its existing fillRect / arc fast path and an unbent
       * map draws byte for byte as it did before.
       */
      const traceIfBent = (entity: LevelEntity): boolean => {
        if (!hasBend(entity)) return false;
        const pts = drawnOutline(entity).map(v => worldToScreen(v.x, v.y));
        if (pts.length < 3) return false;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        return true;
      };

      // Consider entity selected if it matches selectedEntityId OR if we're dragging it
      const isDraggingThisEntity = dragMode.type !== 'none' && 'id' in dragMode && dragMode.id === entity.id;
      const isSelected = entity.id === selectedEntityId || isDraggingThisEntity;
      
      if (entity.shape === 'circle') {
        const circleEntity = entity as WallCircleEntity;
        const center = worldToScreen(circleEntity.cx, circleEntity.cy);
        const radius = circleEntity.radius * boardRect.scale;
        const isMirror = isMirrorEntity(entity);
        const isMover = isMoverEntity(entity);

        ctx.fillStyle = isMover
          ? (isSelected ? 'rgba(251, 191, 36, 0.5)' : 'rgba(251, 191, 36, 0.3)')
          : isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        const circleBent = traceIfBent(entity);
        if (!circleBent) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();

        ctx.strokeStyle = isMirror
          ? (isSelected ? '#88ddff' : '#66bbdd')
          : (isSelected ? '#ff6b6b' : '#cc5555');
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        if (isSelected) {
          // Draw center move handle
          ctx.fillStyle = '#4488ff';
          ctx.beginPath();
          ctx.arc(center.x, center.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#2255cc';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Draw radius handles
          const handlePositions = [
            { x: center.x + radius, y: center.y },
            { x: center.x - radius, y: center.y },
            { x: center.x, y: center.y - radius },
            { x: center.x, y: center.y + radius },
          ];
          
          handlePositions.forEach(pos => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(pos.x - HANDLE_SIZE/2, pos.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.strokeRect(pos.x - HANDLE_SIZE/2, pos.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
          });
        }
      } else if (entity.shape === 'rect') {
        // Handle rect walls and mirrors
        const rectEntity = entity as WallRectEntity;
        const topLeft = worldToScreen(rectEntity.x, rectEntity.y);
        const width = rectEntity.width * boardRect.scale;
        const height = rectEntity.height * boardRect.scale;

        const isMirror = isMirrorEntity(entity);
        const isMover = isMoverEntity(entity);
        ctx.fillStyle = isMover
          ? (isSelected ? 'rgba(251, 191, 36, 0.5)' : 'rgba(251, 191, 36, 0.3)')
          : isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        const rectBent = traceIfBent(entity);
        if (rectBent) ctx.fill(); else ctx.fillRect(topLeft.x, topLeft.y, width, height);

        ctx.strokeStyle = isMover
          ? (isSelected ? '#fbbf24' : '#d19a1c')
          : isMirror
          ? (isSelected ? '#88ddff' : '#66bbdd')
          : (isSelected ? '#ff6b6b' : '#cc5555');
        ctx.lineWidth = isSelected ? 3 : 2;
        if (rectBent) ctx.stroke(); else ctx.strokeRect(topLeft.x, topLeft.y, width, height);
        
        // Draw resize handles when selected
        if (isSelected) {
          const centerX = topLeft.x + width / 2;
          const centerY = topLeft.y + height / 2;
          
          // Draw center move handle
          ctx.fillStyle = '#4488ff';
          ctx.beginPath();
          ctx.arc(centerX, centerY, HANDLE_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#2255cc';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          const handles = [
            { x: topLeft.x, y: topLeft.y }, // tl
            { x: topLeft.x + width, y: topLeft.y }, // tr
            { x: topLeft.x, y: topLeft.y + height }, // bl
            { x: topLeft.x + width, y: topLeft.y + height }, // br
            { x: topLeft.x + width / 2, y: topLeft.y }, // t
            { x: topLeft.x + width / 2, y: topLeft.y + height }, // b
            { x: topLeft.x, y: topLeft.y + height / 2 }, // l
            { x: topLeft.x + width, y: topLeft.y + height / 2 }, // r
          ];
          
          handles.forEach((pos, i) => {
            const isCorner = i < 4;
            const size = isCorner ? HANDLE_SIZE : EDGE_HANDLE_SIZE;
            ctx.fillStyle = isCorner ? '#fff' : '#00ff88';
            ctx.fillRect(pos.x - size/2, pos.y - size/2, size, size);
            ctx.strokeStyle = isCorner ? '#ff6b6b' : '#008844';
            ctx.lineWidth = 2;
            ctx.strokeRect(pos.x - size/2, pos.y - size/2, size, size);
          });
        }
      } else if (entity.shape === 'polygon') {
        const polyEntity = entity as WallPolygonEntity;
        const points = polyEntity.points.map(([x, y]) => worldToScreen(x, y));
        // No mover branch here: a mover is rect or circle only (LevelMoverEntity),
        // so a polygon can never be one.
        const isMirror = isMirrorEntity(entity);

        ctx.fillStyle = isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        if (!traceIfBent(entity)) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
        }
        ctx.fill();

        ctx.strokeStyle = isMirror
          ? (isSelected ? '#88ddff' : '#66bbdd')
          : (isSelected ? '#ff6b6b' : '#cc5555');
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        if (isSelected) {
          // Calculate polygon center for move handle
          const avgX = polyEntity.points.reduce((sum, p) => sum + p[0], 0) / polyEntity.points.length;
          const avgY = polyEntity.points.reduce((sum, p) => sum + p[1], 0) / polyEntity.points.length;
          const centerScreen = worldToScreen(avgX, avgY);
          
          // Draw center move handle
          ctx.fillStyle = '#4488ff';
          ctx.beginPath();
          ctx.arc(centerScreen.x, centerScreen.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#2255cc';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          const edges = getEdgeInfo(polyEntity.points);
          edges.forEach(edge => {
            const screenMid = worldToScreen(edge.midpoint.x, edge.midpoint.y);
            
            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.moveTo(screenMid.x, screenMid.y - EDGE_HANDLE_SIZE);
            ctx.lineTo(screenMid.x + EDGE_HANDLE_SIZE, screenMid.y);
            ctx.lineTo(screenMid.x, screenMid.y + EDGE_HANDLE_SIZE);
            ctx.lineTo(screenMid.x - EDGE_HANDLE_SIZE, screenMid.y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#008844';
            ctx.lineWidth = 1;
            ctx.stroke();
          });
          
          points.forEach((p, i) => {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, POINT_HANDLE_SIZE, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = '#000';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), p.x, p.y);
          });
        }
      }

      // ── Bend handles ──────────────────────────────────────────────────
      // Drawn last and for every shape, so the gesture is the same whether the
      // thing selected is a rect, a circle or a polygon. Violet, because every
      // other handle in here is already spoken for: white = vertex, green =
      // edge, blue = move.
      if (isSelected) {
        const authored = authoredOutline(entity);

        // The whole-object bow. Sits ON the arc's apex, so it follows the
        // cursor rather than acting as a slider parked off to one side.
        const bendW = bendHandlePos({ points: authored, bend: entity.bend, bendAxis: entity.bendAxis });
        const bendS = worldToScreen(bendW.x, bendW.y);
        const centreW = bendHandlePos({ points: authored });
        const centreS = worldToScreen(centreW.x, centreW.y);
        // A leash back to the unbent centre, so it reads as a pull, and so a
        // handle dragged far from its object is still traceable to it.
        ctx.strokeStyle = 'rgba(192, 140, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(centreS.x, centreS.y);
        ctx.lineTo(bendS.x, bendS.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#c08cff';
        ctx.beginPath();
        ctx.arc(bendS.x, bendS.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7a3fd0';
        ctx.lineWidth = 2;
        ctx.stroke();

        // The turn knob, on a stalk from the centre. Amber, and outside the
        // shape: every other handle already lives inside its footprint.
        const pivotW = anglePivot(authored);
        const pivotS = worldToScreen(pivotW.x, pivotW.y);
        const knobW = angleHandlePos(authored, entity.angle ?? 0);
        const knobS = worldToScreen(knobW.x, knobW.y);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pivotS.x, pivotS.y);
        ctx.lineTo(knobS.x, knobS.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(knobS.x, knobS.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.stroke();

        // One curve handle per edge, polygons only: `curves` is indexed against
        // authored points, and a rect's four corners are implied rather than
        // stored, so there is nothing stable to index on a rect.
        if (entity.shape === 'polygon') {
          for (let i = 0; i < authored.length; i++) {
            const hw = curveHandlePos(authored, i, entity.curves?.[i] ?? 0);
            const hs = worldToScreen(hw.x, hw.y);
            ctx.fillStyle = '#c08cff';
            ctx.beginPath();
            ctx.arc(hs.x, hs.y, POINT_HANDLE_SIZE - 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#7a3fd0';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    });

    // Draw balls
    level.balls.forEach(ball => {
      const pos = ballPositions[ball.id];
      if (!pos) return;
      
      const isSelected = ball.id === selectedBallId;
      const screenPos = worldToScreen(pos.x, pos.y);
      const radius = BALL_RADIUS * boardRect.scale;
      
      ctx.fillStyle = `#${ball.color}`;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      if (isSelected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

  }, [level, boardRect, selectedEntityId, selectedBallId, selectedAreaIndex, selectedWellIndex, selectedZoneIndex, ballPositions, worldToScreen, getEdgeInfo, dragMode, authoredOutline, drawnOutline]);

  // Hit testing
  const hitTest = useCallback((sx: number, sy: number): { type: 'entity' | 'ball' | 'handle' | 'area' | 'area-handle' | 'well' | 'well-handle' | 'zone' | 'zone-handle'; id: string; areaIndex?: number; wellIndex?: number; zoneIndex?: number; handleType?: string; pointIndex?: number; edgeIndex?: number; rectHandle?: RectHandle } | null => {
    if (!boardRect) return null;

    const world = screenToWorld(sx, sy);

    // The selected zone's handles. Zones are drawn UNDER everything - they are
    // ground, not furniture - so they are tested last among the rect things,
    // but the selected one's handles still come first or they are unreachable
    // under an obstacle sitting on the same spot.
    if (selectedZoneIndex !== null) {
      const zone = (level.fenceZones || [])[selectedZoneIndex];
      if (zone) {
        const tl = worldToScreen(zone.x, zone.y);
        const zw = zone.width * boardRect.scale;
        const zh = zone.height * boardRect.scale;
        const center = { x: tl.x + zw / 2, y: tl.y + zh / 2 };
        if (Math.abs(sx - center.x) < HANDLE_HIT_SIZE && Math.abs(sy - center.y) < HANDLE_HIT_SIZE) {
          return { type: 'zone-handle', id: '', zoneIndex: selectedZoneIndex, handleType: 'move' };
        }
        for (const handle of rectHandlePositions(tl.x, tl.y, zw, zh)) {
          const hitSize = handle.name.length === 2 ? HANDLE_HIT_SIZE : HANDLE_HIT_SIZE - 4;
          if (Math.abs(sx - handle.pos.x) < hitSize && Math.abs(sy - handle.pos.y) < hitSize) {
            return { type: 'zone-handle', id: '', zoneIndex: selectedZoneIndex, handleType: 'rect', rectHandle: handle.name };
          }
        }
      }
    }

    // The selected well's handles, before the area's: a well is drawn on top of
    // an area, so its handles must win a click in the same order.
    if (selectedWellIndex !== null) {
      const well = (level.gravityWells || [])[selectedWellIndex];
      if (well) {
        const tl = worldToScreen(well.x, well.y);
        const ww = well.width * boardRect.scale;
        const wh = well.height * boardRect.scale;
        const center = { x: tl.x + ww / 2, y: tl.y + wh / 2 };
        if (Math.abs(sx - center.x) < HANDLE_HIT_SIZE && Math.abs(sy - center.y) < HANDLE_HIT_SIZE) {
          return { type: 'well-handle', id: '', wellIndex: selectedWellIndex, handleType: 'move' };
        }
        for (const handle of rectHandlePositions(tl.x, tl.y, ww, wh)) {
          const hitSize = handle.name.length === 2 ? HANDLE_HIT_SIZE : HANDLE_HIT_SIZE - 4;
          if (Math.abs(sx - handle.pos.x) < hitSize && Math.abs(sy - handle.pos.y) < hitSize) {
            return { type: 'well-handle', id: '', wellIndex: selectedWellIndex, handleType: 'rect', rectHandle: handle.name };
          }
        }
      }
    }

    // Check the selected area's handles first (they sit on top of everything)
    if (selectedAreaIndex !== null) {
      const area = (level.coloredAreas || [])[selectedAreaIndex];
      if (area) {
        const tl = worldToScreen(area.x, area.y);
        const aw = area.width * boardRect.scale;
        const ah = area.height * boardRect.scale;

        const center = { x: tl.x + aw / 2, y: tl.y + ah / 2 };
        if (Math.abs(sx - center.x) < HANDLE_HIT_SIZE && Math.abs(sy - center.y) < HANDLE_HIT_SIZE) {
          return { type: 'area-handle', id: '', areaIndex: selectedAreaIndex, handleType: 'move' };
        }

        for (const handle of rectHandlePositions(tl.x, tl.y, aw, ah)) {
          const hitSize = handle.name.length === 2 ? HANDLE_HIT_SIZE : HANDLE_HIT_SIZE - 4;
          if (Math.abs(sx - handle.pos.x) < hitSize && Math.abs(sy - handle.pos.y) < hitSize) {
            return { type: 'area-handle', id: '', areaIndex: selectedAreaIndex, handleType: 'rect', rectHandle: handle.name };
          }
        }
      }
    }

    // Check entity handles first (when selected)
    if (selectedEntityId) {
      const entity = (level.entities || []).find(e => e.id === selectedEntityId);
      if (entity) {
        // The bend handles go first. The whole-object one sits at the arc's
        // apex, which on a straight object is the dead centre - exactly where
        // the move handle is - and on a bent one can be anywhere over the body.
        // Testing it after either would make it unreachable.
        const authored = authoredOutline(entity);
        const knob = angleHandlePos(authored, entity.angle ?? 0);
        const knobS = worldToScreen(knob.x, knob.y);
        if (Math.hypot(sx - knobS.x, sy - knobS.y) < HANDLE_HIT_SIZE) {
          return { type: 'handle', id: entity.id, handleType: 'angle' };
        }
        const bw = bendHandlePos({ points: authored, bend: entity.bend, bendAxis: entity.bendAxis });
        const bs = worldToScreen(bw.x, bw.y);
        if (Math.hypot(sx - bs.x, sy - bs.y) < HANDLE_HIT_SIZE) {
          return { type: 'handle', id: entity.id, handleType: 'bend' };
        }
        if (entity.shape === 'polygon') {
          for (let i = 0; i < authored.length; i++) {
            const hw = curveHandlePos(authored, i, entity.curves?.[i] ?? 0);
            const hs = worldToScreen(hw.x, hw.y);
            if (Math.hypot(sx - hs.x, sy - hs.y) < HANDLE_HIT_SIZE - 2) {
              return { type: 'handle', id: entity.id, handleType: 'curve', edgeIndex: i };
            }
          }
        }

        // A mover's end handle sits at the far extreme, well clear of the body,
        // so it is tested before the body's own handles rather than after.
        if (isMoverEntity(entity)) {
          const end = worldToScreen(moverPath(entity).max.x, moverPath(entity).max.y);
          if (Math.hypot(sx - end.x, sy - end.y) < HANDLE_HIT_SIZE) {
            return { type: 'handle', id: entity.id, handleType: 'mover-end' };
          }
        }
        if (entity.shape === 'circle') {
          const circleEntity = entity as WallCircleEntity;
          const center = worldToScreen(circleEntity.cx, circleEntity.cy);
          const radius = circleEntity.radius * boardRect.scale;
          
          // Check center move handle first
          if (Math.abs(sx - center.x) < HANDLE_HIT_SIZE && Math.abs(sy - center.y) < HANDLE_HIT_SIZE) {
            return { type: 'handle', id: entity.id, handleType: 'move' };
          }

          // Check radius handles (at cardinal points on circle edge)
          const handlePositions = [
            { x: center.x + radius, y: center.y },
            { x: center.x - radius, y: center.y },
            { x: center.x, y: center.y - radius },
            { x: center.x, y: center.y + radius },
          ];

          for (const pos of handlePositions) {
            if (Math.abs(sx - pos.x) < HANDLE_HIT_SIZE && Math.abs(sy - pos.y) < HANDLE_HIT_SIZE) {
              return { type: 'handle', id: entity.id, handleType: 'radius' };
            }
          }
        } else if (entity.shape === 'rect') {
          const rectEntity = entity as WallRectEntity;
          const topLeft = worldToScreen(rectEntity.x, rectEntity.y);
          const width = rectEntity.width * boardRect.scale;
          const height = rectEntity.height * boardRect.scale;
          const center = { x: topLeft.x + width / 2, y: topLeft.y + height / 2 };

          // Check center move handle first
          if (Math.abs(sx - center.x) < HANDLE_HIT_SIZE && Math.abs(sy - center.y) < HANDLE_HIT_SIZE) {
            return { type: 'handle', id: entity.id, handleType: 'move' };
          }

          // Check corner and edge handles
          for (const handle of rectHandlePositions(topLeft.x, topLeft.y, width, height)) {
            const hitSize = handle.name.length === 2 ? HANDLE_HIT_SIZE : HANDLE_HIT_SIZE - 4;
            if (Math.abs(sx - handle.pos.x) < hitSize && Math.abs(sy - handle.pos.y) < hitSize) {
              return { type: 'handle', id: entity.id, handleType: 'rect', rectHandle: handle.name };
            }
          }
        } else if (entity.shape === 'polygon') {
          const polyEntity = entity as WallPolygonEntity;

          // Calculate polygon center for move handle
          const avgX = polyEntity.points.reduce((sum, p) => sum + p[0], 0) / polyEntity.points.length;
          const avgY = polyEntity.points.reduce((sum, p) => sum + p[1], 0) / polyEntity.points.length;
          const centerScreen = worldToScreen(avgX, avgY);

          // Check center move handle first
          if (Math.abs(sx - centerScreen.x) < HANDLE_HIT_SIZE && Math.abs(sy - centerScreen.y) < HANDLE_HIT_SIZE) {
            return { type: 'handle', id: entity.id, handleType: 'move' };
          }

          // Check vertex handles
          for (let i = 0; i < polyEntity.points.length; i++) {
            const pointPos = worldToScreen(polyEntity.points[i][0], polyEntity.points[i][1]);
            if (Math.hypot(sx - pointPos.x, sy - pointPos.y) < HANDLE_HIT_SIZE) {
              return { type: 'handle', id: entity.id, handleType: 'point', pointIndex: i };
            }
          }

          // Check edge midpoint handles
          const edges = getEdgeInfo(polyEntity.points);
          for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const screenMid = worldToScreen(edge.midpoint.x, edge.midpoint.y);
            if (Math.hypot(sx - screenMid.x, sy - screenMid.y) < HANDLE_HIT_SIZE) {
              return { type: 'handle', id: entity.id, handleType: 'edge', edgeIndex: i };
            }
          }
        }
      }
    }
    
    // Check balls
    for (const ball of level.balls) {
      const pos = ballPositions[ball.id];
      if (!pos) continue;
      
      const dist = Math.hypot(world.x - pos.x, world.y - pos.y);
      if (dist < BALL_RADIUS) {
        return { type: 'ball', id: ball.id };
      }
    }
    
    // Check entities (click to select)
    for (const entity of (level.entities || []).slice().reverse()) {
      if (entity.shape === 'circle') {
        const circleEntity = entity as WallCircleEntity;
        const dist = Math.hypot(world.x - circleEntity.cx, world.y - circleEntity.cy);
        if (dist < circleEntity.radius) {
          return { type: 'entity', id: entity.id };
        }
      } else if (entity.shape === 'rect') {
        const rectEntity = entity as WallRectEntity;
        if (world.x >= rectEntity.x && world.x <= rectEntity.x + rectEntity.width &&
            world.y >= rectEntity.y && world.y <= rectEntity.y + rectEntity.height) {
          return { type: 'entity', id: entity.id };
        }
      } else if (entity.shape === 'polygon') {
        const polyEntity = entity as WallPolygonEntity;
        if (pointInPolygon(world.x, world.y, polyEntity.points)) {
          return { type: 'entity', id: entity.id };
        }
      }
    }

    // Zones are ground: they lose every overlap, so they are tested after the
    // wells and areas below. (Their own handles were tested first, above.)
    const zoneHit = (): { type: 'zone'; id: string; zoneIndex: number } | null => {
      const zones = level.fenceZones || [];
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (world.x >= z.x && world.x <= z.x + z.width && world.y >= z.y && world.y <= z.y + z.height) {
          return { type: 'zone', id: '', zoneIndex: i };
        }
      }
      return null;
    };

    // Wells before areas, matching the draw order: a well sits on top, so it
    // must take the click when the two overlap.
    const wells = level.gravityWells || [];
    for (let i = wells.length - 1; i >= 0; i--) {
      const w = wells[i];
      if (world.x >= w.x && world.x <= w.x + w.width && world.y >= w.y && world.y <= w.y + w.height) {
        return { type: 'well', id: '', wellIndex: i };
      }
    }

    // Areas are checked last: they're big backdrops, so anything drawn on top of
    // one (obstacle, ball) must stay clickable.
    const areas = level.coloredAreas || [];
    for (let i = areas.length - 1; i >= 0; i--) {
      const a = areas[i];
      if (world.x >= a.x && world.x <= a.x + a.width && world.y >= a.y && world.y <= a.y + a.height) {
        return { type: 'area', id: '', areaIndex: i };
      }
    }

    return zoneHit();
  }, [boardRect, level, selectedEntityId, selectedAreaIndex, selectedWellIndex, selectedZoneIndex, ballPositions, worldToScreen, screenToWorld, getEdgeInfo, authoredOutline]);

  // Mouse handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!boardRect) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Middle button pans. Left is already spoken for by every editing gesture
    // on the board, so panning needs a button of its own rather than a
    // modifier that would collide with multi-select later.
    if (e.button === 1) {
      e.preventDefault();
      const { sx, sy } = getCanvasCoords(e);
      panRef.current = { sx, sy, panX: view.panX, panY: view.panY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Capture pointer so drag events continue even if pointer leaves canvas
    canvas.setPointerCapture(e.pointerId);

    const { sx, sy } = getCanvasCoords(e);
    const world = screenToWorld(sx, sy);
    
    const hit = hitTest(sx, sy);
    
    if (!hit) {
      onSelectEntity(null);
      onSelectBall(null);
      onSelectArea(null);
      onSelectWell?.(null);
      return;
    }

    // Removed early return - let entity click fall through to normal handling below
    // This allows both selection AND drag to work on first click

    if (hit.type === 'well-handle' && hit.wellIndex !== undefined) {
      const well = (level.gravityWells || [])[hit.wellIndex];
      if (well) {
        const originalRect = { x: well.x, y: well.y, width: well.width, height: well.height };
        setDragMode(hit.handleType === 'move'
          ? { type: 'well', index: hit.wellIndex, startX: world.x, startY: world.y, originalRect }
          : { type: 'well-resize', index: hit.wellIndex, handle: hit.rectHandle!, startX: world.x, startY: world.y, originalRect });
      }
      return;
    }

    if (hit.type === 'zone-handle' && hit.zoneIndex !== undefined) {
      const zone = (level.fenceZones || [])[hit.zoneIndex];
      if (zone) {
        const originalRect = { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
        setDragMode(hit.handleType === 'move'
          ? { type: 'zone', index: hit.zoneIndex, startX: world.x, startY: world.y, originalRect }
          : { type: 'zone-resize', index: hit.zoneIndex, handle: hit.rectHandle!, startX: world.x, startY: world.y, originalRect });
      }
      return;
    }

    if (hit.type === 'zone' && hit.zoneIndex !== undefined) {
      onSelectZone?.(hit.zoneIndex);
      onSelectEntity(null);
      onSelectBall(null);
      onSelectArea(null);
      onSelectWell?.(null);
      const zone = (level.fenceZones || [])[hit.zoneIndex];
      if (zone) {
        setDragMode({
          type: 'zone', index: hit.zoneIndex, startX: world.x, startY: world.y,
          originalRect: { x: zone.x, y: zone.y, width: zone.width, height: zone.height },
        });
      }
      return;
    }

    if (hit.type === 'well' && hit.wellIndex !== undefined) {
      onSelectWell?.(hit.wellIndex);
      onSelectEntity(null);
      onSelectBall(null);
      onSelectArea(null);
      const well = (level.gravityWells || [])[hit.wellIndex];
      if (well) {
        setDragMode({
          type: 'well', index: hit.wellIndex, startX: world.x, startY: world.y,
          originalRect: { x: well.x, y: well.y, width: well.width, height: well.height },
        });
      }
      return;
    }

    if (hit.type === 'area-handle' && hit.areaIndex !== undefined) {
      const area = (level.coloredAreas || [])[hit.areaIndex];
      if (area) {
        const originalRect = { x: area.x, y: area.y, width: area.width, height: area.height };
        setDragMode(
          hit.handleType === 'move'
            ? { type: 'area', index: hit.areaIndex, startX: world.x, startY: world.y, originalRect }
            : { type: 'area-resize', index: hit.areaIndex, handle: hit.rectHandle ?? 'br', startX: world.x, startY: world.y, originalRect },
        );
      }
    } else if (hit.type === 'area' && hit.areaIndex !== undefined) {
      onSelectArea(hit.areaIndex);
      const area = (level.coloredAreas || [])[hit.areaIndex];
      if (area) {
        setDragMode({
          type: 'area',
          index: hit.areaIndex,
          startX: world.x,
          startY: world.y,
          originalRect: { x: area.x, y: area.y, width: area.width, height: area.height },
        });
      }
    } else if (hit.type === 'handle') {
      if (hit.handleType === 'mover-end') {
        setDragMode({ type: 'mover-end', id: hit.id });
      } else if (hit.handleType === 'move') {
        // Move handle - start dragging the entity
        const entity = (level.entities || []).find(e => e.id === hit.id);
        if (entity) {
          setDragMode({
            type: 'entity',
            id: hit.id,
            startX: world.x,
            startY: world.y,
            originalEntity: JSON.parse(JSON.stringify(entity)) as LevelEntity,
          });
        }
      } else if (hit.handleType === 'radius') {
        const entity = (level.entities || []).find(e => e.id === hit.id) as WallCircleEntity;
        if (entity) {
          const dist = Math.hypot(world.x - entity.cx, world.y - entity.cy);
          setDragMode({
            type: 'circle-radius',
            id: hit.id,
            startDistance: dist,
            originalRadius: entity.radius,
          });
        }
      } else if (hit.handleType === 'rect' && hit.rectHandle) {
        const entity = (level.entities || []).find(e => e.id === hit.id) as WallRectEntity;
        if (entity) {
          setDragMode({
            type: 'rect-resize',
            id: hit.id,
            handle: hit.rectHandle as 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r',
            startX: world.x,
            startY: world.y,
            originalRect: { x: entity.x, y: entity.y, width: entity.width, height: entity.height },
          });
        }
      } else if (hit.handleType === 'angle') {
        setDragMode({ type: 'angle', id: hit.id });
      } else if (hit.handleType === 'bend') {
        setDragMode({ type: 'bend', id: hit.id });
      } else if (hit.handleType === 'curve' && hit.edgeIndex !== undefined) {
        setDragMode({ type: 'curve', id: hit.id, edgeIndex: hit.edgeIndex });
      } else if (hit.handleType === 'point' && hit.pointIndex !== undefined) {
        setDragMode({
          type: 'polygon-point',
          id: hit.id,
          pointIndex: hit.pointIndex,
          startX: world.x,
          startY: world.y,
        });
      } else if (hit.handleType === 'edge' && hit.edgeIndex !== undefined) {
        const entity = (level.entities || []).find(e => e.id === hit.id) as WallPolygonEntity;
        if (entity) {
          setDragMode({
            type: 'polygon-edge',
            id: hit.id,
            edgeIndex: hit.edgeIndex,
            startX: world.x,
            startY: world.y,
            originalPoints: entity.points.map(p => [...p] as [number, number]),
          });
        }
      }
    } else if (hit.type === 'entity') {
      // onSelectEntity already clears ball selection in parent
      onSelectEntity(hit.id);
      // Always allow drag-to-move (body click = move, handles = resize)
      const entity = (level.entities || []).find(e => e.id === hit.id);
      if (entity) {
        setDragMode({
          type: 'entity',
          id: hit.id,
          startX: world.x,
          startY: world.y,
          originalEntity: JSON.parse(JSON.stringify(entity)) as LevelEntity,
        });
      }
    } else if (hit.type === 'ball') {
      // onSelectBall already clears entity selection in parent
      onSelectBall(hit.id);
      
      const pos = ballPositions[hit.id];
      if (pos) {
        setDragMode({
          type: 'ball',
          id: hit.id,
          startX: world.x,
          startY: world.y,
          originalX: pos.x,
          originalY: pos.y,
        });
      }
    }
  }, [boardRect, hitTest, level, ballPositions, screenToWorld, getCanvasCoords, onSelectEntity, onSelectBall, onSelectArea, onSelectWell, onSelectZone, selectedEntityId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Panning runs before the drag check: it is not an edit, so it has no
    // dragMode, and gating it behind one would make the middle button dead.
    if (panRef.current) {
      const { sx, sy } = getCanvasCoords(e);
      const p = panRef.current;
      setView(v => ({ ...v, panX: p.panX + (sx - p.sx), panY: p.panY + (sy - p.sy) }));
      return;
    }
    if (dragMode.type === 'none' || !boardRect) return;

    const { sx, sy } = getCanvasCoords(e);
    const world = screenToWorld(sx, sy);
    
    if (dragMode.type === 'mover-end') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id);
      if (entity && isMoverEntity(entity)) {
        const home = moverHome(entity);
        // Flip the axis when the drag is mostly the other way. Setting the axis
        // in the panel and then discovering in the canvas that the path now
        // runs through a wall is exactly the round trip this replaces.
        const axis = axisFromDelta(world.x - home.x, world.y - home.y);
        onUpdateEntity(dragMode.id, {
          axis,
          range: snap(rangeFromHandle(home, world, axis)),
        } as Partial<LevelEntity>);
      }
      return;
    }

    if (dragMode.type === 'entity') {
      const dx = world.x - dragMode.startX;
      const dy = world.y - dragMode.startY;
      const original = dragMode.originalEntity;
      
      if (original.shape === 'circle') {
        const circleOriginal = original as WallCircleEntity;
        onUpdateEntity(dragMode.id, {
          cx: snap(circleOriginal.cx + dx),
          cy: snap(circleOriginal.cy + dy),
        });
      } else if (original.shape === 'rect') {
        const rectOriginal = original as WallRectEntity;
        onUpdateEntity(dragMode.id, {
          x: snap(rectOriginal.x + dx),
          y: snap(rectOriginal.y + dy),
        });
      } else if (original.shape === 'polygon') {
        const polyOriginal = original as WallPolygonEntity;
        onUpdateEntity(dragMode.id, {
          points: polyOriginal.points.map(([x, y]) => [snap(x + dx), snap(y + dy)] as [number, number]),
        });
      }
    } else if (dragMode.type === 'ball') {
      const dx = world.x - dragMode.startX;
      const dy = world.y - dragMode.startY;
      const newX = Math.max(BALL_RADIUS, Math.min(BOARD_WIDTH - BALL_RADIUS, dragMode.originalX + dx));
      const newY = Math.max(BALL_RADIUS, Math.min(BOARD_HEIGHT - BALL_RADIUS, dragMode.originalY + dy));
      // Update ball position in level config
      onUpdateBall(dragMode.id, {
        startX: snap(newX),
        startY: snap(newY)
      });
    } else if (dragMode.type === 'circle-radius') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id) as WallCircleEntity;
      if (entity) {
        const newRadius = Math.max(20, Math.hypot(world.x - entity.cx, world.y - entity.cy));
        onUpdateEntity(dragMode.id, { radius: snap(newRadius) });
      }
    } else if (dragMode.type === 'rect-resize') {
      const r = resizeRect(
        dragMode.originalRect,
        dragMode.handle,
        world.x - dragMode.startX,
        world.y - dragMode.startY,
        20,
      );
      onUpdateEntity(dragMode.id, {
        x: snap(r.x),
        y: snap(r.y),
        width: snap(r.width),
        height: snap(r.height),
      });
    } else if (dragMode.type === 'well') {
      const orig = dragMode.originalRect;
      onUpdateWell?.(dragMode.index, {
        x: snap(orig.x + (world.x - dragMode.startX)),
        y: snap(orig.y + (world.y - dragMode.startY)),
      });
    } else if (dragMode.type === 'well-resize') {
      const orig = dragMode.originalRect;
      const next = resizeRect(orig, dragMode.handle, world.x - dragMode.startX, world.y - dragMode.startY, AREA_MIN_SIZE);
      onUpdateWell?.(dragMode.index, {
        x: snap(next.x), y: snap(next.y), width: snap(next.width), height: snap(next.height),
      });
    } else if (dragMode.type === 'zone') {
      const orig = dragMode.originalRect;
      onUpdateZone?.(dragMode.index, {
        x: snap(orig.x + (world.x - dragMode.startX)),
        y: snap(orig.y + (world.y - dragMode.startY)),
      });
    } else if (dragMode.type === 'zone-resize') {
      const orig = dragMode.originalRect;
      const next = resizeRect(orig, dragMode.handle, world.x - dragMode.startX, world.y - dragMode.startY, AREA_MIN_SIZE);
      onUpdateZone?.(dragMode.index, {
        x: snap(next.x), y: snap(next.y), width: snap(next.width), height: snap(next.height),
      });
    } else if (dragMode.type === 'area') {
      const orig = dragMode.originalRect;
      onUpdateArea(dragMode.index, {
        x: snap(orig.x + (world.x - dragMode.startX)),
        y: snap(orig.y + (world.y - dragMode.startY)),
      });
    } else if (dragMode.type === 'area-resize') {
      const r = resizeRect(
        dragMode.originalRect,
        dragMode.handle,
        world.x - dragMode.startX,
        world.y - dragMode.startY,
        AREA_MIN_SIZE,
      );
      onUpdateArea(dragMode.index, {
        x: snap(r.x),
        y: snap(r.y),
        width: snap(r.width),
        height: snap(r.height),
      });
    } else if (dragMode.type === 'angle') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id);
      if (entity) {
        // 15-degree snap while snap-to-grid is on, which is what makes a
        // deliberate right angle land on 90 rather than 89.6.
        const deg = angleFromHandle(authoredOutline(entity), world, snapToGrid ? 15 : 0);
        onUpdateEntity(dragMode.id, { angle: deg === 0 ? undefined : deg });
      }
    } else if (dragMode.type === 'bend') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id);
      if (entity) {
        const authored = authoredOutline(entity);
        const bend = bendFromHandle({ points: authored, bendAxis: entity.bendAxis }, world);
        // Rounded, and dropped entirely at rest. A bend of 0.0000001 in map.yml
        // is noise that reads as intent, and a straight wall that has merely
        // been clicked must not start carrying a field.
        const rounded = Math.round(bend * 1000) / 1000;
        onUpdateEntity(dragMode.id, { bend: rounded === 0 ? undefined : rounded });
      }
    } else if (dragMode.type === 'curve') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id);
      if (entity && entity.shape === 'polygon') {
        const authored = authoredOutline(entity);
        const raw = curveFromHandle(authored, dragMode.edgeIndex, world);
        const clamped = Math.max(-MAX_BEND, Math.min(MAX_BEND, raw));
        const rounded = Math.round(clamped * 1000) / 1000;
        onUpdateEntity(dragMode.id, {
          curves: withCurve(entity.curves, authored.length, dragMode.edgeIndex, rounded),
        });
      }
    } else if (dragMode.type === 'polygon-point') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id) as WallPolygonEntity;
      if (entity) {
        const newPoints = [...entity.points];
        newPoints[dragMode.pointIndex] = [snap(world.x), snap(world.y)];
        onUpdateEntity(dragMode.id, { points: newPoints });
      }
    } else if (dragMode.type === 'polygon-edge') {
      const originalPoints = dragMode.originalPoints;
      const edgeIndex = dragMode.edgeIndex;
      const p1Index = edgeIndex;
      const p2Index = (edgeIndex + 1) % originalPoints.length;
      
      const p1 = originalPoints[p1Index];
      const p2 = originalPoints[p2Index];
      
      const edgeDx = p2[0] - p1[0];
      const edgeDy = p2[1] - p1[1];
      const edgeLen = Math.hypot(edgeDx, edgeDy);
      
      if (edgeLen > 0) {
        const normalX = -edgeDy / edgeLen;
        const normalY = edgeDx / edgeLen;
        
        const dx = world.x - dragMode.startX;
        const dy = world.y - dragMode.startY;
        const moveAlongNormal = dx * normalX + dy * normalY;
        
        const newPoints = originalPoints.map((p, i) => {
          if (i === p1Index || i === p2Index) {
            return [
              snap(p[0] + normalX * moveAlongNormal),
              snap(p[1] + normalY * moveAlongNormal),
            ] as [number, number];
          }
          return [...p] as [number, number];
        });
        
        onUpdateEntity(dragMode.id, { points: newPoints });
      }
    }
  }, [dragMode, boardRect, level, screenToWorld, getCanvasCoords, onUpdateEntity, onUpdateBall, onUpdateArea, onUpdateWell, onUpdateZone, snap, snapToGrid, authoredOutline]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
    setDragMode({ type: 'none' });
  }, []);

  /** Step the zoom about the centre of the view, for the buttons. */
  const zoomBy = useCallback((factor: number) => {
    const { w, h } = sizeRef.current;
    setView(v => zoomAboutPoint(v, v.zoom * factor, w / 2, h / 2, w, h));
  }, []);

  // Update cursor based on what's under the pointer
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');
  
  const handlePointerMoveWithCursor = useCallback((e: React.PointerEvent) => {
    handlePointerMove(e);
    
    // Update cursor when not dragging
    if (dragMode.type === 'none') {
      const { sx, sy } = getCanvasCoords(e);
      const hit = hitTest(sx, sy);
      
      if (hit) {
        if (hit.type === 'handle' || hit.type === 'area-handle') {
          if (hit.handleType === 'move') {
            setCursorStyle('move');
          } else if (hit.handleType === 'radius' || hit.handleType === 'rect') {
            setCursorStyle('nwse-resize');
          } else if (hit.handleType === 'point') {
            setCursorStyle('crosshair');
          } else if (hit.handleType === 'edge') {
            setCursorStyle('grab');
          }
        } else if (hit.type === 'entity' || hit.type === 'ball' || hit.type === 'area') {
          setCursorStyle('move');
        }
      } else {
        setCursorStyle('crosshair');
      }
    } else {
      setCursorStyle('grabbing');
    }
  }, [handlePointerMove, dragMode, hitTest, getCanvasCoords]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] bg-black/50 rounded-lg overflow-hidden">
      {/* Zoom controls. Buttons as well as the wheel, because the wheel does
          not exist on the phone this editor is used from. */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <button
          onClick={() => zoomBy(1 / 1.3)}
          title="Zoom out"
          className="flex items-center justify-center w-8 h-8 rounded bg-black/70 border border-white/15 text-white/80 hover:text-white"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => setView(FIT_VIEW)}
          title="Fit the whole board"
          className="px-2 h-8 rounded bg-black/70 border border-white/15 text-[11px] font-mono text-white/80 hover:text-white"
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button
          onClick={() => zoomBy(1.3)}
          title="Zoom in"
          className="flex items-center justify-center w-8 h-8 rounded bg-black/70 border border-white/15 text-white/80 hover:text-white"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: cursorStyle }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMoveWithCursor}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}

/** The eight resize-handle positions of a screen-space rect, in handle order. */
function rectHandlePositions(
  left: number,
  top: number,
  width: number,
  height: number,
): { pos: { x: number; y: number }; name: RectHandle }[] {
  return [
    { pos: { x: left, y: top }, name: 'tl' },
    { pos: { x: left + width, y: top }, name: 'tr' },
    { pos: { x: left, y: top + height }, name: 'bl' },
    { pos: { x: left + width, y: top + height }, name: 'br' },
    { pos: { x: left + width / 2, y: top }, name: 't' },
    { pos: { x: left + width / 2, y: top + height }, name: 'b' },
    { pos: { x: left, y: top + height / 2 }, name: 'l' },
    { pos: { x: left + width, y: top + height / 2 }, name: 'r' },
  ];
}

/** Apply a handle drag (dx/dy in world units) to a rect, clamped to a minimum size. */
function resizeRect(
  orig: { x: number; y: number; width: number; height: number },
  handle: RectHandle,
  dx: number,
  dy: number,
  minSize: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = orig;

  if (handle.includes('l')) { x = orig.x + dx; width = orig.width - dx; }
  if (handle.includes('r')) { width = orig.width + dx; }
  if (handle.includes('t')) { y = orig.y + dy; height = orig.height - dy; }
  if (handle.includes('b')) { height = orig.height + dy; }

  if (width < minSize) {
    if (handle.includes('l')) x = orig.x + orig.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes('t')) y = orig.y + orig.height - minSize;
    height = minSize;
  }
  return { x, y, width, height };
}

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

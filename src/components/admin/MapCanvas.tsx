import { useRef, useEffect, useState, useCallback } from 'react';
import { LevelConfig, LevelEntity, BallConfig, WallCircleEntity, WallPolygonEntity, WallRectEntity } from '@/types/level';
import { BOARD_WIDTH, BOARD_HEIGHT, BoardRect } from '@/lib/boardConstants';

interface MapCanvasProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  snapToGrid: boolean;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onUpdateEntity: (id: string, updates: Partial<LevelEntity>) => void;
  onUpdateBall: (id: string, updates: Partial<BallConfig>) => void;
}

const GRID_SIZE = 25;

const BALL_RADIUS = 25;
const HANDLE_SIZE = 16;
const HANDLE_HIT_SIZE = 20; // Larger hit area for easier clicking
const POINT_HANDLE_SIZE = 12;
const EDGE_HANDLE_SIZE = 10;

type DragMode = 
  | { type: 'none' }
  | { type: 'entity'; id: string; startX: number; startY: number; originalEntity: LevelEntity }
  | { type: 'ball'; id: string; startX: number; startY: number; originalX: number; originalY: number }
  | { type: 'circle-radius'; id: string; startDistance: number; originalRadius: number }
  | { type: 'polygon-point'; id: string; pointIndex: number; startX: number; startY: number }
  | { type: 'polygon-edge'; id: string; edgeIndex: number; startX: number; startY: number; originalPoints: [number, number][] }
  | { type: 'rect-resize'; id: string; handle: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r'; startX: number; startY: number; originalRect: { x: number; y: number; width: number; height: number } };

/**
 * Compute board rect for the Map Builder (no top UI offset like the game)
 */
function computeEditorBoardRect(containerWidth: number, containerHeight: number): BoardRect {
  const padding = 20;
  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;
  
  // Determine the largest square that fits
  const boardSize = Math.min(availableWidth, availableHeight);
  
  // Center in container
  const left = (containerWidth - boardSize) / 2;
  const top = (containerHeight - boardSize) / 2;
  
  // Scale factor: world units to screen pixels
  const scale = boardSize / BOARD_WIDTH;
  
  return {
    left,
    top,
    width: boardSize,
    height: boardSize,
    scale,
  };
}

export function MapCanvas({
  level,
  selectedEntityId,
  selectedBallId,
  snapToGrid,
  onSelectEntity,
  onSelectBall,
  onUpdateEntity,
  onUpdateBall,
}: MapCanvasProps) {
  const snap = useCallback((v: number) => snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v), [snapToGrid]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardRect, setBoardRect] = useState<BoardRect | null>(null);
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
      setBoardRect(computeEditorBoardRect(w, h));
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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

    // Draw entities
    (level.entities || []).forEach(entity => {
      // Consider entity selected if it matches selectedEntityId OR if we're dragging it
      const isDraggingThisEntity = dragMode.type !== 'none' && 'id' in dragMode && dragMode.id === entity.id;
      const isSelected = entity.id === selectedEntityId || isDraggingThisEntity;
      
      if (entity.shape === 'circle') {
        const circleEntity = entity as WallCircleEntity;
        const center = worldToScreen(circleEntity.cx, circleEntity.cy);
        const radius = circleEntity.radius * boardRect.scale;
        const isMirror = !!entity.mirror;

        ctx.fillStyle = isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
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

        const isMirror = !!entity.mirror;
        ctx.fillStyle = isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        ctx.fillRect(topLeft.x, topLeft.y, width, height);

        ctx.strokeStyle = isMirror
          ? (isSelected ? '#88ddff' : '#66bbdd')
          : (isSelected ? '#ff6b6b' : '#cc5555');
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
        
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
        const isMirror = !!entity.mirror;

        ctx.fillStyle = isMirror
          ? (isSelected ? 'rgba(136, 221, 255, 0.5)' : 'rgba(136, 221, 255, 0.3)')
          : (isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)');
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
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

  }, [level, boardRect, selectedEntityId, selectedBallId, ballPositions, worldToScreen, getEdgeInfo, dragMode]);

  // Hit testing
  const hitTest = useCallback((sx: number, sy: number): { type: 'entity' | 'ball' | 'handle'; id: string; handleType?: string; pointIndex?: number; edgeIndex?: number; rectHandle?: string } | null => {
    if (!boardRect) return null;
    
    const world = screenToWorld(sx, sy);
    
    // Check entity handles first (when selected)
    if (selectedEntityId) {
      const entity = (level.entities || []).find(e => e.id === selectedEntityId);
      if (entity) {
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
          const handles: { pos: { x: number; y: number }; name: string }[] = [
            { pos: { x: topLeft.x, y: topLeft.y }, name: 'tl' },
            { pos: { x: topLeft.x + width, y: topLeft.y }, name: 'tr' },
            { pos: { x: topLeft.x, y: topLeft.y + height }, name: 'bl' },
            { pos: { x: topLeft.x + width, y: topLeft.y + height }, name: 'br' },
            { pos: { x: topLeft.x + width / 2, y: topLeft.y }, name: 't' },
            { pos: { x: topLeft.x + width / 2, y: topLeft.y + height }, name: 'b' },
            { pos: { x: topLeft.x, y: topLeft.y + height / 2 }, name: 'l' },
            { pos: { x: topLeft.x + width, y: topLeft.y + height / 2 }, name: 'r' },
          ];

          for (const handle of handles) {
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
    
    return null;
  }, [boardRect, level, selectedEntityId, ballPositions, worldToScreen, screenToWorld, getEdgeInfo]);

  // Mouse handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!boardRect) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture pointer so drag events continue even if pointer leaves canvas
    canvas.setPointerCapture(e.pointerId);

    const { sx, sy } = getCanvasCoords(e);
    const world = screenToWorld(sx, sy);
    
    const hit = hitTest(sx, sy);
    
    if (!hit) {
      onSelectEntity(null);
      onSelectBall(null);
      return;
    }
    
    // Removed early return - let entity click fall through to normal handling below
    // This allows both selection AND drag to work on first click
    
    if (hit.type === 'handle') {
      if (hit.handleType === 'move') {
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
  }, [boardRect, hitTest, level, ballPositions, screenToWorld, getCanvasCoords, onSelectEntity, onSelectBall, selectedEntityId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode.type === 'none' || !boardRect) return;

    const { sx, sy } = getCanvasCoords(e);
    const world = screenToWorld(sx, sy);
    
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
      const orig = dragMode.originalRect;
      const handle = dragMode.handle;
      
      let newX = orig.x;
      let newY = orig.y;
      let newWidth = orig.width;
      let newHeight = orig.height;
      
      const dx = world.x - dragMode.startX;
      const dy = world.y - dragMode.startY;
      
      // Handle corners
      if (handle === 'tl') {
        newX = orig.x + dx;
        newY = orig.y + dy;
        newWidth = orig.width - dx;
        newHeight = orig.height - dy;
      } else if (handle === 'tr') {
        newY = orig.y + dy;
        newWidth = orig.width + dx;
        newHeight = orig.height - dy;
      } else if (handle === 'bl') {
        newX = orig.x + dx;
        newWidth = orig.width - dx;
        newHeight = orig.height + dy;
      } else if (handle === 'br') {
        newWidth = orig.width + dx;
        newHeight = orig.height + dy;
      } else if (handle === 't') {
        newY = orig.y + dy;
        newHeight = orig.height - dy;
      } else if (handle === 'b') {
        newHeight = orig.height + dy;
      } else if (handle === 'l') {
        newX = orig.x + dx;
        newWidth = orig.width - dx;
      } else if (handle === 'r') {
        newWidth = orig.width + dx;
      }
      
      // Ensure minimum size
      if (newWidth < 20) {
        if (handle.includes('l')) newX = orig.x + orig.width - 20;
        newWidth = 20;
      }
      if (newHeight < 20) {
        if (handle.includes('t')) newY = orig.y + orig.height - 20;
        newHeight = 20;
      }
      
      onUpdateEntity(dragMode.id, {
        x: snap(newX),
        y: snap(newY),
        width: snap(newWidth),
        height: snap(newHeight),
      });
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
  }, [dragMode, boardRect, level, screenToWorld, getCanvasCoords, onUpdateEntity, onUpdateBall, snap]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    setDragMode({ type: 'none' });
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
        if (hit.type === 'handle') {
          if (hit.handleType === 'move') {
            setCursorStyle('move');
          } else if (hit.handleType === 'radius' || hit.handleType === 'rect') {
            setCursorStyle('nwse-resize');
          } else if (hit.handleType === 'point') {
            setCursorStyle('crosshair');
          } else if (hit.handleType === 'edge') {
            setCursorStyle('grab');
          }
        } else if (hit.type === 'entity' || hit.type === 'ball') {
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
    <div ref={containerRef} className="w-full h-full min-h-[400px] bg-black/50 rounded-lg overflow-hidden">
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

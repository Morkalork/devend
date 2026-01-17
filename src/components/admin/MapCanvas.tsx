import { useRef, useEffect, useState, useCallback } from 'react';
import { LevelConfig, LevelEntity, BallConfig, ObstacleCircleEntity, ObstaclePolygonEntity } from '@/types/level';
import { BOARD_WIDTH, BOARD_HEIGHT, computeBoardRect, BoardRect } from '@/lib/boardConstants';

interface MapCanvasProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onUpdateEntity: (id: string, updates: Partial<LevelEntity>) => void;
  onUpdateBall: (id: string, updates: Partial<BallConfig>) => void;
}

const BALL_RADIUS = 25;
const HANDLE_SIZE = 12;
const POINT_HANDLE_SIZE = 10;
const EDGE_HANDLE_SIZE = 8;

type DragMode = 
  | { type: 'none' }
  | { type: 'entity'; id: string; startX: number; startY: number; originalEntity: LevelEntity }
  | { type: 'ball'; id: string; startX: number; startY: number; originalX: number; originalY: number }
  | { type: 'circle-radius'; id: string; startDistance: number; originalRadius: number }
  | { type: 'polygon-point'; id: string; pointIndex: number; startX: number; startY: number }
  | { type: 'polygon-edge'; id: string; edgeIndex: number; startX: number; startY: number; originalPoints: [number, number][] };

export function MapCanvas({
  level,
  selectedEntityId,
  selectedBallId,
  onSelectEntity,
  onSelectBall,
  onUpdateEntity,
  onUpdateBall,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardRect, setBoardRect] = useState<BoardRect | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>({ type: 'none' });
  
  // Ball positions (stored in editor state, not in level config)
  const [ballPositions, setBallPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Initialize ball positions
  useEffect(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    level.balls.forEach((ball, index) => {
      if (!ballPositions[ball.id]) {
        // Spread balls across the center of the board
        positions[ball.id] = {
          x: BOARD_WIDTH / 2 + (index - (level.balls.length - 1) / 2) * 80,
          y: BOARD_HEIGHT / 2,
        };
      } else {
        positions[ball.id] = ballPositions[ball.id];
      }
    });
    setBallPositions(positions);
  }, [level.balls]);

  // Resize handling
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      
      const container = containerRef.current;
      const rect = computeBoardRect(container.clientWidth, container.clientHeight);
      setBoardRect(rect);
      
      canvasRef.current.width = container.clientWidth;
      canvasRef.current.height = container.clientHeight;
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
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
      
      // Midpoint
      const midpoint = {
        x: (p1[0] + p2[0]) / 2,
        y: (p1[1] + p2[1]) / 2,
      };
      
      // Edge direction
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      
      // Perpendicular normal (pointing outward)
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 100;
    for (let x = 0; x <= BOARD_WIDTH; x += gridSize) {
      const sx = boardRect.left + x * boardRect.scale;
      ctx.beginPath();
      ctx.moveTo(sx, boardRect.top);
      ctx.lineTo(sx, boardRect.top + boardRect.height);
      ctx.stroke();
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += gridSize) {
      const sy = boardRect.top + y * boardRect.scale;
      ctx.beginPath();
      ctx.moveTo(boardRect.left, sy);
      ctx.lineTo(boardRect.left + boardRect.width, sy);
      ctx.stroke();
    }

    // Draw entities
    (level.entities || []).forEach(entity => {
      const isSelected = entity.id === selectedEntityId;
      
      if (entity.shape === 'circle') {
        const circleEntity = entity as ObstacleCircleEntity;
        const center = worldToScreen(circleEntity.cx, circleEntity.cy);
        const radius = circleEntity.radius * boardRect.scale;
        
        ctx.fillStyle = isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)';
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = isSelected ? '#ff6b6b' : '#cc5555';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        // Draw resize handles when selected (4 cardinal directions)
        if (isSelected) {
          const handlePositions = [
            { x: center.x + radius, y: center.y },      // Right
            { x: center.x - radius, y: center.y },      // Left
            { x: center.x, y: center.y - radius },      // Top
            { x: center.x, y: center.y + radius },      // Bottom
          ];
          
          handlePositions.forEach(pos => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(pos.x - HANDLE_SIZE/2, pos.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.strokeRect(pos.x - HANDLE_SIZE/2, pos.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
          });
        }
      } else if (entity.shape === 'polygon') {
        const polyEntity = entity as ObstaclePolygonEntity;
        const points = polyEntity.points.map(([x, y]) => worldToScreen(x, y));
        
        ctx.fillStyle = isSelected ? 'rgba(255, 100, 100, 0.5)' : 'rgba(255, 100, 100, 0.3)';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = isSelected ? '#ff6b6b' : '#cc5555';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        // Draw handles when selected
        if (isSelected) {
          // Draw edge midpoint handles (for resizing)
          const edges = getEdgeInfo(polyEntity.points);
          edges.forEach(edge => {
            const screenMid = worldToScreen(edge.midpoint.x, edge.midpoint.y);
            
            // Draw diamond shape for edge handles
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
          
          // Draw corner point handles (for moving vertices)
          points.forEach((p, i) => {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, POINT_HANDLE_SIZE, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Point index
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

  }, [level, boardRect, selectedEntityId, selectedBallId, ballPositions, worldToScreen, getEdgeInfo]);

  // Hit testing
  const hitTest = useCallback((sx: number, sy: number): { type: 'entity' | 'ball' | 'handle'; id: string; handleType?: string; pointIndex?: number; edgeIndex?: number } | null => {
    if (!boardRect) return null;
    
    const world = screenToWorld(sx, sy);
    
    // Check entity handles first (when selected)
    if (selectedEntityId) {
      const entity = (level.entities || []).find(e => e.id === selectedEntityId);
      if (entity) {
        if (entity.shape === 'circle') {
          const circleEntity = entity as ObstacleCircleEntity;
          const center = worldToScreen(circleEntity.cx, circleEntity.cy);
          const radius = circleEntity.radius * boardRect.scale;
          
          // Check all 4 cardinal handles
          const handlePositions = [
            { x: center.x + radius, y: center.y },
            { x: center.x - radius, y: center.y },
            { x: center.x, y: center.y - radius },
            { x: center.x, y: center.y + radius },
          ];
          
          for (const pos of handlePositions) {
            if (Math.abs(sx - pos.x) < HANDLE_SIZE && Math.abs(sy - pos.y) < HANDLE_SIZE) {
              return { type: 'handle', id: entity.id, handleType: 'radius' };
            }
          }
        } else if (entity.shape === 'polygon') {
          const polyEntity = entity as ObstaclePolygonEntity;
          
          // Check corner point handles first (higher priority)
          for (let i = 0; i < polyEntity.points.length; i++) {
            const pointPos = worldToScreen(polyEntity.points[i][0], polyEntity.points[i][1]);
            if (Math.hypot(sx - pointPos.x, sy - pointPos.y) < POINT_HANDLE_SIZE) {
              return { type: 'handle', id: entity.id, handleType: 'point', pointIndex: i };
            }
          }
          
          // Check edge midpoint handles
          const edges = getEdgeInfo(polyEntity.points);
          for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const screenMid = worldToScreen(edge.midpoint.x, edge.midpoint.y);
            if (Math.hypot(sx - screenMid.x, sy - screenMid.y) < EDGE_HANDLE_SIZE * 1.5) {
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
    
    // Check entities
    for (const entity of (level.entities || []).slice().reverse()) {
      if (entity.shape === 'circle') {
        const circleEntity = entity as ObstacleCircleEntity;
        const dist = Math.hypot(world.x - circleEntity.cx, world.y - circleEntity.cy);
        if (dist < circleEntity.radius) {
          return { type: 'entity', id: entity.id };
        }
      } else if (entity.shape === 'polygon') {
        const polyEntity = entity as ObstaclePolygonEntity;
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
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    
    const hit = hitTest(sx, sy);
    
    if (!hit) {
      onSelectEntity(null);
      onSelectBall(null);
      return;
    }
    
    if (hit.type === 'handle') {
      if (hit.handleType === 'radius') {
        const entity = (level.entities || []).find(e => e.id === hit.id) as ObstacleCircleEntity;
        if (entity) {
          const dist = Math.hypot(world.x - entity.cx, world.y - entity.cy);
          setDragMode({
            type: 'circle-radius',
            id: hit.id,
            startDistance: dist,
            originalRadius: entity.radius,
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
        const entity = (level.entities || []).find(e => e.id === hit.id) as ObstaclePolygonEntity;
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
      onSelectEntity(hit.id);
      onSelectBall(null);
      
      const entity = (level.entities || []).find(e => e.id === hit.id);
      if (entity) {
        setDragMode({
          type: 'entity',
          id: hit.id,
          startX: world.x,
          startY: world.y,
          originalEntity: { ...entity } as LevelEntity,
        });
      }
    } else if (hit.type === 'ball') {
      onSelectBall(hit.id);
      onSelectEntity(null);
      
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
  }, [boardRect, hitTest, level, ballPositions, screenToWorld, onSelectEntity, onSelectBall]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode.type === 'none' || !boardRect) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    
    if (dragMode.type === 'entity') {
      const dx = world.x - dragMode.startX;
      const dy = world.y - dragMode.startY;
      const original = dragMode.originalEntity;
      
      if (original.shape === 'circle') {
        const circleOriginal = original as ObstacleCircleEntity;
        onUpdateEntity(dragMode.id, {
          cx: circleOriginal.cx + dx,
          cy: circleOriginal.cy + dy,
        });
      } else if (original.shape === 'polygon') {
        const polyOriginal = original as ObstaclePolygonEntity;
        onUpdateEntity(dragMode.id, {
          points: polyOriginal.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
        });
      }
    } else if (dragMode.type === 'ball') {
      const dx = world.x - dragMode.startX;
      const dy = world.y - dragMode.startY;
      setBallPositions(prev => ({
        ...prev,
        [dragMode.id]: {
          x: Math.max(BALL_RADIUS, Math.min(BOARD_WIDTH - BALL_RADIUS, dragMode.originalX + dx)),
          y: Math.max(BALL_RADIUS, Math.min(BOARD_HEIGHT - BALL_RADIUS, dragMode.originalY + dy)),
        },
      }));
    } else if (dragMode.type === 'circle-radius') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id) as ObstacleCircleEntity;
      if (entity) {
        const newRadius = Math.max(20, Math.hypot(world.x - entity.cx, world.y - entity.cy));
        onUpdateEntity(dragMode.id, { radius: Math.round(newRadius) });
      }
    } else if (dragMode.type === 'polygon-point') {
      const entity = (level.entities || []).find(e => e.id === dragMode.id) as ObstaclePolygonEntity;
      if (entity) {
        const newPoints = [...entity.points];
        newPoints[dragMode.pointIndex] = [Math.round(world.x), Math.round(world.y)];
        onUpdateEntity(dragMode.id, { points: newPoints });
      }
    } else if (dragMode.type === 'polygon-edge') {
      // Move both vertices of the edge perpendicular to the edge direction
      const originalPoints = dragMode.originalPoints;
      const edgeIndex = dragMode.edgeIndex;
      const p1Index = edgeIndex;
      const p2Index = (edgeIndex + 1) % originalPoints.length;
      
      const p1 = originalPoints[p1Index];
      const p2 = originalPoints[p2Index];
      
      // Calculate edge direction and normal
      const edgeDx = p2[0] - p1[0];
      const edgeDy = p2[1] - p1[1];
      const edgeLen = Math.hypot(edgeDx, edgeDy);
      
      if (edgeLen > 0) {
        // Normal perpendicular to edge
        const normalX = -edgeDy / edgeLen;
        const normalY = edgeDx / edgeLen;
        
        // Calculate how far we've moved along the normal
        const dx = world.x - dragMode.startX;
        const dy = world.y - dragMode.startY;
        const moveAlongNormal = dx * normalX + dy * normalY;
        
        // Move both vertices along the normal
        const newPoints = originalPoints.map((p, i) => {
          if (i === p1Index || i === p2Index) {
            return [
              Math.round(p[0] + normalX * moveAlongNormal),
              Math.round(p[1] + normalY * moveAlongNormal),
            ] as [number, number];
          }
          return [...p] as [number, number];
        });
        
        onUpdateEntity(dragMode.id, { points: newPoints });
      }
    }
  }, [dragMode, boardRect, level, screenToWorld, onUpdateEntity]);

  const handlePointerUp = useCallback(() => {
    setDragMode({ type: 'none' });
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[400px] bg-black/50 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}

// Simple point-in-polygon test
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

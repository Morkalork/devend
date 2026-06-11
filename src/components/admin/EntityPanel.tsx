import { Plus, Trash2, Circle, Pentagon, Square, Copy } from 'lucide-react';
import { LevelConfig, LevelEntity, isMirrorEntity, BallConfig, WallCircleEntity, WallPolygonEntity, WallRectEntity } from '@/types/level';

interface EntityPanelProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onAddEntity: (type: 'circle' | 'polygon' | 'rect') => void;
  onAddBall: () => void;
  onDeleteEntity: (id: string) => void;
  onDuplicateEntity: (id: string) => void;
  onDeleteBall: (id: string) => void;
  onUpdateEntity: (id: string, updates: Partial<LevelEntity>) => void;
  onUpdateBall: (id: string, updates: Partial<BallConfig>) => void;
}

export function EntityPanel({
  level,
  selectedEntityId,
  selectedBallId,
  onSelectEntity,
  onSelectBall,
  onAddEntity,
  onAddBall,
  onDeleteEntity,
  onDuplicateEntity,
  onDeleteBall,
  onUpdateEntity,
  onUpdateBall,
}: EntityPanelProps) {
  const selectedEntity = (level.entities || []).find(e => e.id === selectedEntityId);
  const selectedBall = level.balls.find(b => b.id === selectedBallId);

  const getEntityIcon = (entity: LevelEntity) => {
    const color = isMirrorEntity(entity) ? 'text-cyan-400' : 'text-destructive';
    switch (entity.shape) {
      case 'circle': return <Circle className={`w-4 h-4 ${color}`} />;
      case 'rect': return <Square className={`w-4 h-4 ${color}`} />;
      default: return <Pentagon className={`w-4 h-4 ${color}`} />;
    }
  };

  const getShapeLabel = (shape: string) => {
    switch (shape) {
      case 'circle': return 'Circle';
      case 'rect': return 'Rectangle';
      case 'polygon': return 'Polygon';
      default: return shape;
    }
  };

  return (
    <div className="p-3 space-y-4">
      {/* Walls Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Obstacles</h3>
          <div className="flex gap-1">
            <button
              onClick={() => onAddEntity('rect')}
              className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors"
              title="Add Rectangle"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('circle')}
              className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors"
              title="Add Circle"
            >
              <Circle className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('polygon')}
              className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors"
              title="Add Polygon"
            >
              <Pentagon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        <div className="space-y-1">
          {(level.entities || []).map(entity => (
            <div
              key={entity.id}
              onClick={() => onSelectEntity(entity.id)}
              className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                entity.id === selectedEntityId
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-muted/50 hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                {getEntityIcon(entity)}
                <span className="text-sm">{entity.id}</span>
              </div>
              <div className="flex gap-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateEntity(entity.id);
                  }}
                  className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                  title="Duplicate"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteEntity(entity.id);
                  }}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {(level.entities || []).length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">
              No obstacles
            </div>
          )}
        </div>
      </div>

      {/* Selected Entity Details */}
      {selectedEntity && (
        <div className="p-2 rounded bg-muted/50 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            {getShapeLabel(selectedEntity.shape)} Properties
          </h4>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isMirrorEntity(selectedEntity)}
              onChange={(e) => onUpdateEntity(selectedEntity.id, { mirror: e.target.checked || undefined } as Partial<LevelEntity>)}
              className="rounded"
            />
            <span className="text-cyan-400">Mirror</span>
            <span className="text-muted-foreground">(reflects fences)</span>
          </label>

          {selectedEntity.shape === 'circle' && (
            <CircleEditor
              entity={selectedEntity as WallCircleEntity}
              onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates)}
            />
          )}

          {selectedEntity.shape === 'rect' && (
            <RectEditor
              entity={selectedEntity as WallRectEntity}
              onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates)}
            />
          )}

          {selectedEntity.shape === 'polygon' && (
            <PolygonEditor
              entity={selectedEntity as WallPolygonEntity}
              onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates)}
            />
          )}
        </div>
      )}

      {/* Balls Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Balls</h3>
          <button
            onClick={onAddBall}
            className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors"
            title="Add Ball"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        
        <div className="space-y-1">
          {level.balls.map(ball => (
            <div
              key={ball.id}
              onClick={() => onSelectBall(ball.id)}
              className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                ball.id === selectedBallId
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-muted/50 hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: `#${ball.color}` }}
                />
                <span className="text-sm">{ball.id}</span>
              </div>
              {level.balls.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBall(ball.id);
                  }}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Selected Ball Details */}
      {selectedBall && (
        <div className="p-2 rounded bg-muted/50 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Ball Properties</h4>
          <BallEditor
            ball={selectedBall}
            onUpdate={(updates) => onUpdateBall(selectedBall.id, updates)}
          />
        </div>
      )}
    </div>
  );
}

function CircleEditor({ entity, onUpdate }: { entity: WallCircleEntity; onUpdate: (updates: Partial<WallCircleEntity>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <label className="space-y-1">
        <span className="text-muted-foreground">Center X</span>
        <input
          type="number"
          value={Math.round(entity.cx)}
          onChange={(e) => onUpdate({ cx: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Center Y</span>
        <input
          type="number"
          value={Math.round(entity.cy)}
          onChange={(e) => onUpdate({ cy: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1 col-span-2">
        <span className="text-muted-foreground">Radius</span>
        <input
          type="number"
          value={Math.round(entity.radius)}
          onChange={(e) => onUpdate({ radius: Math.max(20, Number(e.target.value)) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
    </div>
  );
}

function RectEditor({ entity, onUpdate }: { entity: WallRectEntity; onUpdate: (updates: Partial<WallRectEntity>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <label className="space-y-1">
        <span className="text-muted-foreground">X</span>
        <input
          type="number"
          value={Math.round(entity.x)}
          onChange={(e) => onUpdate({ x: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Y</span>
        <input
          type="number"
          value={Math.round(entity.y)}
          onChange={(e) => onUpdate({ y: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Width</span>
        <input
          type="number"
          value={Math.round(entity.width)}
          onChange={(e) => onUpdate({ width: Math.max(20, Number(e.target.value)) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Height</span>
        <input
          type="number"
          value={Math.round(entity.height)}
          onChange={(e) => onUpdate({ height: Math.max(20, Number(e.target.value)) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
    </div>
  );
}

function PolygonEditor({ entity, onUpdate }: { entity: WallPolygonEntity; onUpdate: (updates: Partial<WallPolygonEntity>) => void }) {
  const addPoint = () => {
    if (entity.points.length < 2) return;
    const lastPoint = entity.points[entity.points.length - 1];
    const secondLastPoint = entity.points[entity.points.length - 2];
    const newPoint: [number, number] = [
      lastPoint[0] + (lastPoint[0] - secondLastPoint[0]) / 2,
      lastPoint[1] + (lastPoint[1] - secondLastPoint[1]) / 2,
    ];
    onUpdate({ points: [...entity.points, newPoint] });
  };

  const removePoint = (index: number) => {
    if (entity.points.length <= 3) return;
    onUpdate({ points: entity.points.filter((_, i) => i !== index) });
  };

  const updatePoint = (index: number, x: number, y: number) => {
    const newPoints = [...entity.points];
    newPoints[index] = [x, y];
    onUpdate({ points: newPoints });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Points ({entity.points.length})</span>
        <button
          onClick={addPoint}
          className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-xs"
        >
          Add Point
        </button>
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {entity.points.map((point, index) => (
          <div key={index} className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs w-4">{index + 1}</span>
            <input
              type="number"
              value={Math.round(point[0])}
              onChange={(e) => updatePoint(index, Number(e.target.value), point[1])}
              className="flex-1 px-1 py-0.5 rounded bg-background border border-border text-xs"
            />
            <input
              type="number"
              value={Math.round(point[1])}
              onChange={(e) => updatePoint(index, point[0], Number(e.target.value))}
              className="flex-1 px-1 py-0.5 rounded bg-background border border-border text-xs"
            />
            {entity.points.length > 3 && (
              <button
                onClick={() => removePoint(index)}
                className="p-0.5 rounded hover:bg-destructive/20 text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BallEditor({ ball, onUpdate }: { ball: BallConfig; onUpdate: (updates: Partial<BallConfig>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <label className="space-y-1">
        <span className="text-muted-foreground">Start X</span>
        <input
          type="number"
          value={ball.startX ?? ''}
          placeholder="auto"
          onChange={(e) => onUpdate({ startX: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Start Y</span>
        <input
          type="number"
          value={ball.startY ?? ''}
          placeholder="auto"
          onChange={(e) => onUpdate({ startY: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Initial Speed</span>
        <input
          type="number"
          value={ball.initialSpeed}
          onChange={(e) => onUpdate({ initialSpeed: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground">Top Speed</span>
        <input
          type="number"
          value={ball.topSpeed}
          onChange={(e) => onUpdate({ topSpeed: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded bg-background border border-border"
        />
      </label>
      <label className="space-y-1 col-span-2">
        <span className="text-muted-foreground">Color (hex without #)</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={ball.color}
            onChange={(e) => onUpdate({ color: e.target.value.replace('#', '') })}
            className="flex-1 px-2 py-1 rounded bg-background border border-border"
            maxLength={6}
          />
          <div className="relative w-8 h-8">
            <div
              className="w-8 h-8 rounded border border-border cursor-pointer"
              style={{ backgroundColor: `#${ball.color}` }}
            />
            <input
              type="color"
              value={`#${ball.color}`}
              onChange={(e) => onUpdate({ color: e.target.value.slice(1) })}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        </div>
      </label>
    </div>
  );
}

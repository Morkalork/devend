import { Plus, Trash2, Circle, Pentagon, Square, Copy, SquareDashed,
  ArrowDownToLine, ArrowUpToLine, ArrowLeftToLine, ArrowRightToLine,
  MoveHorizontal, MoveVertical, CircleDot, Timer } from 'lucide-react';
import { AreaKind, ColoredArea, LevelConfig, LevelEntity, isMirrorEntity, BallConfig, WallCircleEntity, WallPolygonEntity, WallRectEntity, GravityWell, WellPull } from '@/types/level';
import { AREA_KINDS, AREA_MIN_SIZE, areaStyle } from '@/lib/coloredAreas';
import {
  isMoverEntity, moverPath, moverTraverseSeconds, moverEscapesBoard,
  DEFAULT_MOVER_RANGE, DEFAULT_MOVER_SPEED,
} from '@/lib/moverPath';
import { BOARD_WIDTH } from '@/lib/boardConstants';
import { ARENA_MARGIN } from '@/lib/gameConstants';
import type { LevelMoverEntity } from '@/types/level';

/** The four bearings, laid out the way they point. */
const PULL_ORDER: WellPull[] = ['up', 'left', 'down', 'right'];
const PULL_ICON: Record<WellPull, typeof ArrowDownToLine> = {
  down: ArrowDownToLine,
  up: ArrowUpToLine,
  left: ArrowLeftToLine,
  right: ArrowRightToLine,
};

interface EntityPanelProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  selectedAreaIndex: number | null;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onSelectArea: (index: number | null) => void;
  onAddEntity: (type: 'circle' | 'polygon' | 'rect' | 'mover-rect' | 'mover-circle') => void;
  onAddBall: () => void;
  onAddArea: (kind: AreaKind) => void;
  onDeleteEntity: (id: string) => void;
  onDuplicateEntity: (id: string) => void;
  onDeleteBall: (id: string) => void;
  onDeleteArea: (index: number) => void;
  onUpdateEntity: (id: string, updates: Partial<LevelEntity>) => void;
  onUpdateBall: (id: string, updates: Partial<BallConfig>) => void;
  onUpdateArea: (index: number, updates: Partial<ColoredArea>) => void;
  /** Gravity wells (issue #77): authored patches that bend a ball downward. */
  selectedWellIndex?: number | null;
  onSelectWell?: (index: number | null) => void;
  onAddWell?: () => void;
  onDeleteWell?: (index: number) => void;
  onUpdateWell?: (index: number, updates: Partial<GravityWell>) => void;
}

export function EntityPanel({
  level,
  selectedEntityId,
  selectedBallId,
  selectedAreaIndex,
  selectedWellIndex = null,
  onSelectWell,
  onAddWell,
  onDeleteWell,
  onUpdateWell,
  onSelectEntity,
  onSelectBall,
  onSelectArea,
  onAddEntity,
  onAddBall,
  onAddArea,
  onDeleteEntity,
  onDuplicateEntity,
  onDeleteBall,
  onDeleteArea,
  onUpdateEntity,
  onUpdateBall,
  onUpdateArea,
}: EntityPanelProps) {
  const selectedEntity = (level.entities || []).find(e => e.id === selectedEntityId);
  const selectedBall = level.balls.find(b => b.id === selectedBallId);
  const areas = level.coloredAreas || [];
  const selectedArea = selectedAreaIndex !== null ? areas[selectedAreaIndex] : undefined;

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
      {/* Colored Areas Section — the required win gate (var / let / const) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Areas (win gate)</h3>
          <div className="flex gap-1">
            {(Object.keys(AREA_KINDS) as AreaKind[]).map(kind => (
              <button
                key={kind}
                onClick={() => onAddArea(kind)}
                className="px-2 py-1 rounded text-[11px] font-mono font-semibold transition-colors hover:brightness-125"
                style={{
                  color: AREA_KINDS[kind].color,
                  backgroundColor: `${AREA_KINDS[kind].color}22`,
                  border: `1px solid ${AREA_KINDS[kind].color}66`,
                }}
                title={`Add ${kind} area (x${AREA_KINDS[kind].multiplier})`}
              >
                + {kind}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {areas.map((area, index) => (
            <div
              key={index}
              onClick={() => onSelectArea(index)}
              className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                index === selectedAreaIndex
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-muted/50 hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                <SquareDashed className="w-4 h-4" style={{ color: areaStyle(area.kind).color }} />
                <span className="text-sm font-mono">{area.kind}</span>
                <span className="text-xs text-muted-foreground">
                  x{areaStyle(area.kind).multiplier} - {Math.round(area.width)}x{Math.round(area.height)}
                  {area.required === false && ' - bonus'}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteArea(index);
                }}
                className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {areas.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">
              No areas (map is won by clearing space)
            </div>
          )}
        </div>

      {/* Gravity wells (issue #77). Their own section rather than a kind of
          area: an area scores a lock, a well bends a ball, and conflating them
          in the UI would suggest they interact when they do not. */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Gravity Wells
          </h3>
          <button
            onClick={() => onAddWell?.()}
            className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/70 transition-colors"
            title="Add a gravity well"
          >
            + well
          </button>
        </div>

        <div className="space-y-1">
          {(level.gravityWells || []).map((well, index) => (
            <div
              key={index}
              onClick={() => onSelectWell?.(index)}
              className={`p-2 rounded cursor-pointer transition-colors ${
                index === selectedWellIndex
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-muted/50 hover:bg-muted'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    // The row icon points the way the well pulls, so a list of
                    // wells is readable without opening each one.
                    const Icon = PULL_ICON[well.pull ?? 'down'];
                    return <Icon className="w-4 h-4" style={{ color: '#ffa23c' }} />;
                  })()}
                  <span className="text-sm font-mono">well {index + 1}</span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(well.width)}x{Math.round(well.height)}
                  </span>
                  {well.activeFrom != null && (
                    <span
                      className="text-[10px] px-1 rounded bg-muted-foreground/20 text-muted-foreground"
                      title={`Dormant until ${well.activeFrom}% space remains`}
                    >
                      wakes {well.activeFrom}%
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteWell?.(index); }}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {index === selectedWellIndex && (
                <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {/* Strong and small beats weak and large: a gentle wide well
                        is a nudge nobody notices, a fierce narrow one is a
                        deflector you can aim a ball through. */}
                    <span className="w-16">bend</span>
                    <input
                      type="number" step="0.2" min="0.2" max="8"
                      value={well.turnRate ?? 2.8}
                      onChange={(e) => {
                        const v = Number.parseFloat(e.target.value);
                        if (Number.isFinite(v)) onUpdateWell?.(index, { turnRate: v });
                      }}
                      className="w-20 px-1 py-0.5 rounded bg-background border border-border font-mono"
                    />
                    <span className="opacity-70">rad/s</span>
                  </label>

                  {/* Direction, as four arrow buttons rather than a dropdown:
                      the choice IS a direction, so picking it should look like
                      pointing rather than like reading a list. */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-16">pulls</span>
                    <div className="flex gap-1">
                      {PULL_ORDER.map((dir) => {
                        const Icon = PULL_ICON[dir];
                        const on = (well.pull ?? 'down') === dir;
                        return (
                          <button
                            key={dir}
                            onClick={() => onUpdateWell?.(index, { pull: dir })}
                            title={dir}
                            className={`p-1 rounded transition-colors ${
                              on ? 'bg-primary/30 text-primary' : 'bg-muted hover:bg-muted/70'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dormancy. Blank means "live from the first frame", which is
                      why this is a text field with an explicit clear rather than
                      a number input whose empty state is indistinguishable
                      from 0 (and 0 means something: wakes only at a clean board). */}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-16">wakes at</span>
                    <input
                      type="number" step="5" min="0" max="100"
                      placeholder="always"
                      value={well.activeFrom ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') { onUpdateWell?.(index, { activeFrom: undefined }); return; }
                        const v = Number.parseFloat(raw);
                        if (Number.isFinite(v)) {
                          onUpdateWell?.(index, { activeFrom: Math.max(0, Math.min(100, v)) });
                        }
                      }}
                      className="w-20 px-1 py-0.5 rounded bg-background border border-border font-mono"
                    />
                    <span className="opacity-70">% space left</span>
                  </label>
                </div>
              )}
            </div>
          ))}
          {(level.gravityWells || []).length === 0 && (
            <p className="text-xs text-muted-foreground opacity-70">
              None. A well bends any ball inside it toward its pull.
            </p>
          )}
        </div>
      </div>
      </div>

      {/* Selected Area Details */}
      {selectedArea && selectedAreaIndex !== null && (
        <div className="p-2 rounded bg-muted/50 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Area Properties</h4>
          <AreaEditor
            area={selectedArea}
            onUpdate={(updates) => onUpdateArea(selectedAreaIndex, updates)}
          />
        </div>
      )}

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
            {/* Movers get their own pair rather than a checkbox on a wall: they
                are placed differently (the position you give them is the middle
                of a patrol, not a corner) and the canvas draws a whole path for
                them, so treating one as a wall with a flag hides the thing that
                actually needs looking at. */}
            <button
              onClick={() => onAddEntity('mover-rect')}
              className="p-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 transition-colors"
              title="Add moving rectangle"
            >
              <MoveHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('mover-circle')}
              className="p-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 transition-colors"
              title="Add moving circle"
            >
              <CircleDot className="w-3.5 h-3.5" />
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

          {isMoverEntity(selectedEntity) && (
            <MoverEditor
              entity={selectedEntity}
              onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates as Partial<LevelEntity>)}
            />
          )}

          {!isMoverEntity(selectedEntity) && (
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
          )}

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

function AreaEditor({ area, onUpdate }: { area: ColoredArea; onUpdate: (updates: Partial<ColoredArea>) => void }) {
  return (
    <div className="space-y-2">
      {/* Kind: var (easiest, draw biggest) < let < const (hardest, smallest) */}
      <div className="space-y-1 text-xs">
        <span className="text-muted-foreground">Kind</span>
        <div className="flex gap-1">
          {(Object.keys(AREA_KINDS) as AreaKind[]).map(kind => {
            const active = area.kind === kind;
            return (
              <button
                key={kind}
                onClick={() => onUpdate({ kind })}
                className="flex-1 px-2 py-1 rounded font-mono text-[11px] font-semibold transition-colors"
                style={{
                  color: active ? '#0b0b12' : AREA_KINDS[kind].color,
                  backgroundColor: active ? AREA_KINDS[kind].color : `${AREA_KINDS[kind].color}22`,
                  border: `1px solid ${AREA_KINDS[kind].color}${active ? 'ff' : '66'}`,
                }}
              >
                {kind}
                <span className="opacity-70"> x{AREA_KINDS[kind].multiplier}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-muted-foreground">X</span>
          <input
            type="number"
            value={Math.round(area.x)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Y</span>
          <input
            type="number"
            value={Math.round(area.y)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Width</span>
          <input
            type="number"
            value={Math.round(area.width)}
            onChange={(e) => onUpdate({ width: Math.max(AREA_MIN_SIZE, Number(e.target.value)) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Height</span>
          <input
            type="number"
            value={Math.round(area.height)}
            onChange={(e) => onUpdate({ height: Math.max(AREA_MIN_SIZE, Number(e.target.value)) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
      </div>

      {/* Gate vs bonus: the same rect, opposite stakes. */}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={area.required !== false}
          onChange={(e) => onUpdate({ required: e.target.checked ? undefined : false })}
          className="rounded mt-0.5"
        />
        <span>
          <span className="font-semibold">Win gate</span>
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {area.required !== false
              ? 'Required: lock the target ball (the boss on a boss map, else any ball) inside to win. Locking it outside fails the map.'
              : 'Bonus pocket: locking here pays the multiplier, but the map is won the normal way.'}
          </span>
        </span>
      </label>
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

/**
 * The mover editor: the two ends of the patrol, and how fast it walks them.
 *
 * Shows the resolved endpoints as read-only coordinates rather than asking for
 * them, because the runtime is centre-plus-range and inventing a second
 * representation here would mean two numbers that can disagree. What the panel
 * owes the author is the arithmetic they were doing in their head: where does
 * this thing actually GET to, and how long does it take to get there.
 */
function MoverEditor({ entity, onUpdate }: {
  entity: LevelMoverEntity;
  onUpdate: (updates: Partial<LevelMoverEntity>) => void;
}) {
  const path = moverPath(entity);
  const seconds = moverTraverseSeconds(entity);
  const escapes = moverEscapesBoard(entity, BOARD_WIDTH, BOARD_WIDTH * ARENA_MARGIN);
  const AxisIcon = entity.axis === 'horizontal' ? MoveHorizontal : MoveVertical;

  const pt = (p: { x: number; y: number }) => `${Math.round(p.x)}, ${Math.round(p.y)}`;

  return (
    <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
        <AxisIcon className="w-3.5 h-3.5" />
        Mover
      </div>

      {/* Axis. Also draggable on the canvas: pulling the end handle sideways or
          downwards flips this, so the path never has to be imagined. */}
      <div className="flex gap-1">
        {(['horizontal', 'vertical'] as const).map(axis => {
          const active = entity.axis === axis;
          const Icon = axis === 'horizontal' ? MoveHorizontal : MoveVertical;
          return (
            <button
              key={axis}
              onClick={() => onUpdate({ axis })}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                active
                  ? 'bg-amber-400 text-[#0b0b12] font-semibold'
                  : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
              }`}
            >
              <Icon className="w-3 h-3" />
              {axis === 'horizontal' ? 'Left / right' : 'Up / down'}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-muted-foreground">Travel</span>
          <input
            type="number"
            value={Math.round(entity.range)}
            onChange={(e) => onUpdate({ range: Math.max(0, Number(e.target.value)) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Speed (u/s)</span>
          <input
            type="number"
            value={Math.round(entity.speed)}
            onChange={(e) => onUpdate({ speed: Math.max(1, Number(e.target.value)) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
      </div>

      {/* Start point along the patrol. Two movers with the same travel and
          opposite phases make an alternating gate; identical phases make them
          one wide block, which is the mistake this slider exists to prevent. */}
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">
          Starts at {entity.phase === undefined || entity.phase === 0
            ? (entity.axis === 'horizontal' ? 'the left end' : 'the top end')
            : entity.phase === 1
              ? (entity.axis === 'horizontal' ? 'the right end' : 'the bottom end')
              : `${Math.round((entity.phase ?? 0) * 100)}% along`}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={entity.phase ?? 0}
          onChange={(e) => onUpdate({ phase: Number(e.target.value) })}
          className="w-full accent-amber-400"
        />
      </label>

      {/* The arithmetic the author was doing by hand. */}
      <div className="space-y-0.5 text-[11px] font-mono text-muted-foreground">
        <div className="flex justify-between">
          <span className="text-emerald-400">Start</span>
          <span>{pt(path.start)}</span>
        </div>
        <div className="flex justify-between">
          <span>{entity.axis === 'horizontal' ? 'Left end' : 'Top end'}</span>
          <span>{pt(path.min)}</span>
        </div>
        <div className="flex justify-between">
          <span>{entity.axis === 'horizontal' ? 'Right end' : 'Bottom end'}</span>
          <span>{pt(path.max)}</span>
        </div>
        <div className="flex justify-between pt-1 text-amber-400/90">
          <span className="flex items-center gap-1"><Timer className="w-3 h-3" />One way</span>
          <span>{seconds.toFixed(1)}s</span>
        </div>
      </div>

      {escapes && (
        <div className="rounded bg-destructive/20 border border-destructive/50 px-2 py-1 text-[11px] text-destructive">
          One end of this patrol is outside the play area. The home position can
          sit well inside it and the extreme still be half a travel past the wall.
        </div>
      )}

      <button
        onClick={() => onUpdate({ range: DEFAULT_MOVER_RANGE, speed: DEFAULT_MOVER_SPEED })}
        className="w-full px-2 py-1 rounded bg-muted hover:bg-muted/80 text-[11px] text-muted-foreground transition-colors"
        title={`Reset to the ladder median (travel ${DEFAULT_MOVER_RANGE}, speed ${DEFAULT_MOVER_SPEED})`}
      >
        Reset to ladder median
      </button>
    </div>
  );
}

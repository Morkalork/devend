import type { Bearing } from '@/lib/physics/obstacleRules';
import {
  muzzleVector, launcherRunway, MIN_LAUNCH_RUNWAY_FRACTION,
  type LauncherPlacement, type Blocker,
} from '@/lib/launcher';
import { Plus, Trash2, Circle, Pentagon, Square, Copy, SquareDashed,
  ArrowDownToLine, ArrowUpToLine, ArrowLeftToLine, ArrowRightToLine,
  MoveHorizontal, MoveVertical, CircleDot, Timer, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Zap, Target, Send, Rocket, Lock, Package, AlertTriangle } from 'lucide-react';
import { AreaKind, ColoredArea, LevelConfig, LevelEntity, isMirrorEntity, BallConfig, WallCircleEntity, WallPolygonEntity, WallRectEntity, GravityWell, WellPull } from '@/types/level';
import { AREA_KINDS, AREA_MIN_SIZE, areaStyle } from '@/lib/coloredAreas';
import {
  isMoverEntity, moverPath, moverTraverseSeconds, moverEscapesBoard,
  DEFAULT_MOVER_RANGE, DEFAULT_MOVER_SPEED,
} from '@/lib/moverPath';
import { BOARD_WIDTH } from '@/lib/boardConstants';
import { ARENA_MARGIN } from '@/lib/gameConstants';
import type { LevelMoverEntity } from '@/types/level';
import { withCurve, MAX_BEND } from "@/lib/admin/bendHandles";
import { getAllBallTypes } from '@/lib/ballTypes';
import { clampZoneSpeed, MIN_ZONE_SPEED, MAX_ZONE_SPEED, type FenceZone } from '@/lib/physics/fenceZones';
import { normaliseDegrees } from '@/lib/bendRotation';

/** The four bearings, laid out the way they point. */
const PULL_ORDER: WellPull[] = ['up', 'left', 'down', 'right'];
const PULL_ICON: Record<WellPull, typeof ArrowDownToLine> = {
  down: ArrowDownToLine,
  up: ArrowUpToLine,
  left: ArrowLeftToLine,
  right: ArrowRightToLine,
};

/**
 * Everything the palette can place.
 *
 * Exported and shared with MapBuilder rather than written out at both ends: the
 * two lists had already drifted once - the launcher, the delivery box and the
 * cage all existed as entity kinds, with property editors, and none of them
 * could be CREATED, so the only way to get one onto a map was to hand-edit the
 * YAML. A mechanic nobody can place is a mechanic nobody has.
 */
export type AddEntityType =
  | 'circle' | 'polygon' | 'rect'
  | 'mover-rect' | 'mover-circle'
  | 'bouncer' | 'kicker' | 'portal'
  | 'launcher' | 'cage' | 'box';

interface EntityPanelProps {
  level: LevelConfig;
  selectedEntityId: string | null;
  selectedBallId: string | null;
  selectedAreaIndex: number | null;
  onSelectEntity: (id: string | null) => void;
  onSelectBall: (id: string | null) => void;
  onSelectArea: (index: number | null) => void;
  onAddEntity: (type: AddEntityType) => void;
  onAddBall: () => void;
  onAddArea: (kind: AreaKind) => void;
  onDeleteEntity: (id: string) => void;
  onDuplicateEntity: (id: string) => void;
  onDeleteBall: (id: string) => void;
  onDeleteArea: (index: number) => void;
  selectedZoneIndex?: number | null;
  onSelectZone?: (index: number | null) => void;
  onAddZone?: () => void;
  onDeleteZone?: (index: number) => void;
  onUpdateZone?: (index: number, updates: Partial<FenceZone>) => void;
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
  selectedZoneIndex = null,
  onSelectZone,
  onAddZone,
  onDeleteZone,
  onUpdateZone,
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

        {/* The behaving objects, on their own row.
            Bumpers, portals, launchers and cages were all reachable ONLY by
            placing a plain shape and finding the right checkbox - and the
            launcher, the delivery box and the cage were not reachable at all,
            because no button created their kind. A mechanic nobody can place is
            a mechanic nobody has, which is exactly how it was reported. */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Machines</h3>
          <div className="flex gap-1">
            <button
              onClick={() => onAddEntity('bouncer')}
              className="p-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-colors"
              title="Add bumper (fires balls away; slows them 5% while it has overtime hours, kicks them faster once spent)"
            >
              <Target className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('kicker')}
              className="p-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-colors"
              title="Add kicker (a bumper that always fires the same way)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('portal')}
              className="p-1.5 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 transition-colors"
              title="Add a linked portal PAIR (a lone portal is inert)"
            >
              <CircleDot className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('launcher')}
              className="p-1.5 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 transition-colors"
              title="Add launcher (holds the map's balls until you fire them)"
            >
              <Rocket className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('cage')}
              className="p-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 transition-colors"
              title="Add cage (shuts behind a ball, opens on a timer)"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAddEntity('box')}
              className="p-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 transition-colors"
              title="Add delivery box (a one-way membrane; balls in are delivered)"
            >
              <Package className="w-3.5 h-3.5" />
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

          {(selectedEntity.kind === 'launcher' || selectedEntity.kind === 'box' || selectedEntity.kind === 'cage') && (
            <BearingEditor
              kind={selectedEntity.kind}
              bearing={selectedEntity.kind === 'box' ? selectedEntity.mouth : selectedEntity.facing}
              cup={selectedEntity.kind === 'launcher'
                ? (selectedEntity as unknown as LauncherPlacement) : undefined}
              blockers={(level.entities || [])
                .filter(e => e.id !== selectedEntity.id && e.shape === 'rect')
                .map(e => e as unknown as Blocker)}
              onUpdate={(bearing) => onUpdateEntity(
                selectedEntity.id,
                (selectedEntity.kind === 'box'
                  ? { mouth: bearing }
                  : { facing: bearing }) as Partial<LevelEntity>,
              )}
            />
          )}

          {/* Cage: how long a caught ball is held. */}
          {selectedEntity.kind === 'cage' && (
            <label className="flex items-center gap-2 text-xs">
              <span className="text-sky-400 whitespace-nowrap">Hold (sec)</span>
              <input
                type="number"
                value={selectedEntity.holdSeconds ?? ''}
                placeholder="12"
                onChange={(e) => onUpdateEntity(selectedEntity.id, {
                  holdSeconds: e.target.value === '' ? undefined : Number(e.target.value),
                } as Partial<LevelEntity>)}
                className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
              />
            </label>
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

          {!isMoverEntity(selectedEntity) && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!(selectedEntity as { bouncer?: boolean }).bouncer}
              onChange={(e) => onUpdateEntity(selectedEntity.id, { bouncer: e.target.checked || undefined } as Partial<LevelEntity>)}
              className="rounded"
            />
            <span className="text-amber-400">Bouncer</span>
            <span className="text-muted-foreground">(kicks balls away, faster)</span>
          </label>
          )}

          {/* Latch. Opens once, on progress, and stays open. */}
          {!isMoverEntity(selectedEntity) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-emerald-400 whitespace-nowrap">Latch after</span>
            <input
              type="number"
              value={(selectedEntity as { latchAfter?: number }).latchAfter ?? ''}
              placeholder="never"
              onChange={(e) => onUpdateEntity(selectedEntity.id, {
                latchAfter: e.target.value === '' ? undefined : Number(e.target.value),
              } as Partial<LevelEntity>)}
              className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
            <select
              value={(selectedEntity as { latchOn?: string }).latchOn ?? 'locks'}
              onChange={(e) => onUpdateEntity(selectedEntity.id, { latchOn: e.target.value } as Partial<LevelEntity>)}
              className="rounded border border-border bg-background px-1 py-0.5 text-xs"
            >
              <option value="locks">locks</option>
              <option value="smashes">smashes</option>
            </select>
          </div>
          )}

          {/* Portal. The link is the pairing: two obstacles sharing a link are
              two ends of one hole. A lone link is inert, which the map lint
              reports rather than the game swallowing balls into it. */}
          {!isMoverEntity(selectedEntity) && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-violet-400">Portal link</span>
            <input
              type="text"
              value={(selectedEntity as { portal?: string }).portal ?? ''}
              placeholder="blank = not a portal"
              onChange={(e) => onUpdateEntity(selectedEntity.id, { portal: e.target.value || undefined } as Partial<LevelEntity>)}
              className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
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

          <BendEditor
            entity={selectedEntity}
            onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates as Partial<LevelEntity>)}
          />

          {!isMoverEntity(selectedEntity) && (
            <PassRulesEditor
              entity={selectedEntity as WallRectEntity}
              onUpdate={(updates) => onUpdateEntity(selectedEntity.id, updates as Partial<LevelEntity>)}
            />
          )}
        </div>
      )}

      {/* Fence-speed ground: the only mechanic that acts on the CUT. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Fence ground</h3>
          <button
            onClick={onAddZone}
            className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors"
            title="Add a fence-speed zone"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          {(level.fenceZones ?? []).length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              None. A zone changes how fast fences build across it: below 1 slows the cut,
              above 1 speeds it.
            </p>
          )}
          {(level.fenceZones ?? []).map((zone, index) => (
            <div
              key={index}
              onClick={() => onSelectZone?.(index)}
              className={`p-2 rounded cursor-pointer transition-colors ${
                index === selectedZoneIndex
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-muted/50 hover:bg-muted'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: zone.speed < 1 ? '#7dd3fc' : '#fbbf24' }}>
                  {zone.speed < 1 ? 'Slow' : 'Fast'} ground {zone.speed}x
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteZone?.(index); }}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive"
                  title="Delete zone"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {index === selectedZoneIndex && (
                <div className="mt-2 space-y-1">
                  <label className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">Speed</span>
                    <input
                      type="range"
                      min={MIN_ZONE_SPEED}
                      max={MAX_ZONE_SPEED}
                      step={0.05}
                      value={zone.speed}
                      onChange={(e) => onUpdateZone?.(index, { speed: clampZoneSpeed(Number(e.target.value)) })}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      step={0.05}
                      value={zone.speed}
                      onChange={(e) => onUpdateZone?.(index, { speed: clampZoneSpeed(Number(e.target.value)) })}
                      className="w-14 px-1 py-0.5 rounded bg-background border border-border"
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    A cut is priced by its longer half, so this only bites when that half
                    crosses the zone.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

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

/**
 * Numbers for the two bend gestures, alongside the handles on the canvas.
 *
 * The canvas is where bending is actually done - you pull the shape and watch
 * it - but a map is a config file that gets hand-edited and diffed, so the
 * value has to be legible and typeable too. This is also the only place to
 * pin an axis: the handles read "auto", which follows the longer side, and a
 * bar that is nearly square needs to be told.
 */
/**
 * Walls that do not stop every ball: one-way membranes and ball-type gates.
 *
 * Both live here together because they are the same question - may this ball
 * pass - and because seeing them side by side is what stops someone setting
 * both and expecting an AND. The note in the panel says which it is.
 */
function PassRulesEditor({ entity, onUpdate }: {
  entity: WallRectEntity;
  onUpdate: (updates: Partial<WallRectEntity>) => void;
}) {
  const types = getAllBallTypes();
  const pass = entity.passTypes ?? [];

  const toggleType = (id: string) => {
    const next = pass.includes(id) ? pass.filter(t => t !== id) : [...pass, id];
    // Absent, not empty: an empty list must leave an ordinary solid wall, or a
    // half-finished edit silently ships a wall nothing can cross.
    onUpdate({ passTypes: next.length ? next : undefined });
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <span className="text-xs font-semibold text-sky-400">Pass rules</span>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground whitespace-nowrap">One-way</span>
        <select
          value={entity.oneWay ?? ''}
          onChange={(e) => onUpdate({
            oneWay: e.target.value ? e.target.value as 'up' | 'down' | 'left' | 'right' : undefined,
          })}
          className="flex-1 px-1 py-0.5 rounded bg-background border border-border"
        >
          <option value="">solid both ways</option>
          <option value="up">balls pass going up</option>
          <option value="down">balls pass going down</option>
          <option value="left">balls pass going left</option>
          <option value="right">balls pass going right</option>
        </select>
      </label>

      <div className="space-y-1">
        <span className="text-[10px] text-muted-foreground">
          Gate: ball types that may pass (either way)
        </span>
        <div className="flex flex-wrap gap-1">
          {types.map(t => {
            const on = pass.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleType(t.id)}
                title={on ? `${t.id} may pass` : `${t.id} bounces`}
                className="px-1.5 py-0.5 rounded text-[10px] border transition-colors"
                style={{
                  borderColor: on ? '#38bdf8' : 'transparent',
                  background: on ? '#38bdf833' : 'hsl(var(--muted))',
                  color: on ? '#7dd3fc' : 'hsl(var(--muted-foreground))',
                }}
              >
                {t.id}
              </button>
            );
          })}
        </div>
      </div>

      {(entity.oneWay || pass.length > 0) && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {entity.oneWay && pass.length > 0
            ? 'Either rule lets a ball through: the named types pass from both sides, and anything else passes only the one way.'
            : entity.oneWay
              ? 'Balls bounce coming the other way, so this is a funnel: drive one through and seal behind it.'
              : 'Only the named types pass. Everything else treats this as a solid wall.'}
        </p>
      )}
    </div>
  );
}

function BendEditor({ entity, onUpdate }: {
  entity: LevelEntity;
  onUpdate: (updates: Partial<LevelEntity>) => void;
}) {
  const bend = entity.bend ?? 0;
  const curves = entity.curves ?? [];
  const curved = curves.some(c => !!c);

  // Absent, not zero, for the same reason the bend is: an object nobody turned
  // should leave no trace in map.yml.
  const setAngle = (v: number) => {
    const d = normaliseDegrees(v);
    onUpdate({ angle: d === 0 ? undefined : d } as Partial<LevelEntity>);
  };

  // Absent, not zero: a straight wall should leave no trace in map.yml.
  const setBend = (v: number) => {
    const clamped = Math.max(-MAX_BEND, Math.min(MAX_BEND, v));
    const rounded = Math.round(clamped * 1000) / 1000;
    onUpdate({ bend: rounded === 0 ? undefined : rounded } as Partial<LevelEntity>);
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-amber-400 font-semibold whitespace-nowrap">Angle</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={entity.angle ?? 0}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          step={5}
          value={entity.angle ?? 0}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="w-16 px-1 py-0.5 rounded bg-background border border-border"
        />
      </label>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Degrees clockwise, turned about the object's own centre. Drag the amber knob on
        the canvas; snap-to-grid quantises it to 15.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-violet-400">Bend</span>
        {(bend !== 0 || curved || !!entity.angle) && (
          <button
            onClick={() => onUpdate({ bend: undefined, bendAxis: undefined, curves: undefined, angle: undefined } as Partial<LevelEntity>)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
            title="Straighten: remove the turn, the bow and every edge curve"
          >
            Straighten
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={-MAX_BEND}
          max={MAX_BEND}
          step={0.01}
          value={bend}
          onChange={(e) => setBend(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          step={0.05}
          value={bend}
          onChange={(e) => setBend(Number(e.target.value))}
          className="w-16 px-1 py-0.5 text-xs rounded bg-background border border-border"
        />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Axis</span>
        <select
          value={entity.bendAxis ?? 'auto'}
          onChange={(e) => onUpdate({
            bendAxis: e.target.value === 'auto' ? undefined : e.target.value as 'x' | 'y',
          } as Partial<LevelEntity>)}
          className="flex-1 px-1 py-0.5 rounded bg-background border border-border"
        >
          <option value="auto">auto (longer side)</option>
          <option value="x">across x</option>
          <option value="y">across y</option>
        </select>
      </label>

      {entity.shape === 'polygon' && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">
            Edge curves (drag the violet dots on the canvas)
          </span>
          <div className="grid grid-cols-4 gap-1">
            {entity.points.map((_, i) => (
              <input
                key={i}
                type="number"
                step={0.05}
                title={`Edge ${i + 1} to ${((i + 1) % entity.points.length) + 1}`}
                value={curves[i] ?? 0}
                onChange={(e) => onUpdate({
                  curves: withCurve(entity.curves, entity.points.length, i,
                    Math.max(-MAX_BEND, Math.min(MAX_BEND, Number(e.target.value)))),
                } as Partial<LevelEntity>)}
                className="w-full px-1 py-0.5 text-xs rounded bg-background border border-border"
              />
            ))}
          </div>
        </div>
      )}
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
/**
 * The one side that is different: a launcher's open muzzle, a box's membrane.
 *
 * Both are the same authored thing - a bearing naming one side of a rect - and
 * both are invisible in a plain rect editor, so a designer had to remember
 * which way `facing: right` pointed and check by playing the map. Shared
 * because they must never drift: they rotate through the same rule and a panel
 * that showed them differently would suggest they were different kinds of
 * field.
 */
/**
 * A heading in words, because degrees alone do not answer "is that into the
 * wall on my left". Eight points: finer would be false precision on a barrel a
 * designer turns by dragging.
 */
function headingWord(dir: { x: number; y: number }): string {
  const deg = ((Math.round((Math.atan2(dir.y, dir.x) * 180) / Math.PI) % 360) + 360) % 360;
  const NAMES = ['right', 'down-right', 'down', 'down-left',
                 'left', 'up-left', 'up', 'up-right'];
  return NAMES[Math.round(deg / 45) % 8];
}

function BearingEditor({ kind, bearing, cup, blockers = [], onUpdate }: {
  kind: 'launcher' | 'box' | 'cage';
  bearing: Bearing;
  /** The launcher itself, when this is one: needed to resolve where it FIRES. */
  cup?: LauncherPlacement;
  /** Everything a shot could run into. */
  blockers?: ReadonlyArray<Blocker>;
  onUpdate: (bearing: Bearing) => void;
}) {
  const label = kind === 'launcher' ? 'Fires out of'
    : kind === 'cage' ? 'Mouth on'
    : 'Membrane on';
  const ICON: Record<Bearing, typeof ArrowUp> = {
    up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight,
  };
  return (
    <div className="space-y-2 rounded border border-orange-400/40 bg-orange-400/10 p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-300">
        <Zap className="w-3.5 h-3.5" />
        {kind === 'launcher' ? 'Launcher' : kind === 'cage' ? 'Cage' : 'Delivery box'}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex gap-1">
        {(['up', 'down', 'left', 'right'] as const).map(b => {
          const active = bearing === b;
          const Icon = ICON[b];
          return (
            <button
              key={b}
              onClick={() => onUpdate(b)}
              className="flex-1 flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors"
              style={{
                color: active ? '#0b0b12' : '#fdba74',
                backgroundColor: active ? '#fdba74' : '#fdba7422',
                border: `1px solid #fdba74${active ? 'ff' : '66'}`,
              }}
              title={`${label} the ${b} side`}
            >
              <Icon className="w-3 h-3" />
              {b}
            </button>
          );
        })}
      </div>
      {kind === 'launcher' && cup && (() => {
        // The RESOLVED heading, not the facing. `facing` names the open side of
        // an unturned rect; the barrel's angle then moves it, so a launcher can
        // read "fires out of: right" and shoot at the floor. The compass and
        // the runway below are about where the ball actually goes.
        const dir = muzzleVector(cup.facing, cup.angle);
        const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
        // Screen bearing to a compass a person can picture: 0 is east, and y
        // grows downward, so a positive angle points DOWN the board.
        const compass = ((Math.round(deg) % 360) + 360) % 360;
        const runway = launcherRunway(cup, blockers, {
          width: BOARD_WIDTH, height: BOARD_WIDTH, margin: BOARD_WIDTH * ARENA_MARGIN,
        });
        const floor = BOARD_WIDTH * MIN_LAUNCH_RUNWAY_FRACTION;
        const blocked = runway < floor;
        return (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Fires at</span>
              <span className="font-mono tabular-nums text-orange-300">
                {compass}deg ({headingWord(dir)})
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Clear run</span>
              <span
                className="font-mono tabular-nums"
                style={{ color: blocked ? '#ff5b5b' : '#fdba74' }}
              >
                {Math.round(runway)}
              </span>
            </div>
            {blocked && (
              <div className="flex items-start gap-1 rounded bg-red-500/15 border border-red-500/40 p-1.5 text-[11px] text-red-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  A straight shot hits something after {Math.round(runway)} units.
                  The map opens by firing into a wall. Turn the barrel, move it,
                  or clear what is in front of it.
                </span>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              That side is left OPEN. The ball fires out within a 35 degree cone,
              and the power it is fired at multiplies the map's base pay.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

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
        {entity.motion === 'rotate' ? 'Rotor' : 'Mover'}
      </div>

      {/* Shuttle or rotor. A rotor ignores axis, range and phase entirely and
          reads `speed` as DEGREES per second, so the controls below are hidden
          for one rather than left on screen doing nothing. */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={entity.motion === 'rotate'}
          onChange={(e) => onUpdate({ motion: e.target.checked ? 'rotate' : undefined })}
          className="rounded"
        />
        <span className="text-amber-300">Rotor</span>
        <span className="text-muted-foreground">(pivots instead of sliding)</span>
      </label>

      {entity.motion === 'rotate' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Degrees / sec</span>
            <input
              type="number"
              value={Math.round(entity.speed)}
              onChange={(e) => onUpdate({ speed: Number(e.target.value) })}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
          </label>
          <label className="space-y-1">
            {/* Blank spins all the way round; a number makes it a wiper. */}
            <span className="text-[10px] text-muted-foreground">Sweep (deg, blank = full)</span>
            <input
              type="number"
              value={entity.sweepDegrees ?? ''}
              onChange={(e) => onUpdate({
                sweepDegrees: e.target.value === '' ? undefined : Number(e.target.value),
              })}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Pivot X (blank = centre)</span>
            <input
              type="number"
              value={entity.pivotX ?? ''}
              onChange={(e) => onUpdate({ pivotX: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Pivot Y (blank = centre)</span>
            <input
              type="number"
              value={entity.pivotY ?? ''}
              onChange={(e) => onUpdate({ pivotY: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
          </label>
        </div>
      )}

      {entity.motion !== 'rotate' && (<>
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
      </>)}

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

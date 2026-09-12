import { LevelConfig } from '@/types/level';
import { MIN_MAP_LIGHT } from "@/lib/rendering/sleek/boardWash";
import { ScoringPreviewPanel } from './ScoringPreviewPanel';
import { WinConditionsPanel } from './WinConditionsPanel';
import { areaShareOf, clampAreaShare, DEFAULT_COLORED_AREA_SHARE, MAX_COLORED_AREA_SHARE } from '@/lib/coloredAreaShare';
import { getMapMutators } from '@/lib/mapMutators';
import { BOARD_SIDES, type BoardEdgeSpecs, type BoardSide } from '@/lib/physics/boardEdges';

/**
 * Optional numeric field: blank deletes it, so "this map does not say" and
 * "this map says the default" stay different things in the YAML. `scale`
 * lets a 0..1 field be edited as a percentage.
 */
function OptionalNumber({
  level, field, label, min, max, step = 1, scale = 1, hint, onUpdateLevel,
}: {
  level: LevelConfig;
  field: 'maxBalls' | 'variety' | 'timeLimit' | 'pickupChance' | 'tiltChance';
  label: string; min: number; max?: number; step?: number; scale?: number; hint?: string;
  onUpdateLevel: (level: LevelConfig) => void;
}) {
  const raw = level[field];
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={raw != null ? Math.round(raw * scale * 1000) / 1000 : ''}
        onChange={(e) => {
          const next = { ...level };
          const v = e.target.value.trim();
          if (v === '') delete next[field];
          else {
            let n = Number(v) / scale;
            if (max != null) n = Math.min(max / scale, n);
            next[field] = Math.max(min / scale, n);
          }
          onUpdateLevel(next);
        }}
        className="w-full px-2 py-1 rounded bg-background border border-border"
        min={min}
        max={max}
        step={step}
      />
      {hint && <span className="block text-[10px] text-muted-foreground leading-relaxed">{hint}</span>}
    </label>
  );
}

/** One side's kick: 1 (or blank) is a plain bounce; the bearing is left to YAML. */
function edgeKick(edges: BoardEdgeSpecs | undefined, side: BoardSide): number | undefined {
  return edges?.[side]?.kick;
}

interface LevelPanelProps {
  level: LevelConfig;
  onUpdateLevel: (level: LevelConfig) => void;
}

export function LevelPanel({ level, onUpdateLevel }: LevelPanelProps) {
  return (
    <div className="border-b border-border">
      <div className="p-3">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Level Settings</h3>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-1 col-span-2">
            <span className="text-muted-foreground">Level ID</span>
            <input
              type="text"
              value={level.id}
              onChange={(e) => onUpdateLevel({ ...level, id: e.target.value })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
            />
          </label>
          
          <label className="space-y-1">
            <span className="text-muted-foreground">Size Threshold %</span>
            <input
              type="number"
              value={level.sizeThreshold}
              onChange={(e) => onUpdateLevel({ ...level, sizeThreshold: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={1}
              max={99}
            />
          </label>
          
          <label className="space-y-1">
            <span className="text-muted-foreground">Expected Cuts (Par)</span>
            <input
              type="number"
              value={level.expectedCuts}
              onChange={(e) => onUpdateLevel({ ...level, expectedCuts: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={1}
            />
          </label>
          
          <label className="space-y-1">
            <span className="text-muted-foreground">Base Points</span>
            <input
              type="number"
              value={level.points}
              onChange={(e) => onUpdateLevel({ ...level, points: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={1}
            />
          </label>

          {/* What this map's colored areas are worth, as a share of its points.
              Only meaningful on a map that HAS areas, so it is hidden otherwise
              rather than sitting there implying an effect it cannot have. */}
          {(level.coloredAreas ?? []).length > 0 && (
            <label className="space-y-1 col-span-2">
              <span className="text-muted-foreground">
                Colored areas carry {Math.round(areaShareOf(level) * 100)}% of this map's points
              </span>
              <input
                type="range"
                min={0}
                max={MAX_COLORED_AREA_SHARE}
                step={0.05}
                value={areaShareOf(level)}
                onChange={(e) => onUpdateLevel({
                  ...level,
                  coloredAreaShare: clampAreaShare(Number(e.target.value)),
                })}
                className="w-full"
              />
              <span className="block text-[10px] text-muted-foreground leading-relaxed">
                Paid in proportion to the areas satisfied, and withheld from the map's own
                points rather than added on top, so skipping the zones costs that share of
                the payout AND of the overtime cap. Default {Math.round(DEFAULT_COLORED_AREA_SHARE * 100)}%;
                lower it on maps where the zones sit alongside another demanding feature.
              </span>
            </label>
          )}

          {/* Map light: 1 (or blank) is the normal board; lower is an authored
              dark map. Blank rather than 1 when unset, so the YAML stays clean
              and a map that never wanted this carries no field. */}
          <label className="space-y-1">
            <span className="text-muted-foreground">
              Map Light ({MIN_MAP_LIGHT}-1, blank = normal)
            </span>
            <input
              type="number"
              value={level.light ?? ''}
              placeholder="1"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = { ...level };
                if (raw === '') delete next.light;
                else next.light = Math.max(MIN_MAP_LIGHT, Math.min(1, Number(raw)));
                onUpdateLevel(next);
              }}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={MIN_MAP_LIGHT}
              max={1}
              step={0.05}
            />
          </label>

          <OptionalNumber level={level} onUpdateLevel={onUpdateLevel} field="maxBalls"
            label="Max Balls (blank = derived)" min={1} max={12} />
          <OptionalNumber level={level} onUpdateLevel={onUpdateLevel} field="variety"
            label="Variety % (blank = 0)" min={0} max={100} />

          {/* The map's clock. Blank is the ladder's own ramp (60s minus 10 per
              ten levels); levels 1-3 ignore it entirely. */}
          <OptionalNumber level={level} onUpdateLevel={onUpdateLevel} field="timeLimit"
            label="Time Limit s (blank = ladder)" min={5} max={600} step={5} />
          <OptionalNumber level={level} onUpdateLevel={onUpdateLevel} field="pickupChance"
            label="Pickup Chance % (blank = global)" min={0} max={100} scale={100}
            hint="Set at all and the global start-level gate is bypassed: 100 guarantees a token, 0 suppresses them." />
          <OptionalNumber level={level} onUpdateLevel={onUpdateLevel} field="tiltChance"
            label="Tilt Chance % (blank = 5-10)" min={0} max={100} scale={100}
            hint="Per progress tier. Needs a gravity well on the map and a level past the tilt floor to mean anything." />

          {/* Pinned mutator: the roll replaced by an authored one. Populated from
              mapMutators.yml, so a new mutator is offered here the moment it is
              authored, with nothing to remember. */}
          <label className="space-y-1">
            <span className="text-muted-foreground">Pinned Mutator (blank = roll)</span>
            <select
              value={level.mutator ?? ''}
              onChange={(e) => {
                const next = { ...level };
                if (e.target.value === '') delete next.mutator;
                else next.mutator = e.target.value;
                onUpdateLevel(next);
              }}
              className="w-full px-2 py-1 rounded bg-background border border-border"
            >
              <option value="">(procedural roll)</option>
              {getMapMutators().map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              checked={level.neverRotates === true}
              onChange={(e) => {
                const next = { ...level };
                if (e.target.checked) next.neverRotates = true;
                else delete next.neverRotates;
                onUpdateLevel(next);
              }}
            />
            <span className="text-muted-foreground">Never rotates (screen-relative design)</span>
          </label>

          {/* Board edge kicks: a speed multiplier per side on contact. 1 or
              blank is a plain bounce. A side's BEARING (fire the ball along a
              heading) stays YAML-only: it is rare, and a wrong one strands a map. */}
          <div className="col-span-2 space-y-1">
            <span className="text-muted-foreground">Board Edge Kick (x speed; blank = 1)</span>
            <div className="grid grid-cols-4 gap-1">
              {BOARD_SIDES.map(side => (
                <label key={side} className="space-y-0.5">
                  <span className="block text-[10px] text-muted-foreground capitalize">{side}</span>
                  <input
                    type="number"
                    value={edgeKick(level.boardEdges, side) ?? ''}
                    placeholder="1"
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      const edges: BoardEdgeSpecs = { ...(level.boardEdges ?? {}) };
                      const spec = { ...(edges[side] ?? {}) };
                      if (v === '' || Number(v) === 1) delete spec.kick;
                      else spec.kick = Math.max(0.25, Math.min(3, Number(v)));
                      if (Object.keys(spec).length === 0) delete edges[side];
                      else edges[side] = spec;
                      const next = { ...level };
                      if (Object.keys(edges).length === 0) delete next.boardEdges;
                      else next.boardEdges = edges;
                      onUpdateLevel(next);
                    }}
                    className="w-full px-1 py-1 rounded bg-background border border-border"
                    min={0.25}
                    max={3}
                    step={0.05}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="space-y-1">
            <span className="text-muted-foreground">Random Shapes %</span>
            <input
              type="number"
              value={level.randomShapes ?? 20}
              onChange={(e) => onUpdateLevel({ ...level, randomShapes: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={0}
              max={100}
            />
          </label>

          {/* The map's tempo. Blank rather than 100 when unset, the same way Map
              Light is, so "this map does not say" and "this map says normal"
              stay different things in the file. */}
          <label className="space-y-1">
            <span className="text-muted-foreground">Ball Speed % (blank = 100)</span>
            <input
              type="number"
              value={level.ballSpeedScale != null ? Math.round(level.ballSpeedScale * 100) : ''}
              onChange={(e) => {
                const next = { ...level };
                const raw = e.target.value;
                if (raw === '') delete next.ballSpeedScale;
                else next.ballSpeedScale = Math.max(0.25, Math.min(2, Number(raw) / 100));
                onUpdateLevel(next);
              }}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={25}
              max={200}
              step={5}
            />
          </label>
        </div>
      </div>
      
      {/* What this map actually asks of the player, above the payout preview:
          the win is the design decision, the score is its consequence. */}
      <WinConditionsPanel level={level} onUpdateLevel={onUpdateLevel} />

      {/* Scoring Preview Panel */}
      <ScoringPreviewPanel level={level} />
    </div>
  );
}
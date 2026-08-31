/**
 * What the ladder's vocabulary looks like from above.
 *
 * A map is authored one at a time, and each choice is locally reasonable - this
 * one wants a mover, that one wants a breakable. The drift is only visible
 * across all thirty-five: colored areas on 19 of them, thread-lock on one.
 * Nothing in the editor showed that, so the easy mechanics kept winning.
 *
 * Two readings, because they answer different questions. THIS MAP says what the
 * map in front of you uses and whether its act is already saturated with that
 * idea. THE LADDER is the whole picture, sorted rarest-first, so the things
 * that have been introduced and forgotten sit at the top where they cannot be
 * missed.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LevelConfig } from '@/types/level';
import {
  MECHANICS, ACTS, mechanicSpread, spreadWarnings, actOf,
} from '@/lib/admin/mechanicSpread';

export function MechanicSpreadPanel({ levels, current }: {
  levels: LevelConfig[];
  current: LevelConfig | null;
}) {
  const [open, setOpen] = useState(false);
  const spread = useMemo(() => mechanicSpread(levels), [levels]);
  const warnings = useMemo(() => spreadWarnings(levels), [levels]);

  const act = current ? actOf(current.level) : null;
  const actIndex = ACTS.findIndex(a => a.name === act);
  const actSize = actIndex >= 0
    ? levels.filter(l => l.level >= ACTS[actIndex].from && l.level <= ACTS[actIndex].to).length
    : 0;

  const usedHere = current
    ? MECHANICS.filter(m => m.detect(current)).map(m => m.key)
    : [];

  return (
    <div className="p-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Mechanics</h3>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
        >
          {open ? 'This map' : 'Whole ladder'}
        </button>
      </div>

      {!open && current && (
        <div className="space-y-2">
          {usedHere.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              This map uses no headline mechanic yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {spread.filter(m => usedHere.includes(m.key)).map(m => {
                // How crowded this idea already is in THIS map's act. The map
                // in front of you is included in the count, so 3 of 10 means
                // "this one and two others", which is the number you want when
                // deciding whether to reach for it again.
                const inAct = actIndex >= 0 ? m.perAct[actIndex] : 0;
                const crowded = actSize >= 4 && inAct > actSize / 2;
                return (
                  <span
                    key={m.key}
                    title={`${m.label}: on ${m.levels.length} maps overall, ${inAct} in act ${act}`}
                    className="px-1.5 py-0.5 rounded text-[10px] tabular-nums"
                    style={{
                      background: crowded ? '#fbbf2433' : '#34d39922',
                      color: crowded ? '#fbbf24' : '#34d399',
                    }}
                  >
                    {m.label} {inAct}/{actSize}
                  </span>
                );
              })}
            </div>
          )}
          {act && (
            <p className="text-[10px] text-muted-foreground">
              Counts are within act {act}. Amber means this idea is already on more than
              half that act.
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-0.5">
          {[...spread]
            .filter(m => m.headline)
            .sort((a, b) => a.levels.length - b.levels.length)
            .map(m => {
              const n = m.levels.length;
              const here = current ? m.levels.includes(current.level) : false;
              return (
                <div
                  key={m.key}
                  title={n ? `Levels ${m.levels.join(', ')}` : 'On no map'}
                  className="flex items-center gap-2 text-[10px]"
                >
                  <span className="w-5 text-right tabular-nums" style={{
                    color: n === 0 ? '#f87171' : n === 1 ? '#fbbf24' : 'inherit',
                  }}>{n}</span>
                  <span className={here ? 'text-primary font-medium' : 'text-muted-foreground'}>
                    {m.label}
                  </span>
                  {/* Per-act bars: where in the ladder this idea actually lives. */}
                  <span className="ml-auto flex gap-0.5">
                    {m.perAct.map((c, i) => (
                      <span
                        key={i}
                        title={`Act ${ACTS[i].name}: ${c}`}
                        className="w-3 h-2.5 rounded-sm"
                        style={{ background: c === 0 ? '#ffffff12' : `rgba(52,211,153,${Math.min(1, 0.25 + c * 0.18)})` }}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border">
          {warnings.slice(0, 6).map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px]" style={{ color: '#fbbf24' }}>
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span><b>{w.label}</b> {w.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

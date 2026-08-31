/**
 * Play the map you are editing, without leaving the editor.
 *
 * Runs the same bot the test suite uses across every orientation the map can be
 * dealt in, and answers the three questions the YAML cannot: is it winnable,
 * what does it cost, and does anything break.
 *
 * ── Why it steps one game at a time ────────────────────────────────────────
 *
 * Each run hijacks performance.now for its duration - that is how the headless
 * engine gets fence growth without a real clock - so a run must finish before
 * anything else executes. A dozen games back to back is a couple of seconds of
 * frozen tab with no way to show progress. Stepping one per timeout keeps the
 * clock hijack inside a single synchronous run, lets React paint between games,
 * and makes the count tick up while you watch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import type { LevelConfig } from '@/types/level';
import type { MapRotation } from '@/lib/mapRotation';
import {
  seedsCoveringRotations, playtestOne, summarise, verdictHeadline,
  type PlaytestRun, type PlaytestVerdict,
} from '@/lib/admin/playtest';

/** Frames per game. 3600 is 30s of game time - enough for any authored map. */
const FRAMES = 3600;

const TONE = {
  ok: { color: '#34d399', Icon: CheckCircle2 },
  warn: { color: '#fbbf24', Icon: CircleAlert },
  bad: { color: '#f87171', Icon: AlertTriangle },
} as const;

export function PlaytestPanel({ level }: { level: LevelConfig }) {
  const [perRotation, setPerRotation] = useState(2);
  const [runs, setRuns] = useState<PlaytestRun[]>([]);
  const [verdict, setVerdict] = useState<PlaytestVerdict | null>(null);
  const [plan, setPlan] = useState<{ seed: number; rotation: MapRotation }[]>([]);
  const [running, setRunning] = useState(false);
  // Read by the stepping effect so stopping takes effect on the next tick
  // rather than waiting for the whole plan to drain.
  const cancelled = useRef(false);

  // Editing the map invalidates whatever was measured about the old one.
  // Showing a stale green tick over a map that has changed underneath it is
  // worse than showing nothing.
  useEffect(() => {
    cancelled.current = true;
    setRunning(false);
    setRuns([]);
    setVerdict(null);
  }, [level]);

  const start = useCallback(() => {
    cancelled.current = false;
    setRuns([]);
    setVerdict(null);
    setPlan(seedsCoveringRotations(level, level.level, perRotation));
    setRunning(true);
  }, [level, perRotation]);

  const stop = useCallback(() => {
    cancelled.current = true;
    setRunning(false);
  }, []);

  // One game per tick. setTimeout rather than rAF: a background tab throttles
  // rAF to nothing, and a playtest left running while you look something up
  // should still be finished when you come back.
  useEffect(() => {
    if (!running) return;
    if (runs.length >= plan.length) {
      setVerdict(summarise(level, runs));
      setRunning(false);
      return;
    }
    const id = window.setTimeout(() => {
      if (cancelled.current) return;
      const { seed, rotation } = plan[runs.length];
      const result = playtestOne(level, level.level, seed, rotation, FRAMES);
      setRuns(prev => [...prev, result]);
    }, 0);
    return () => window.clearTimeout(id);
  }, [running, runs, plan, level]);

  const head = verdict ? verdictHeadline(verdict) : null;
  const Tone = head ? TONE[head.tone] : null;
  const live = verdict ?? (runs.length > 0 ? summarise(level, runs) : null);

  return (
    <div className="p-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Playtest</h3>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          runs / orientation
          <select
            value={perRotation}
            onChange={e => setPerRotation(Number(e.target.value))}
            disabled={running}
            className="px-1 py-0.5 rounded bg-background border border-border"
          >
            {[1, 2, 3, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <button
        onClick={running ? stop : start}
        className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded text-sm font-medium transition-colors ${
          running ? 'bg-muted hover:bg-muted/80' : 'bg-primary/20 hover:bg-primary/30 text-primary'
        }`}
      >
        {running
          ? <><Square className="w-3.5 h-3.5" /> Stop ({runs.length}/{plan.length})</>
          : <><Play className="w-3.5 h-3.5" /> Play this map</>}
      </button>

      {running && plan.length > 0 && (
        <div className="h-1 rounded bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(runs.length / plan.length) * 100}%` }}
          />
        </div>
      )}

      {head && Tone && (
        <div className="flex items-start gap-2 text-xs" style={{ color: Tone.color }}>
          <Tone.Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{head.text}</span>
        </div>
      )}

      {live && live.total > 0 && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span>Won</span><span className="text-right tabular-nums">{live.won} / {live.total}</span>
            {live.lost > 0 && <><span>Lost</span><span className="text-right tabular-nums">{live.lost}</span></>}
            {live.timedOut > 0 && <><span>Ran out of time</span><span className="text-right tabular-nums">{live.timedOut}</span></>}
            {live.stalled > 0 && <><span>Stalled</span><span className="text-right tabular-nums">{live.stalled}</span></>}
          </div>

          {/* Per orientation, because a map that only fails on its side is the
              whole reason this exists. */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">By orientation</div>
            <div className="flex gap-1">
              {live.byRotation.map(r => {
                const all = r.won === r.runs;
                const none = r.won === 0;
                return (
                  <div
                    key={r.rotation}
                    title={`Orientation ${r.rotation}: won ${r.won} of ${r.runs}`}
                    className="flex-1 text-center py-1 rounded text-[10px] tabular-nums"
                    style={{
                      background: none ? '#f8717133' : all ? '#34d39933' : '#fbbf2433',
                      color: none ? '#f87171' : all ? '#34d399' : '#fbbf24',
                    }}
                  >
                    {r.rotation}<br />{r.won}/{r.runs}
                  </div>
                );
              })}
            </div>
          </div>

          {live.medianWinningCuts !== null && (
            <div className="text-[10px] text-muted-foreground leading-relaxed">
              Bot needed a median of <b className="text-foreground">{live.medianWinningCuts}</b> cuts
              (par is {live.expectedCuts}).
              {' '}The bot plays deliberately badly so it wanders into odd states, so this is
              not your par - it is useful compared against other maps, not against this number.
            </div>
          )}

          {live.hard.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold" style={{ color: '#f87171' }}>
                Engine violations
              </div>
              {live.hard.slice(0, 5).map((h, i) => (
                <div key={i} className="text-[10px] leading-snug" style={{ color: '#f87171' }}>
                  <span className="font-mono">[{h.rule}]</span> seed {h.seed}, orientation {h.rotation}
                  <div className="text-muted-foreground">{h.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

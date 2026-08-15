/**
 * Live map tuner (admin only), opened from the in-game menu.
 *
 * Deliberately usable mid-map: par and the clear threshold are both read at
 * check time, so a change lands on the run in progress rather than the next
 * one. That is the whole point, the moment you can judge par is the moment you
 * have just solved the map and can feel it took five cuts and not eight.
 *
 * Dev tooling, so the copy is plain English rather than i18n keys, matching the
 * Admin panel and the Playground.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, RotateCcw, Copy, Check, SlidersHorizontal } from 'lucide-react';
import {
  authoredBaseline, clearMapTuning, isMapTuned, setMapTuning, tuningAsYaml,
} from '@/lib/mapTuning';
import type { LevelConfig } from '@/types/level';

interface MapTuningModalProps {
  /** The level AS PLAYED, i.e. with any current overrides already applied. */
  level: LevelConfig;
  onClose: () => void;
}

interface FieldProps {
  label: string;
  hint: string;
  value: number;
  authored: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (n: number) => void;
}

function TuningField({ label, hint, value, authored, min, max, suffix, onChange }: FieldProps) {
  const changed = value !== authored;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {changed && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary">
            was {authored}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="w-10 h-10 rounded-lg bg-muted hover:bg-muted/70 disabled:opacity-30 text-lg font-bold"
        >
          -
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            // An empty or half-typed field parses as NaN; keep the last good value.
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className={`flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border text-center font-mono text-lg ${
            changed ? 'border-primary text-primary' : 'border-border'
          }`}
        />
        {suffix && <span className="text-sm text-muted-foreground w-4">{suffix}</span>}
        <button
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="w-10 h-10 rounded-lg bg-muted hover:bg-muted/70 disabled:opacity-30 text-lg font-bold"
        >
          +
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function MapTuningModal({ level, onClose }: MapTuningModalProps) {
  // Captured from map.yml before any override was written onto the level, so
  // "was N" survives even though the overrides mutate the object in place.
  const authored = authoredBaseline(level.id)
    ?? { expectedCuts: level.expectedCuts, sizeThreshold: level.sizeThreshold };
  // Re-render locally on each write; useLevelManager separately re-derives the
  // level the game plays, so the board and this panel never disagree.
  const [, bump] = useState(0);
  const [copied, setCopied] = useState(false);
  const tuned = isMapTuned(level.id);

  const update = (patch: Parameters<typeof setMapTuning>[1]) => {
    setMapTuning(level.id, patch);
    bump(n => n + 1);
  };

  const reset = () => {
    clearMapTuning(level.id);
    bump(n => n + 1);
  };

  const copyYaml = async () => {
    const text = tuningAsYaml(level.id);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (webview/insecure origin): the YAML is shown below anyway */
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-5"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          <h2 className="text-lg font-bold flex-1">Tune map</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
          <span>{level.id}</span>
          {tuned && (
            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary not-italic">TUNED</span>
          )}
        </div>

        <TuningField
          label="Par (fences)"
          hint="A clean solve's fence count. Drives the under-par bonus and the over-par penalty."
          value={level.expectedCuts}
          authored={authored.expectedCuts}
          min={1}
          max={40}
          onChange={(n) => update({ expectedCuts: n })}
        />

        <TuningField
          label="Clear threshold"
          hint="How much board may be left when the map is won. Lower is a longer map."
          value={level.sizeThreshold}
          authored={authored.sizeThreshold}
          min={1}
          max={95}
          suffix="%"
          onChange={(n) => update({ sizeThreshold: n })}
        />

        <p className="text-xs text-muted-foreground">
          Both land on the map in progress: neither is read when the board is
          built, so nothing restarts and you keep your cuts. Ball roster and
          speeds are not tunable yet.
        </p>

        {tuned && (
          <div className="space-y-2">
            <div className="rounded-lg bg-background border border-border p-2">
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre overflow-x-auto">
{tuningAsYaml(level.id)}
              </pre>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyYaml}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy for map.yml'}
              </button>
              <button
                onClick={reset}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Overrides are saved per map and survive a reload, so a tuned run never
              files on the highscore ledger. Paste the lines above into
              public/map.yml to make them real.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

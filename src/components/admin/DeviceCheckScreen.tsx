/**
 * The device check (DEVICE_LAB.md): plays a few maps on this device, draws a
 * fence on each, and reports whether a player could see and play them.
 *
 * The maps are the real ones on the real board (GameScreen, as the Playground
 * mounts it), not the headless bot, because the question is what THIS phone's
 * browser and GPU do with them: the boards light up, the frame rate a map
 * settles at, whether the renderer had to step down. model.ts holds the rules;
 * this only runs them and shows the outcome. Reached from Admin, from the CI
 * hook, and from a Firebase Test Lab launch (launch.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import yaml from 'js-yaml';
import { Check, Copy, X } from 'lucide-react';
import { GameScreen } from '@/components/game/GameScreen';
import type { GameStateInfo } from '@/components/game/GameCanvas';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { loadAbilities } from '@/lib/abilities';
import { loadBallTypes } from '@/lib/ballTypes';
import { loadFenceTypes } from '@/lib/fences';
import { getFrameStats } from '@/lib/rendering/perfStats';
import { getRendererDiag, getQualitySteps, qualityStepText } from '@/lib/rendering/rendererDiag';
import { getBoardRenderer, getLearnedLimit, resolvedTier } from '@/lib/rendering/render3dSettings';
import { gpuRenderer } from '@/lib/rendering/canvasCompat';
import { isTouchTraceEnabled, resetTouchTrace, setTouchTraceEnabled, touchTraceLines } from '@/lib/touchTrace';
import {
  DEVICE_CHECK_LEVELS, FENCE_AT_MS, MEASURE_MS, WARMUP_MS, frameStats, verdict,
  type DeviceCheckResult, type MapCheck,
} from '@/lib/deviceCheck/model';
import { boardCanvas, drawFence, readAfterDraw, sampleFrames } from '@/lib/deviceCheck/probes';
import { finishDeviceCheck, type DeviceCheckRun } from '@/lib/deviceCheck/launch';
import type { LevelConfig, LevelData } from '@/types/level';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Where the fence is drawn, as a share of the board's height: the middle first. */
const FENCE_ROWS = [0.5, 0.3, 0.7];

/** How long a map may take to put its board on the page. */
const LOAD_LIMIT_MS = 10000;

async function waitForBoard(): Promise<HTMLCanvasElement | null> {
  const since = performance.now();
  while (performance.now() - since < LOAD_LIMIT_MS) {
    const c = boardCanvas();
    if (c && c.width > 0) {
      return c;
    }
    await sleep(100);
  }
  return null;
}

function bootErrors(): string[] {
  return (window as unknown as { __devendBoot?: { errors: string[] } }).__devendBoot?.errors ?? [];
}

function deviceInfo(): DeviceCheckResult['device'] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    gpu: gpuRenderer(),
    screen: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio || 1,
    cores: navigator.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
  };
}

/**
 * What the renderer recorded during this page load (rendererDiag keeps it
 * across loads, so an older entry is left out): a failed start, shader
 * errors, and every quality step the governor took.
 */
function rendererLines(): string[] {
  const pageStart = Date.now() - performance.now();
  const thisLoad = (iso: string) => Date.parse(iso) >= pageStart;
  const lines: string[] = [];
  const diag = getRendererDiag();
  if (diag && thisLoad(diag.at)) {
    if (diag.outcome === 'failed') {
      lines.push(`renderer failed to start: ${diag.message ?? '?'}`);
    }
    for (const e of diag.shaderErrors ?? []) {
      lines.push(`shader error: ${e.slice(0, 200)}`);
    }
  }
  for (const s of getQualitySteps().filter(q => thisLoad(q.at))) {
    lines.push(`quality step: ${qualityStepText(s)}`);
  }
  return lines;
}

export function DeviceCheckScreen({ run, onExit }: { run: DeviceCheckRun; onExit: () => void }) {
  const [levels, setLevels] = useState<LevelConfig[] | null>(null);
  const [current, setCurrent] = useState<LevelConfig | null>(null);
  const [progress, setProgress] = useState('Loading maps');
  const [result, setResult] = useState<DeviceCheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const cutsRef = useRef(0);
  const activeModifiers = useActiveModifiers([], [], {});

  // The maps and the catalogues a board needs, as the Playground loads them.
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('/map.yml').then(r => r.text()),
      loadBallTypes(), loadAbilities(), loadFenceTypes(),
    ]).then(([text]) => {
      if (!live) {
        return;
      }
      const data = yaml.load(text) as LevelData;
      setLevels((data?.levels ?? []).map(l => ({ ...l, balls: l.balls ?? [] })));
    }).catch(() => {
      if (live) {
        setLevels([]);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // The run itself: each map in turn, measured, then the verdict.
  useEffect(() => {
    if (!levels) {
      return;
    }
    let live = true;
    (async () => {
      const startedAt = new Date().toISOString();
      const maps: MapCheck[] = [];
      // The board's touch trace, on for the run, so a fence it did not take says why.
      const traceWas = isTouchTraceEnabled();
      setTouchTraceEnabled(true);
      for (const n of DEVICE_CHECK_LEVELS) {
        const level = levels.find(l => l.level === n);
        if (!level || !live) {
          maps.push({
            level: n, id: level?.id ?? '?', loaded: false, frames: frameStats([]), board: null,
            fenceTaken: false, tier: '?', renderAvgMs: 0, physicsPeakMs: 0,
          });
          continue;
        }
        setProgress(`Level ${n}: loading`);
        cutsRef.current = 0;
        setCurrent(null);
        await sleep(50);
        setCurrent(level);
        const canvas = await waitForBoard();
        if (!canvas || !live) {
          maps.push({
            level: n, id: level.id, loaded: false, frames: frameStats([]), board: null,
            fenceTaken: false, tier: '?', renderAvgMs: 0, physicsPeakMs: 0,
          });
          continue;
        }
        setProgress(`Level ${n}: settling`);
        await sleep(WARMUP_MS);
        setProgress(`Level ${n}: measuring`);
        const board = await readAfterDraw(canvas);
        const frames = sampleFrames(MEASURE_MS);
        await sleep(FENCE_AT_MS);
        // Across the middle, or above or below it where an interface widget
        // covers the middle (a map's banner). Taken means the board turned the
        // touch into a fence: its own trace says so the moment it lifts, where
        // the fence counter waits for the simulation, which a slow device may
        // not reach before the map ends.
        resetTouchTrace();
        let fenceTaken = false;
        for (const y of FENCE_ROWS) {
          await drawFence(boardCanvas() ?? canvas, y);
          fenceTaken = cutsRef.current > 0 || touchTraceLines().some(l => / up: fence\b/.test(l));
          if (fenceTaken) {
            break;
          }
        }
        const intervals = await frames;
        const perf = getFrameStats();
        const renderer = getBoardRenderer();
        maps.push({
          level: n,
          id: level.id,
          loaded: true,
          frames: frameStats(intervals),
          board,
          fenceTaken,
          ...(fenceTaken ? {} : { fenceTrace: touchTraceLines().slice(-12) }),
          tier: renderer === 'three' ? `3d ${resolvedTier()}${getLearnedLimit() ? ` (learned ${getLearnedLimit()})` : ''}` : '2d',
          renderAvgMs: Math.round(perf.renderAvg * 10) / 10,
          physicsPeakMs: Math.round(perf.physPeak * 10) / 10,
        });
      }
      setTouchTraceEnabled(traceWas);
      if (!live) {
        return;
      }
      setCurrent(null);
      const errors = bootErrors().slice(run.errorsBefore);
      const v = verdict({ bootMs: run.bootMs, menu: run.menu, maps, errors }, { judgeFrames: run.judgeFrames });
      const out: DeviceCheckResult = {
        version: 1,
        startedAt,
        device: deviceInfo(),
        bootMs: run.bootMs === null ? null : Math.round(run.bootMs),
        menu: run.menu,
        maps,
        renderer: rendererLines(),
        errors,
        framesJudged: run.judgeFrames,
        ...v,
      };
      setResult(out);
      setProgress(v.pass ? 'Passed' : 'Failed');
      finishDeviceCheck(out);
    })();
    return () => {
      live = false;
    };
  }, [levels, run]);

  const json = useMemo(() => (result ? JSON.stringify(result, null, 2) : ''), [result]);

  return (
    <div className="fixed inset-0 bg-background" data-device-check={result ? (result.pass ? 'pass' : 'fail') : 'running'}>
      {current && (
        <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0)', overflow: 'hidden' }}>
          <GameScreen
            key={current.id}
            canvasPageLock={false}
            level={current}
            levelNumber={current.level}
            totalLevels={1}
            totalScore={0}
            ownedUpgradeIds={[]}
            upgrades={[]}
            lives={99}
            onLivesChange={() => {}}
            onGameEnd={() => {}}
            onLevelComplete={() => {}}
            onMainMenu={() => {}}
            onRestart={() => {}}
            onGameStateChange={(s: GameStateInfo) => {
              cutsRef.current = Math.max(cutsRef.current, s.cutsUsed);
            }}
            activeModifiers={activeModifiers}
            noCards
          />
        </div>
      )}

      <div
        className="absolute left-2 top-2 px-3 py-1 rounded bg-black/70 text-xs font-mono text-primary"
        style={{ zIndex: 10000 }}
      >
        Device check: {progress}
      </div>

      {result && (
        <div className="absolute inset-0 overflow-auto p-4 bg-background" style={{ zIndex: 10001 }}>
          <div className={`text-xl font-semibold mb-2 flex items-center gap-2 ${result.pass ? 'text-primary' : 'text-destructive'}`}>
            {result.pass ? <Check className="w-6 h-6" /> : <X className="w-6 h-6" />}
            {result.pass ? 'This device passes' : 'This device fails'}
          </div>
          {result.failures.map(f => (
            <div key={f} className="text-sm text-destructive">{f}</div>
          ))}
          {result.warnings.map(w => (
            <div key={w} className="text-sm text-muted-foreground">{w}</div>
          ))}
          <div className="text-sm my-3">
            {result.maps.map(m => (
              <div key={m.level} className="font-mono">
                L{m.level}: {m.frames.fps} fps (p95 {m.frames.p95Ms}ms), board {m.board ? `${m.board.lit}/${m.board.total}` : '?'}, {m.tier}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mb-3">
            <button
              className="px-3 py-2 rounded border border-border flex items-center gap-2"
              onClick={() => {
                navigator.clipboard?.writeText(json).then(() => setCopied(true), () => window.prompt('Copy this', json));
              }}
            >
              <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy report'}
            </button>
            <button className="px-3 py-2 rounded border border-border" onClick={onExit}>Back</button>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words">{json}</pre>
        </div>
      )}
    </div>
  );
}

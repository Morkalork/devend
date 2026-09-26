/**
 * PairLoopbackPanel — two-player, watchable, on one device.
 *
 * Two full simulations in this page, wired to each other through an in-memory
 * transport whose latency, jitter and loss you set with the sliders. That is
 * the whole point: every part of two-player above the wire can be exercised
 * here, with no second phone, no Wi-Fi and no WebRTC, and a bug that only
 * shows up at 200ms is one you can reproduce on a desk.
 *
 * "Did not desync" and "is not running" look identical from the outside, which
 * is the exact failure the admin rule in CLAUDE.md is about, so the readout
 * shows the ticks running, the hashes on both sides, and every repair as it
 * happens. Force desync nudges one side's board the way a floating-point
 * difference between two Chrome builds would, so the recovery path can be
 * watched rather than assumed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Pause, Zap, RotateCcw } from "lucide-react";
import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { MemoryTransport, type LinkConditions } from "@/lib/net/transport";
import { LockstepSession, type DesyncStage } from "@/lib/net/lockstep";
import { motionHash, topologyHash } from "@/lib/net/stateHash";
import { captureSimModuleState, restoreSimModuleState, type SimModuleState } from "@/lib/net/simState";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import type { PlayerId } from "@/lib/net/commands";
import { commandAllowed, startPairTurns } from "@/lib/net/pairTurn";
import yaml from "js-yaml";
import type { LevelConfig } from "@/types/level";

interface Device {
  ctx: ReturnType<typeof createBotGame>;
  session: LockstepSession;
  /** This side's share of the module-level sim state; see net/simState.ts. */
  mod: SimModuleState;
  transport: MemoryTransport;
}

interface Readout {
  tickA: number; tickB: number;
  hashA: string; hashB: string;
  agree: boolean;
  stallsA: number; stallsB: number;
  desyncs: number; resyncs: number; restarts: number;
  delayA: number; delayB: number;
  ballsA: number; ballsB: number;
  wallsA: number; wallsB: number;
  /** Whose turn each board thinks it is (net/pairTurn.ts). */
  turnA: string; turnB: string;
  log: string[];
}

const EMPTY: Readout = {
  tickA: 0, tickB: 0, hashA: "-", hashB: "-", agree: true,
  stallsA: 0, stallsB: 0, desyncs: 0, resyncs: 0, restarts: 0,
  delayA: 6, delayB: 6, ballsA: 0, ballsB: 0, wallsA: 0, wallsB: 0,
  turnA: "-", turnB: "-", log: [],
};

/** A board's idea of whose turn it is, for the readout. */
function turnLabel(game: { pairTurn?: { player: number; spent: boolean; seq: number } | null }): string {
  const t = game.pairTurn;
  if (!t) return "-";
  return `P${t.player}${t.spent ? " building" : " to draw"} #${t.seq}`;
}

export function PairLoopbackPanel({ onBack }: { onBack: () => void }) {
  // The rig loads the ladder itself: it has to be reachable from the admin
  // screen with no run in progress, which is exactly when you want to test the
  // networking.
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [levelIdx, setLevelIdx] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/map.yml", { cache: "no-store" });
        const data = yaml.load(await res.text()) as { levels?: LevelConfig[] };
        if (alive) setLevels((data?.levels ?? []).filter(l => l.id));
      } catch {
        if (alive) setLevels([]);
      }
    })();
    return () => { alive = false; };
  }, []);
  const level = levels[levelIdx] ?? null;

  const [conditions, setConditions] = useState<LinkConditions>({ latencyMs: 20, jitterMs: 5, loss: 0 });
  const [running, setRunning] = useState(false);
  const [readout, setReadout] = useState<Readout>(EMPTY);

  const pairRef = useRef<{ a: Device; b: Device } | null>(null);
  const rafRef = useRef(0);
  const logRef = useRef<string[]>([]);
  const conditionsRef = useRef(conditions);
  conditionsRef.current = conditions;

  const note = useCallback((line: string) => {
    logRef.current = [line, ...logRef.current].slice(0, 12);
  }, []);

  const build = useCallback(() => {
    if (!level) return;
    logRef.current = [];
    const [ta, tb] = MemoryTransport.pair(conditionsRef.current);
    const make = (transport: MemoryTransport, player: PlayerId): Device => {
      releaseClock();
      installClock();
      setRunSeedText("admin-pair");
      const ctx = createBotGame(level, level.level ?? 1, plainModifiers());
      // Turns, as the real pair plays them: the game loop starts them on the
      // first pair frame, and this rig has no game loop.
      ctx.game.pairTurn = startPairTurns(level.level ?? 1);
      const device: Device = {
        ctx, transport,
        mod: captureSimModuleState(),
        session: new LockstepSession({
          transport, localPlayer: player, isHost: player === 0,
          callbacks: {
            onDesync: (stage: DesyncStage, tick: number) =>
              note(`P${player}: desync at tick ${tick}, repairing by ${stage}`),
            onRestartMap: () => note(`P${player}: gave up and restarted the map`),
            onClose: (r) => note(`P${player}: link closed (${r})`),
          },
        }),
      };
      releaseClock();
      return device;
    };
    const a = make(ta, 0);
    const b = make(tb, 1);
    pairRef.current = { a, b };
    note("paired: two boards from one seed");
    setReadout({ ...EMPTY, log: logRef.current });
  }, [level, note]);

  // Build once on mount, and again whenever the map changes under it.
  useEffect(() => {
    build();
    return () => {
      cancelAnimationFrame(rafRef.current);
      pairRef.current?.a.transport.close();
      pairRef.current = null;
      releaseClock();
      setRunSeedText(null);
    };
  }, [build]);

  // Keep the live link in step with the sliders without rebuilding the pair:
  // changing the latency mid-run is half of what this rig is for.
  useEffect(() => {
    const pair = pairRef.current;
    if (!pair) return;
    pair.a.transport.conditions = conditions;
    pair.b.transport.conditions = conditions;
  }, [conditions]);

  const stepDevice = (d: Device) => {
    restoreSimModuleState(d.mod);
    stepBot(d.ctx, PHYSICS_STEP);
    d.mod = captureSimModuleState();
  };

  useEffect(() => {
    if (!running) return;
    let disposed = false;
    const frame = () => {
      if (disposed) return;
      const pair = pairRef.current;
      if (pair) {
        const { a, b } = pair;
        // Two physics ticks per frame, which is what a 60Hz screen gets from a
        // 120Hz simulation.
        for (let i = 0; i < 2; i++) {
          a.session.run(a.ctx.game, 1, () => stepDevice(a), { modifiers: plainModifiers() });
          b.session.run(b.ctx.game, 1, () => stepDevice(b), { modifiers: plainModifiers() });
        }
        const hashA = `${motionHash(a.ctx.game)}/${topologyHash(a.ctx.game)}`;
        const hashB = `${motionHash(b.ctx.game)}/${topologyHash(b.ctx.game)}`;
        setReadout({
          tickA: a.session.currentTick, tickB: b.session.currentTick,
          hashA, hashB, agree: hashA === hashB,
          stallsA: a.session.stats.stalls, stallsB: b.session.stats.stalls,
          desyncs: a.session.stats.desyncs + b.session.stats.desyncs,
          resyncs: a.session.stats.resyncs + b.session.stats.resyncs,
          restarts: a.session.stats.restarts + b.session.stats.restarts,
          delayA: a.session.delayTicks, delayB: b.session.delayTicks,
          ballsA: a.ctx.game.balls.length, ballsB: b.ctx.game.balls.length,
          wallsA: a.ctx.game.wallCount, wallsB: b.ctx.game.wallCount,
          turnA: turnLabel(a.ctx.game), turnB: turnLabel(b.ctx.game),
          log: logRef.current,
        });
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { disposed = true; cancelAnimationFrame(rafRef.current); };
  }, [running]);

  /** A cut from one player, at a point that board actually has a region at. */
  const cut = (player: PlayerId, x: number, y: number) => {
    const pair = pairRef.current;
    if (!pair) return;
    const device = player === 0 ? pair.a : pair.b;
    const region = findRegionContainingPoint(device.ctx.game.regions, x, y);
    if (!region) { note(`P${player}: no region at ${x},${y}, nothing to cut`); return; }
    const cmd = {
      kind: "cut" as const, player,
      start: { x, y }, end: { x, y: y + 120 },
      path: null, regionId: region.id, fenceTypeId: STANDARD_FENCE_ID,
    };
    // Sent regardless, so the refusal on BOTH boards can be watched; the note
    // says what the phone's own input layer would have said instead.
    if (!commandAllowed(device.ctx.game, cmd)) note(`P${player}: not their turn, both boards will refuse it`);
    device.session.submit(cmd);
    note(`P${player}: cut sent at ${x},${y}`);
  };

  /** Hand the turn over without drawing, as the Pass button does. */
  const pass = (player: PlayerId) => {
    const pair = pairRef.current;
    if (!pair) return;
    const device = player === 0 ? pair.a : pair.b;
    device.session.submit({ kind: "passTurn", player });
    note(`P${player}: pass sent`);
  };

  /** Nudge one board, the way a float difference between two builds would. */
  const forceDesync = () => {
    const pair = pairRef.current;
    if (!pair) return;
    const ball = pair.b.ctx.game.balls[0];
    if (!ball) { note("no ball to nudge"); return; }
    ball.position.x += 4;
    note("nudged player 1's first ball by 4 units");
  };

  const row = (label: string, a: string | number, b: string | number, warn = false) => (
    <div className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
      <div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className={`flex-1 font-mono text-xs tabular-nums ${warn ? "text-destructive" : ""}`}>{a}</div>
      <div className={`flex-1 font-mono text-xs tabular-nums ${warn ? "text-destructive" : ""}`}>{b}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-primary">Pair Loopback</h1>
        </div>

        <p className="text-xs text-muted-foreground">
          Two simulations of one map, from one seed, talking to each other
          through a link you control. If the hashes ever disagree and stay that
          way, the two boards have parted company.
        </p>

        <label className="block rounded-lg bg-card border border-border p-3">
          <div className="text-xs text-muted-foreground mb-1">Map</div>
          <select
            value={levelIdx}
            onChange={e => { setRunning(false); setLevelIdx(Number(e.target.value)); }}
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
          >
            {levels.length === 0 && <option value={0}>loading map.yml...</option>}
            {levels.map((l, i) => (
              <option key={l.id} value={i}>{`${l.level ?? i + 1} - ${l.id}`}</option>
            ))}
          </select>
        </label>

        <div className="rounded-lg bg-card border border-border p-3 space-y-3">
          <Slider label="Latency" value={conditions.latencyMs} min={0} max={500} unit="ms"
            onChange={v => setConditions(c => ({ ...c, latencyMs: v }))} />
          <Slider label="Jitter" value={conditions.jitterMs} min={0} max={200} unit="ms"
            onChange={v => setConditions(c => ({ ...c, jitterMs: v }))} />
          <Slider label="Loss" value={Math.round(conditions.loss * 100)} min={0} max={50} unit="%"
            onChange={v => setConditions(c => ({ ...c, loss: v / 100 }))} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setRunning(r => !r)}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 flex items-center justify-center gap-2 text-sm font-semibold">
            {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {running ? "Pause" : "Run"}
          </button>
          <button onClick={() => { setRunning(false); build(); }}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 flex items-center justify-center gap-2 text-sm font-semibold">
            <RotateCcw className="w-4 h-4" /> Re-pair
          </button>
          <button onClick={() => cut(0, 300, 300)}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 text-sm">
            Player 0 cuts
          </button>
          <button onClick={() => cut(1, 560, 420)}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 text-sm">
            Player 1 cuts
          </button>
          <button onClick={() => pass(0)}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 text-sm">
            Player 0 passes
          </button>
          <button onClick={() => pass(1)}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 text-sm">
            Player 1 passes
          </button>
          <button onClick={forceDesync}
            className="col-span-2 p-3 rounded-lg bg-destructive/10 border border-destructive/40 hover:border-destructive text-sm font-semibold flex items-center justify-center gap-2">
            <Zap className="w-4 h-4" /> Force desync
          </button>
        </div>

        <div className="rounded-lg bg-card border border-border p-3">
          <div className="flex items-center gap-2 pb-2 mb-1 border-b border-border">
            <div className="w-28 shrink-0 text-xs font-semibold">Readout</div>
            <div className="flex-1 text-xs font-semibold">Player 0 (host)</div>
            <div className="flex-1 text-xs font-semibold">Player 1</div>
          </div>
          {row("tick", readout.tickA, readout.tickB)}
          {row("hash", readout.hashA, readout.hashB, !readout.agree)}
          {row("input delay", `${readout.delayA}t`, `${readout.delayB}t`)}
          {row("stalls", readout.stallsA, readout.stallsB)}
          {row("balls", readout.ballsA, readout.ballsB, readout.ballsA !== readout.ballsB)}
          {row("cuts", readout.wallsA, readout.wallsB, readout.wallsA !== readout.wallsB)}
          {row("turn", readout.turnA, readout.turnB, readout.turnA !== readout.turnB)}
          <div className="pt-2 mt-1 border-t border-border text-xs">
            <span className={readout.agree ? "text-primary" : "text-destructive font-semibold"}>
              {readout.agree ? "boards agree" : "BOARDS DISAGREE"}
            </span>
            <span className="text-muted-foreground">
              {" "}· {readout.desyncs} caught · {readout.resyncs} repaired · {readout.restarts} restarts
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-card border border-border p-3">
          <div className="text-xs font-semibold mb-2">What happened</div>
          {readout.log.length === 0
            ? <div className="text-xs text-muted-foreground">nothing yet</div>
            : readout.log.map((line, i) => (
                <div key={`${i}-${line}`} className="text-xs font-mono text-muted-foreground py-0.5">{line}</div>
              ))}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary" />
    </label>
  );
}

/**
 * Lockstep, tested the way it will actually fail (TWO_PLAYER_PLAN.md step 4).
 *
 * Two full simulations in one process, wired through a transport whose
 * latency, jitter and loss are dialled by the test. What is being pinned is
 * not "messages arrive" but the thing the mode lives or dies on: after a few
 * thousand ticks of both players cutting, both boards are still bit-identical.
 *
 * The desync tests deliberately CORRUPT one side, because a recovery path
 * nobody has ever seen run is not a recovery path.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";

import { PHYSICS_STEP } from "@/lib/gameConstants";
import { MemoryTransport, PERFECT_LINK } from "@/lib/net/transport";
import { LockstepSession, HASH_EVERY } from "@/lib/net/lockstep";
import { motionHash, topologyHash } from "@/lib/net/stateHash";
import { mulberry32 } from "@/lib/runRng";
import { captureSimModuleState, restoreSimModuleState } from "@/lib/net/simState";
import type { GameCommand, PlayerId } from "@/lib/net/commands";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { LADDER } from "./fixtures/maps";

afterEach(() => { releaseClock(); setRunSeedText(null); pairWallMs = 0; });

const board = LADDER.find(l => l.level === 3)!;

/**
 * One device: its own game, its own clock reading, its own session.
 *
 * The sim clock is a module global, so the two sims have to take turns with
 * it: each side saves its clock, restores it before stepping, and saves it
 * again after. Clumsy, and exactly the clumsiness that proves the point -
 * neither side's time depends on the other's.
 */
interface Device {
  ctx: ReturnType<typeof createBotGame>;
  session: LockstepSession;
  /**
   * This device's share of the module-level simulation state: the sim clock,
   * the seeded streams' positions, the region and wall id counters.
   *
   * On two phones each device owns its own module instance and none of this is
   * needed. In one process the two sims share it, so they take turns: install
   * yours, step, take yours back. Without it device A draws B's dice and names
   * its regions with B's counter, which looks exactly like a desync and is
   * purely an artefact of the bench. See net/simState.ts.
   */
  mod: import("@/lib/net/simState").SimModuleState;
  transport: MemoryTransport;
}

function makeDevice(
  transport: MemoryTransport, player: PlayerId, seed: string,
): Device {
  releaseClock();
  installClock();
  setRunSeedText(seed);
  const ctx = createBotGame(board, 3, plainModifiers());
  const device: Device = {
    ctx,
    transport,
    mod: captureSimModuleState(),
    session: new LockstepSession({
      transport,
      localPlayer: player,
      isHost: player === 0,
    }),
  };
  releaseClock();
  return device;
}

/** Step one device by one tick, with its own module state installed. */
function stepDevice(d: Device): void {
  restoreSimModuleState(d.mod);
  stepBot(d.ctx, PHYSICS_STEP);
  d.mod = captureSimModuleState();
}

/** A pair, seeded identically, as the real thing would be. */
function makePair(conditions = PERFECT_LINK, rand: () => number = Math.random) {
  const [ta, tb] = MemoryTransport.pair(conditions, true, rand);
  const a = makeDevice(ta, 0, "pair-run");
  const b = makeDevice(tb, 1, "pair-run");
  return { a, b };
}

/** A tick in milliseconds, for the manual transports' delivery clock. */
const TICK_MS = 1000 / 120;

/** Run both devices to `ticks`, handing the manual transports their deliveries. */
let pairWallMs = 0;

function runPair(
  a: Device, b: Device, ticks: number,
  inject?: (tick: number, side: Device, player: PlayerId) => GameCommand | null,
): void {
  for (let i = 0; i < ticks; i++) {
    for (const [d, p] of [[a, 0], [b, 1]] as [Device, PlayerId][]) {
      const cmd = inject?.(d.session.currentTick, d, p);
      if (cmd) d.session.submit(cmd);
    }
    // Both sides' pipes advance by one tick of real time, then both sides get
    // one tick of budget. A device that has not heard from the other simply
    // does not step, which is the stall the design promises.
    pairWallMs += TICK_MS;
    a.transport.deliverUntil(pairWallMs);
    b.transport.deliverUntil(pairWallMs);
    a.session.run(a.ctx.game, 1, () => stepDevice(a), { modifiers: plainModifiers() });
    b.session.run(b.ctx.game, 1, () => stepDevice(b), { modifiers: plainModifiers() });
  }
}

function fingerprint(d: Device): string {
  return `${motionHash(d.ctx.game)}/${topologyHash(d.ctx.game)}`;
}

describe("two devices, one board", () => {
  it("stays identical over a few thousand ticks with both players cutting", () => {
    const { a, b } = makePair();
    const cutter = (tick: number, d: Device, player: PlayerId): GameCommand | null => {
      // Player 0 cuts on the left, player 1 on the right, at different times,
      // so the log genuinely interleaves rather than being one player's.
      const want = player === 0 ? tick === 200 || tick === 800 : tick === 500 || tick === 1100;
      if (!want) return null;
      const x = player === 0 ? 300 : 560;
      const y = player === 0 ? 300 : 420;
      const region = findRegionContainingPoint(d.ctx.game.regions, x, y);
      if (!region) return null;
      return {
        kind: "cut", player,
        start: { x, y }, end: { x, y: y + 100 },
        path: null, regionId: region.id, fenceTypeId: STANDARD_FENCE_ID,
      };
    };
    runPair(a, b, 1600, cutter);

    expect(a.session.stats.ticksRun, "the pair never got going").toBeGreaterThan(1400);
    expect(fingerprint(b)).toBe(fingerprint(a));
    expect(a.session.stats.desyncs, "the boards drifted apart").toBe(0);
  });

  it("survives a link with latency, jitter and loss", () => {
    const rand = mulberry32(99);
    const { a, b } = makePair({ latencyMs: 60, jitterMs: 25, loss: 0 }, rand);
    runPair(a, b, 900);
    expect(a.session.stats.ticksRun).toBeGreaterThan(600);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it("stalls rather than diverging when the other device goes quiet", () => {
    const { a, b } = makePair();
    runPair(a, b, 200);
    const atSilence = a.session.currentTick;
    // b stops sending entirely.
    b.transport.close();
    for (let i = 0; i < 200; i++) {
      a.session.run(a.ctx.game, 1, () => stepDevice(a), { modifiers: plainModifiers() });
    }
    expect(a.session.currentTick, "the local sim ran on without its partner")
      .toBeLessThanOrEqual(atSilence + a.session.delayTicks);
  });
});

describe("a desync is caught and repaired", () => {
  it("notices a nudged ball within a hash window and puts it back", () => {
    const { a, b } = makePair();
    runPair(a, b, 200);
    expect(fingerprint(b)).toBe(fingerprint(a));

    // Nudge the guest's board the way a last-bit difference would, only bigger
    // so it cannot wash out.
    b.ctx.game.balls[0].position.x += 5;
    expect(motionHash(b.ctx.game)).not.toBe(motionHash(a.ctx.game));

    const stages: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b.session as any).cb = { onDesync: (s: string) => stages.push(s) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a.session as any).cb = { onDesync: (s: string) => stages.push(s) };

    runPair(a, b, HASH_EVERY * 4);
    expect(stages, "nobody noticed the nudge").toContain("motion");
    expect(b.session.stats.resyncs + a.session.stats.resyncs,
      "it was noticed but never repaired").toBeGreaterThan(0);
    expect(fingerprint(b), "the guest never got back on the host's board")
      .toBe(fingerprint(a));
  });

  it("escalates past a motion patch when the boards are different shapes", () => {
    const { a, b } = makePair();
    runPair(a, b, 120);
    // A wall on one side only: no amount of position-patching fixes this.
    b.ctx.game.wallCount += 7;
    expect(topologyHash(b.ctx.game)).not.toBe(topologyHash(a.ctx.game));

    const stages: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a.session as any).cb = { onDesync: (s: string) => stages.push(s) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b.session as any).cb = { onDesync: (s: string) => stages.push(s) };
    runPair(a, b, HASH_EVERY * 4);
    expect(stages, "a shape difference was treated as drift").toContain("replay");
  });
});

describe("the input delay follows the link", () => {
  it("sits at the floor on a fast link and rises on a slow one", () => {
    const [fast] = MemoryTransport.pair({ latencyMs: 2, jitterMs: 0, loss: 0 }, true);
    const quick = new LockstepSession({ transport: fast, localPlayer: 0, isHost: true });
    quick.run({ balls: [], movers: [], activeWalls: [], walls: [], regions: [] } as never, 0,
      () => {}, { modifiers: plainModifiers() });
    expect(quick.delayTicks).toBe(6);

    const [slow] = MemoryTransport.pair({ latencyMs: 90, jitterMs: 0, loss: 0 }, true);
    const laggy = new LockstepSession({ transport: slow, localPlayer: 0, isHost: true });
    laggy.run({ balls: [], movers: [], activeWalls: [], walls: [], regions: [] } as never, 0,
      () => {}, { modifiers: plainModifiers() });
    expect(laggy.delayTicks).toBeGreaterThan(6);
    expect(laggy.delayTicks).toBeLessThanOrEqual(24);
  });
});

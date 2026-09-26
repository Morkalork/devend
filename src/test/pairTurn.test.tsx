/**
 * A pair takes turns: one fences, the other watches (net/pairTurn.ts).
 *
 * The rule is enforced where commands APPLY, on both phones from the same
 * state, so the thing to pin is not only "the rule says no" but "both boards
 * said no to the same command, and handed the turn over on the same tick".
 * That runs two full simulations through the real lockstep, as the other
 * pair tests do.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { MemoryTransport, PERFECT_LINK } from "@/lib/net/transport";
import { LockstepSession } from "@/lib/net/lockstep";
import { motionHash, topologyHash, captureMotion, applyMotion } from "@/lib/net/stateHash";
import { captureSimModuleState, restoreSimModuleState, type SimModuleState } from "@/lib/net/simState";
import type { GameCommand, PlayerId } from "@/lib/net/commands";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import {
  commandAllowed, firstTurnPlayer, settlePairTurn, startPairTurns, turnViewFor,
} from "@/lib/net/pairTurn";
import { PairTurnOverlay } from "@/components/game/PairTurnOverlay";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER } from "./fixtures/maps";

const board = LADDER.find(l => l.level === 3)!;

afterEach(() => { releaseClock(); setRunSeedText(null); cleanup(); });

// ── the rule ────────────────────────────────────────────────────────────────

const cut = (player: PlayerId): GameCommand => ({
  kind: "cut", player, start: { x: 0, y: 0 }, end: { x: 0, y: 1 },
  path: null, regionId: "r", fenceTypeId: STANDARD_FENCE_ID,
});

function gameWith(turn: ReturnType<typeof startPairTurns> | null, walls: { isComplete: boolean; player: PlayerId }[] = []) {
  return { pairTurn: turn, activeWalls: walls } as unknown as CanvasGameState;
}

describe("the turn rule", () => {
  it("lets anyone do anything in solo play", () => {
    expect(commandAllowed(gameWith(null), cut(1))).toBe(true);
  });

  it("gives the board to one player, one fence a turn", () => {
    const g = gameWith({ player: 0, spent: false, seq: 0 });
    expect(commandAllowed(g, cut(0))).toBe(true);
    expect(commandAllowed(g, cut(1)), "the spectator drew").toBe(false);
    expect(commandAllowed(g, { kind: "freezeTap", player: 1, at: { x: 0, y: 0 }, regionId: "r", useCharge: false })).toBe(false);
    expect(commandAllowed(g, { kind: "ability", player: 1, abilityId: "slowAll" })).toBe(false);
    g.pairTurn!.spent = true;
    expect(commandAllowed(g, cut(0)), "a second fence on one turn").toBe(false);
    // Guarding the fence that is building is still the turn.
    expect(commandAllowed(g, { kind: "freezeTap", player: 0, at: { x: 0, y: 0 }, regionId: "r", useCharge: false })).toBe(true);
  });

  it("lets a spectator finish a mover drag the turn ended under them", () => {
    const g = gameWith({ player: 0, spent: false, seq: 0 });
    expect(commandAllowed(g, { kind: "moverRelease", player: 1 })).toBe(true);
    expect(commandAllowed(g, { kind: "moverGrab", player: 1, moverId: "m", pointer: { x: 0, y: 0 }, driveMultiplier: 1, canDerail: false, canBand: false })).toBe(false);
  });

  it("hands over when the fence is done, not when it is drawn", () => {
    const g = gameWith({ player: 0, spent: true, seq: 0 }, [{ isComplete: false, player: 0 }]);
    settlePairTurn(g);
    expect(g.pairTurn!.player, "handed over while the fence was still growing").toBe(0);
    g.activeWalls[0].isComplete = true;
    settlePairTurn(g);
    expect(g.pairTurn).toEqual({ player: 1, spent: false, seq: 1 });
  });

  it("lets only the player on turn pass, and only before they have drawn", () => {
    const g = gameWith({ player: 1, spent: false, seq: 3 });
    expect(commandAllowed(g, { kind: "passTurn", player: 0 })).toBe(false);
    expect(commandAllowed(g, { kind: "passTurn", player: 1 })).toBe(true);
    g.pairTurn!.spent = true;
    expect(commandAllowed(g, { kind: "passTurn", player: 1 })).toBe(false);
  });

  it("alternates who opens a map", () => {
    expect([1, 2, 3, 4].map(firstTurnPlayer)).toEqual([0, 1, 0, 1]);
  });

  it("reads the same turn as yours on one phone and theirs on the other", () => {
    const t = { player: 0 as PlayerId, spent: false, seq: 0 };
    expect(turnViewFor(t, 0)).toBe("yours");
    expect(turnViewFor(t, 1)).toBe("theirs");
    expect(turnViewFor({ ...t, spent: true }, 0)).toBe("yoursSpent");
  });
});

// ── two phones ──────────────────────────────────────────────────────────────

interface Device { ctx: ReturnType<typeof createBotGame>; session: LockstepSession; mod: SimModuleState; transport: MemoryTransport }

function makeDevice(transport: MemoryTransport, player: PlayerId): Device {
  releaseClock();
  installClock();
  setRunSeedText("pair-turns");
  const ctx = createBotGame(board, 3, plainModifiers());
  ctx.game.pairTurn = startPairTurns(3);
  const device = { ctx, transport, mod: captureSimModuleState(), session: new LockstepSession({ transport, localPlayer: player, isHost: player === 0 }) };
  releaseClock();
  return device;
}

function stepDevice(d: Device): void {
  restoreSimModuleState(d.mod);
  stepBot(d.ctx, PHYSICS_STEP);
  d.mod = captureSimModuleState();
}

let wallMs = 0;
function runPair(a: Device, b: Device, ticks: number, inject: (tick: number, d: Device, p: PlayerId) => GameCommand | null) {
  for (let i = 0; i < ticks; i++) {
    for (const [d, p] of [[a, 0], [b, 1]] as [Device, PlayerId][]) {
      const cmd = inject(d.session.currentTick, d, p);
      if (cmd) d.session.submit(cmd);
    }
    wallMs += 1000 / 120;
    a.transport.deliverUntil(wallMs);
    b.transport.deliverUntil(wallMs);
    a.session.run(a.ctx.game, 1, () => stepDevice(a), { modifiers: plainModifiers() });
    b.session.run(b.ctx.game, 1, () => stepDevice(b), { modifiers: plainModifiers() });
  }
}

const realCut = (d: Device, player: PlayerId, x: number, y: number): GameCommand | null => {
  const region = findRegionContainingPoint(d.ctx.game.regions, x, y);
  if (!region) return null;
  return {
    kind: "cut", player, start: { x, y }, end: { x, y: y + 100 },
    path: null, regionId: region.id, fenceTypeId: STANDARD_FENCE_ID,
  };
};

describe("two phones taking turns", () => {
  it("refuse the spectator on both boards, and hand over on the same tick", () => {
    const [ta, tb] = MemoryTransport.pair(PERFECT_LINK, true);
    const a = makeDevice(ta, 0);
    const b = makeDevice(tb, 1);
    // Map 3 is player 0's to open.
    expect(a.ctx.game.pairTurn!.player).toBe(0);

    // Tick 100: player 1 jumps the queue. Tick 200: player 0 fences.
    runPair(a, b, 400, (tick, d, p) => {
      if (p === 1 && tick === 100) return realCut(d, 1, 560, 420);
      if (p === 0 && tick === 200) return realCut(d, 0, 300, 300);
      return null;
    });
    expect(a.ctx.game.wallCount, "the spectator's fence went up, or the player's did not").toBe(1);
    expect(b.ctx.game.wallCount).toBe(a.ctx.game.wallCount);
    expect(a.ctx.game.walls.every(w => (w as { player?: number }).player !== 1)).toBe(true);

    // Run on until player 0's fence is done and the turn has moved.
    runPair(a, b, 1200, () => null);
    expect(a.ctx.game.pairTurn!.player, "the turn never passed").toBe(1);
    expect(b.ctx.game.pairTurn).toEqual(a.ctx.game.pairTurn);

    // Now player 1 may draw, and player 0 may not.
    const walls = a.ctx.game.wallCount;
    runPair(a, b, 200, (tick, d, p) => {
      if (tick !== a.session.currentTick) return null;
      return p === 1 ? realCut(d, 1, 560, 420) : realCut(d, 0, 200, 500);
    });
    expect(a.ctx.game.wallCount).toBe(walls + 1);
    expect(`${motionHash(b.ctx.game)}/${topologyHash(b.ctx.game)}`)
      .toBe(`${motionHash(a.ctx.game)}/${topologyHash(a.ctx.game)}`);
    expect(a.session.stats.desyncs, "turns put the boards out of step").toBe(0);
  });

  it("passes on a Pass, on both boards", () => {
    const [ta, tb] = MemoryTransport.pair(PERFECT_LINK, true);
    const a = makeDevice(ta, 0);
    const b = makeDevice(tb, 1);
    runPair(a, b, 60, (tick, _d, p) => (p === 0 && tick === 10 ? { kind: "passTurn", player: 0 } : null));
    expect(a.ctx.game.pairTurn).toEqual({ player: 1, spent: false, seq: 1 });
    expect(b.ctx.game.pairTurn).toEqual(a.ctx.game.pairTurn);
  });
});

describe("a repair puts the turn back too", () => {
  it("carries the turn in the resync snapshot and the topology hash", () => {
    releaseClock();
    installClock();
    setRunSeedText("pair-turns");
    const host = createBotGame(board, 3, plainModifiers()).game;
    host.pairTurn = { player: 1, spent: true, seq: 4 };
    const snap = captureMotion(host, 50);
    const guest = createBotGame(board, 3, plainModifiers()).game;
    guest.pairTurn = { player: 0, spent: false, seq: 3 };
    expect(topologyHash(guest), "a turn disagreement is invisible to the hash").not.toBe(topologyHash(host));
    applyMotion(guest, snap);
    expect(guest.pairTurn).toEqual(host.pairTurn);
  });
});

// ── what the players see ────────────────────────────────────────────────────

describe("the board says whose turn it is", () => {
  it("lights up and offers Pass on your turn", () => {
    const onPass = vi.fn();
    render(<PairTurnOverlay turn={{ view: "yours", seq: 0 }} partnerName="Ada" myColor="#00ff88" partnerColor="#ffb347" onPass={onPass} />);
    expect(screen.getByTestId("pair-turn-glow")).toBeTruthy();
    expect(screen.getByTestId("pair-turn-tag").textContent).toMatch(/Your turn/);
    fireEvent.click(screen.getByText("Pass"));
    expect(onPass).toHaveBeenCalledOnce();
  });

  it("dims the board and says you are spectating on theirs", () => {
    render(<PairTurnOverlay turn={{ view: "theirs", seq: 1 }} partnerName="Ada" myColor="#00ff88" partnerColor="#ffb347" />);
    expect(screen.queryByTestId("pair-turn-glow")).toBeNull();
    expect(screen.getByTestId("pair-spectator-dim")).toBeTruthy();
    const tag = screen.getByTestId("pair-turn-tag").textContent ?? "";
    expect(tag).toMatch(/Spectating/);
    expect(tag).toMatch(/Ada's turn/);
    expect(screen.queryByText("Pass")).toBeNull();
  });

  it("shows nothing in solo play", () => {
    const { container } = render(<PairTurnOverlay turn={null} partnerName="Ada" myColor="#0f0" partnerColor="#fb3" />);
    expect(container.innerHTML).toBe("");
  });

  it("refuses a spectator's finger before any fence line is drawn", () => {
    // The input layer is where the player hears "not your turn": pinned by
    // source, since a render of it boots a canvas and none of this needs one.
    const src = readFileSync("src/hooks/useGameInput.ts", "utf8");
    const guard = src.indexOf("game.pairTurn && game.pairTurn.player !== getLocalPlayer()");
    const swipeStarts = src.search(/game\.swipeStart\s+=\s+worldPos/);
    expect(guard, "no spectator guard in the input layer").toBeGreaterThan(-1);
    expect(swipeStarts, "the swipe start moved; re-anchor this pin").toBeGreaterThan(-1);
    expect(src.slice(guard, guard + 200)).toContain("partnersTurn");
    expect(guard, "a spectator's swipe starts before the guard").toBeLessThan(swipeStarts);
  });
});

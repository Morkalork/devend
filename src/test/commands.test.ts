/**
 * Commands, and the replay they buy (TWO_PLAYER_PLAN.md step 3).
 *
 * The property being pinned is not "a cut works". It is that a player action
 * is a VALUE: applying the same list of commands to the same seeded board
 * twice produces the same board twice, on a machine that never saw the finger
 * that made them. That is what two-player needs, and it is also what turns a
 * bug report into a file.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { enqueueCommand, drainCommands, type GameCommand } from "@/lib/net/commands";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { LADDER } from "./fixtures/maps";

afterEach(() => { releaseClock(); setRunSeedText(null); });

const board = LADDER.find(l => l.level === 3)!;

/** Everything about the board that two devices have to agree on. */
function fingerprint(game: import("@/types/gameState").CanvasGameState): string {
  const balls = game.balls
    .map(b => `${b.id}:${b.position.x.toFixed(6)},${b.position.y.toFixed(6)}` +
              `:${b.velocity.x.toFixed(6)},${b.velocity.y.toFixed(6)}:${b.state}:${b.regionId}`)
    .join("|");
  const walls = game.walls.map(w =>
    `${w.id}:${w.start.x.toFixed(3)},${w.start.y.toFixed(3)}-${w.end.x.toFixed(3)},${w.end.y.toFixed(3)}`).join("|");
  const growing = game.activeWalls.map(w =>
    `${w.startPoint.x.toFixed(4)},${w.startPoint.y.toFixed(4)}` +
    `>${w.endPoint.x.toFixed(4)},${w.endPoint.y.toFixed(4)}:${w.isComplete}:${w.player ?? 0}`).join("|");
  const grid = game.spaceGrid
    ? game.spaceGrid.cells.reduce((h, c, i) => (h * 31 + c * (i % 7 + 1)) >>> 0, 17).toString(16)
    : "none";
  return [balls, walls, growing, grid, game.wallCount, (game.spaceRemainingPercent ?? 0).toFixed(4)].join("//");
}

/**
 * Play a map for `frames`, applying each command at the tick it is booked for.
 * Nothing here is a pointer event: this is a machine replaying a log.
 */
function replay(log: { tick: number; cmd: GameCommand }[], frames: number): string {
  releaseClock();
  installClock();
  setRunSeedText("command-replay");
  try {
    const ctx = createBotGame(board, 3, plainModifiers());
    for (let tick = 0; tick < frames; tick++) {
      for (const entry of log) {
        if (entry.tick !== tick) continue;
        // The region is resolved where the gesture happens, as the pointer
        // layer resolves it: a cut naming a region the board does not have
        // builds a fence that can never split anything, which is how the
        // first version of this file managed a negative control that passed
        // by doing nothing at all.
        const cmd = entry.cmd;
        if (cmd.kind === "cut") {
          const region = findRegionContainingPoint(ctx.game.regions, cmd.start.x, cmd.start.y);
          if (!region) continue;
          enqueueCommand(ctx.game, { ...cmd, regionId: region.id });
        } else {
          enqueueCommand(ctx.game, cmd);
        }
      }
      stepBot(ctx, PHYSICS_STEP);
    }
    return fingerprint(ctx.game);
  } finally {
    releaseClock();
    setRunSeedText(null);
  }
}

/** A cut command aimed at a point the board actually has a region at. */
function cutAt(x: number, y: number, dx: number, dy: number): GameCommand {
  return {
    kind: "cut",
    player: 0,
    start: { x, y },
    end: { x: x + dx, y: y + dy },
    path: null,
    regionId: "",              // filled in from the live board by replay()
    fenceTypeId: STANDARD_FENCE_ID,
  };
}

describe("a command is a value, not an event", () => {
  it("replays a map identically from the same seed and the same log", () => {
    const log = [
      { tick: 120, cmd: cutAt(400, 300, 0, 100) },
      { tick: 420, cmd: cutAt(300, 500, 100, 0) },
      { tick: 900, cmd: cutAt(600, 400, 0, 100) },
    ];
    const first = replay(log, 1500);
    const second = replay(log, 1500);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("notices when the log differs, so the test above is not vacuous", () => {
    // Deliberately a different PLACE rather than a different tick. Shifting a
    // cut by one tick turned out to leave this board bit-identical - the fence
    // lands in a corner the balls do not reach inside the window - which would
    // have made this control pass while proving nothing.
    const a = replay([{ tick: 120, cmd: cutAt(400, 300, 0, 100) }], 1500);
    const b = replay([{ tick: 120, cmd: cutAt(250, 250, 100, 0) }], 1500);
    expect(b, "two different cuts left the board in exactly the same state").not.toBe(a);
  });

  it("applies a cut through the queue rather than at the pointer", () => {
    releaseClock(); installClock(); setRunSeedText("queue-probe");
    const ctx = createBotGame(board, 3, plainModifiers());
    const region = findRegionContainingPoint(ctx.game.regions, 400, 300);
    expect(region, "the probe aimed at empty space").toBeTruthy();

    const before = ctx.game.activeWalls.length;
    enqueueCommand(ctx.game, { ...cutAt(400, 300, 0, 100), regionId: region!.id } as GameCommand);
    expect(ctx.game.activeWalls.length, "queueing alone must not build a fence").toBe(before);
    expect(ctx.game.pending).toHaveLength(1);

    drainCommands(ctx.game, { modifiers: plainModifiers() });
    expect(ctx.game.activeWalls.length, "draining must build it").toBe(before + 1);
    expect(ctx.game.pending, "the queue is emptied by the drain").toHaveLength(0);
  });

  it("stamps a fence with the player who drew it", () => {
    releaseClock(); installClock(); setRunSeedText("player-probe");
    const ctx = createBotGame(board, 3, plainModifiers());
    const region = findRegionContainingPoint(ctx.game.regions, 400, 300)!;
    enqueueCommand(ctx.game, { ...cutAt(400, 300, 0, 100), player: 1, regionId: region.id } as GameCommand);
    drainCommands(ctx.game, { modifiers: plainModifiers() });
    expect(ctx.game.activeWalls.at(-1)?.player).toBe(1);
  });

  it("ignores a mover move from the player who is not holding it", () => {
    releaseClock(); installClock(); setRunSeedText("mover-probe");
    const ctx = createBotGame(board, 3, plainModifiers());
    ctx.game.moverDrag = {
      moverId: "m1", pointerId: -1, pointer: { x: 10, y: 10 }, ref: 0,
      driveMultiplier: 1, canDerail: false, canBand: false,
      stopHoldMs: 0, derailAt: 0, player: 0,
    };
    drainCommands(ctx.game, { modifiers: plainModifiers() });
    enqueueCommand(ctx.game, { kind: "moverMove", player: 1, pointer: { x: 999, y: 999 } });
    drainCommands(ctx.game, { modifiers: plainModifiers() });
    expect(ctx.game.moverDrag?.pointer, "the other player moved a mover they are not holding")
      .toEqual({ x: 10, y: 10 });

    enqueueCommand(ctx.game, { kind: "moverMove", player: 0, pointer: { x: 42, y: 43 } });
    drainCommands(ctx.game, { modifiers: plainModifiers() });
    expect(ctx.game.moverDrag?.pointer).toEqual({ x: 42, y: 43 });
  });
});

describe("the pointer layer no longer reaches into the game state", () => {
  it("builds no fence of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/hooks/useGameInput.ts", "utf8");
    expect(src, "the input layer still pushes a wall; it should send a cut command")
      .not.toMatch(/activeWalls\.push\(/);
    expect(src, "the input layer still stamps a freeze; it should send a freezeTap command")
      .not.toMatch(/\.frozenUntil\s*=/);
    expect(src, "the input layer still removes a ball; it should send a tapRemove command")
      .not.toMatch(/game\.balls\s*=\s*game\.balls\.filter/);
    expect(src, "the input layer still writes a mover grab; it should send a moverGrab command")
      .not.toMatch(/game\.moverDrag\s*=\s*\{/);
  });
});

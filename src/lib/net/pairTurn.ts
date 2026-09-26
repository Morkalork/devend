/**
 * pairTurn — whose go it is, in a pair.
 *
 * Two players drawing at once turned out to be the worst way to play one
 * board: two fences growing into each other's balls, neither player sure
 * whose line that was, and the one who waits for a clean moment beaten to it
 * by the one who does not. So a pair takes turns. One player fences while the
 * other watches; when that fence is DONE, built or broken, the other player
 * has the board.
 *
 * "Done" and not "drawn": if the turn passed the moment a fence was drawn,
 * the partner could draw straight into a fence still growing, which is the
 * pile-up turns exist to prevent. Watching a partner's fence race a ball is
 * the spectator's part of the game.
 *
 * Everything here is SIMULATION state, on the game object, advanced only at
 * tick boundaries by drainCommands (commands.ts). Both phones run the same
 * ticks with the same commands, so both reach "the fence is done" on the same
 * tick and hand the turn over on the same tick, and nothing has to be sent to
 * agree on it. It is in the topology hash and the resync snapshot
 * (stateHash.ts) for the day a repair has to put it back.
 *
 * Solo play never has a turn: `game.pairTurn` is absent, and every check here
 * says yes.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GameCommand, PlayerId } from "@/lib/net/commands";

/** The partner's standard fence colour (wallLayer.ts, PARTNER_FENCE); player
 *  0's is the board's own accent. The turn overlay speaks in the fences'
 *  colours, so "whose turn" and "whose fence" are one colour each. */
export const PARTNER_FENCE_HEX = "#ffb347";

export interface PairTurn {
  /** Who has the board. */
  player: PlayerId;
  /** They have drawn their fence; the turn ends when it is done. */
  spent: boolean;
  /**
   * Bumped every time the turn changes hands. The screen watches this rather
   * than `player` so a turn that comes straight back to the same player
   * (never, today, but a pass by a partner who just passed would) still reads
   * as a new turn.
   */
  seq: number;
}

/**
 * Who opens a map. The host opens the first, the guest the second, and so on,
 * so the first fence of a map, which is usually the best one on the board,
 * does not always go to the same player.
 */
export function firstTurnPlayer(levelNumber: number): PlayerId {
  return (Math.max(1, Math.floor(levelNumber)) - 1) % 2 === 0 ? 0 : 1;
}

export function startPairTurns(levelNumber: number): PairTurn {
  return { player: firstTurnPlayer(levelNumber), spent: false, seq: 0 };
}

/** Whether a player's fence is still on its way. */
function fenceInFlight(game: CanvasGameState, player: PlayerId): boolean {
  return game.activeWalls.some(w => !w.isComplete && (w.player ?? 0) === player);
}

function handOver(turn: PairTurn): void {
  turn.player = turn.player === 0 ? 1 : 0;
  turn.spent = false;
  turn.seq += 1;
}

/**
 * Pass the turn if the fence it was spent on is done. Called at the top of
 * every tick, before that tick's commands, so a fence that finished on tick N
 * hands over on tick N+1 on both phones.
 */
export function settlePairTurn(game: CanvasGameState): void {
  const turn = game.pairTurn;
  if (!turn || !turn.spent) return;
  if (fenceInFlight(game, turn.player)) return;
  handOver(turn);
}

/**
 * The commands a spectator may still send.
 *
 * Moving or letting go of a mover they grabbed during their own turn: a drag
 * the turn ended in the middle of must still be able to finish, or the mover
 * stays held by a hand that is no longer allowed to move it.
 */
const SPECTATOR_MAY: ReadonlySet<GameCommand["kind"]> = new Set(["moverMove", "moverRelease"]);

/**
 * Whether this command is allowed on this turn.
 *
 * The rule the whole mode hangs on, so it lives in one place and is asked by
 * both the pointer layer (to refuse with a message, where the finger is) and
 * applyCommand (to refuse for real, identically on both phones).
 */
export function commandAllowed(game: CanvasGameState, cmd: GameCommand): boolean {
  const turn = game.pairTurn;
  if (!turn) return true;
  if (cmd.kind === "passTurn") return cmd.player === turn.player && !turn.spent;
  if (SPECTATOR_MAY.has(cmd.kind)) return true;
  if (cmd.player !== turn.player) return false;
  // One fence a turn. The rest of the turn (freezing, tapping, abilities, a
  // mover) is still theirs while that fence builds: protecting it is part of
  // the turn.
  if (cmd.kind === "cut") return !turn.spent;
  return true;
}

/** A fence was drawn on this turn: the turn now ends when it is done. */
export function spendPairTurn(game: CanvasGameState): void {
  if (game.pairTurn) game.pairTurn.spent = true;
}

/**
 * Hand the board over without drawing. For the player who would rather wait
 * for the balls than fence into them, and would otherwise hold their partner
 * up for as long as they waited.
 */
export function passPairTurn(game: CanvasGameState): void {
  if (game.pairTurn && !game.pairTurn.spent) handOver(game.pairTurn);
}

/** What the screen shows for this device. */
export type TurnView = "yours" | "yoursSpent" | "theirs";

export function turnViewFor(turn: PairTurn, local: PlayerId): TurnView {
  if (turn.player !== local) return "theirs";
  return turn.spent ? "yoursSpent" : "yours";
}

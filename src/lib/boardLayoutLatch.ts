/**
 * When the board is allowed to move.
 *
 * The board's place on screen is worked out from the surface it is drawn on
 * and the bar stack pinned under it (computeBoardRect). Both are live DOM, and
 * both change size in the first moments of a map: the stack gains its rows as
 * the game reports its state, and grows again mid-map (a new ability row, the
 * push-exit bar, a two-line message). Re-laying the board out on every one of
 * those is what made it jump after it had appeared - reported as "once the
 * actual game board warps in, it moves the position of the game board twice".
 *
 * So the layout is latched. A map is laid out once, and a change to the stack
 * alone moves it again only when the stack would now cover the board - the one
 * case where staying put is worse than moving, because bars over the board
 * swallow cuts (issue #78). On a portrait phone the board is width-limited and
 * centred in a band taller than itself, so the stack can grow by a row or two
 * (about 75 CSS px on the phone this was traced on) before that happens.
 *
 * A real viewport change (rotation, a window resize) is still a full re-layout;
 * that path is held while a fence is in flight (lib/boardResizeHold).
 */
import {
  BOARD_HEIGHT, BOARD_FRAME_THICKNESS, MAX_BOTTOM_INSET_PERCENT, type BoardRect,
} from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

/** Where the drawn board ends: the arena's bottom edge plus the outer frame. */
export function visibleBoardBottom(rect: BoardRect): number {
  const margin = BOARD_HEIGHT * ARENA_MARGIN;
  return rect.top + (BOARD_HEIGHT - margin + BOARD_FRAME_THICKNESS) * rect.scale;
}

/**
 * Does a bottom stack `bottomInset` tall, on a surface `surfaceHeight` tall,
 * reach up over the board laid out at `rect`? Same pixels throughout, and the
 * same model computeBoardRect lays out against: the stack owns the bottom
 * `bottomInset` of the surface, clamped the same way (a stack is never given
 * more than half of it). Half a pixel of slack so rounding in the layout
 * itself never reads as an overlap.
 */
export function stackCoversBoard(rect: BoardRect, surfaceHeight: number, bottomInset: number): boolean {
  const inset = Math.min(Math.max(0, bottomInset), surfaceHeight * MAX_BOTTOM_INSET_PERCENT);
  return visibleBoardBottom(rect) > surfaceHeight - inset + 0.5;
}

/**
 * The stack height to lay the board out against: the taller of the stack as it
 * stands right now and the deepest the screen has measured it.
 *
 * `live` is read at the moment of layout, so the first layout of a map sees the
 * real stack instead of the fallback guess the measuring hook reports before
 * its first reading. `deepest` keeps a stack that has briefly emptied (it
 * unmounts its rows when a map is won) from laying the next map out too low.
 * Neither known: `fallback`, which over-reserves on purpose.
 */
export function layoutInset(live: number | null, deepest: number | null, fallback: number): number {
  const best = Math.max(live ?? 0, deepest ?? 0);
  return best > 0 ? best : fallback;
}

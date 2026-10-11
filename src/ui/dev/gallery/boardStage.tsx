/**
 * The board overlays' gallery stand-in (gallery/board.tsx). There is no board
 * under an overlay in the gallery, so each entry draws one: the top bar's
 * strip, the play region under it (what GameScreen's `region` hands its
 * overlays), and in it GameCanvas's container with the board's frame and
 * arena, laid out the way GameCanvas measures them (boardFrameCss and the
 * canvas box).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { BoardFrameCss } from "@/ui/game/overlayModel";
import { BOARD_FRAME_THICKNESS, BOARD_WIDTH } from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";
import { COLOR, tint, useUiScreen, View } from "../../kit/ui";

/** The stand-in board, in screen CSS px. */
export interface FakeBoard {
  /** GameScreen's play region. */
  region: { x: number; y: number; width: number; height: number };
  /** GameCanvas's container's top-left, and its size. */
  origin: { x: number; y: number };
  size: { width: number; height: number };
  /** The drawn frame, relative to the container (boardFrameCss). */
  frame: BoardFrameCss;
  /** The whole 900-unit world, relative to the container (the canvas box). */
  canvas: { canvasWidth: number; canvasHeight: number; canvasOffsetTop: number; canvasOffsetLeft: number };
  /** The board's top edge as a share of the container's height. */
  boardTopPct: number;
}

/** Where the top bar ends, as on a phone. */
const TOP_BAR = 75;
export const ACCENT = "#00ff88";
export const PARTNER = "#ff8fd8";

function fakeBoard(screen: { width: number; height: number }): FakeBoard {
  const region = { x: 0, y: TOP_BAR, width: screen.width, height: Math.max(0, screen.height - TOP_BAR) };
  // GameCanvas's container takes ~70% of the region; the bars sit below it.
  const size = { width: region.width, height: Math.round(region.height * 0.7) };
  const margin = BOARD_WIDTH * ARENA_MARGIN;
  const visibleUnits = BOARD_WIDTH - 2 * margin + 2 * BOARD_FRAME_THICKNESS;
  const outer = Math.min(size.width * 0.97, size.height - 24);
  const scale = outer / visibleUnits;
  const frame: BoardFrameCss = {
    left: (size.width - outer) / 2, top: 12, width: outer, height: outer, frame: BOARD_FRAME_THICKNESS * scale,
  };
  const worldLeft = frame.left + (BOARD_FRAME_THICKNESS - margin) * scale;
  const worldTop = frame.top + (BOARD_FRAME_THICKNESS - margin) * scale;
  return {
    region, origin: { x: region.x, y: region.y }, size, frame,
    canvas: { canvasWidth: BOARD_WIDTH * scale, canvasHeight: BOARD_WIDTH * scale, canvasOffsetTop: worldTop, canvasOffsetLeft: worldLeft },
    boardTopPct: (frame.top / size.height) * 100,
  };
}

/** The stand-in drawn under an entry, then the entry itself on top. */
export function Stage({ children }: { children: (b: FakeBoard) => ReactNode }) {
  const screen = useUiScreen();
  const b = fakeBoard(screen);
  const { frame } = b;
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
      {/* The top bar's strip, and the play region under it. */}
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: TOP_BAR, backgroundColor: COLOR.card }} />
      {/* The board: its frame band, and the dark arena inside it. */}
      <View layout={{
        position: "absolute", left: b.origin.x + frame.left, top: b.origin.y + frame.top, width: frame.width, height: frame.height,
        borderWidth: frame.frame, borderColor: tint(0x00ff88, 0.35), backgroundColor: 0x020806,
      }} />
      {children(b)}
    </View>
  );
}

/** Remounts its content every `everyMs`, so a one-shot effect can be looked at more than once. */
export function Replay({ everyMs, children }: { everyMs: number; children: (key: number) => ReactNode }) {
  const [key, setKey] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setKey(k => k + 1), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return <>{children(key)}</>;
}

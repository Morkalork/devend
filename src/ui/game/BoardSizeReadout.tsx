/**
 * The board's size and scale, top right of GameCanvas's container, in
 * development builds only (GameCanvas decides). A reading for whoever is
 * working on the layout; it was the last line of DOM text over the board.
 */
import { COLOR, Label } from "../kit/ui";
import { Inert } from "./boardParts";

export function BoardSizeReadout({ origin, width, boardWidth, boardHeight, scale }: {
  /** GameCanvas's container's top-left on screen, and its width. */
  origin: { x: number; y: number };
  width: number;
  boardWidth: number;
  boardHeight: number;
  scale: number | string;
}) {
  return (
    <Inert label="board-size" layout={{
      position: "absolute", left: origin.x + Math.max(0, width - 168), top: origin.y + 8, width: 160, alignItems: "flex-end",
    }}>
      <Label text={`${boardWidth}×${boardHeight} @ ${scale}x`} size={11} font="mono" color={COLOR.mutedForeground} alpha={0.5} />
    </Inert>
  );
}

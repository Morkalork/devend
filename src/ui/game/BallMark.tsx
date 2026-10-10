/**
 * The ability mark, drawn for the UI (canvas port of components/game/BallMark.tsx).
 *
 * The board draws these marks with Pixi (see ballLayer.drawMark). This draws
 * the same marks in the codex, where the player reads what they mean - and it
 * reads them out of the same BALL_MARKS table rather than redrawing them by
 * hand (ballMarkModel.ts), because two hand-kept copies of a symbol set is
 * exactly the sort of thing that drifts silently and then teaches the player
 * the wrong glyph.
 *
 * Like the DOM svg it overlays its swatch: absolute, filling the parent's
 * top-left `size` square.
 */
import { useCallback, useMemo } from "react";
import type { Graphics } from "pixi.js";
import { View } from "../kit/ui";
import { ballMarkDrawing } from "./ballMarkModel";

interface Props {
  /** The ball's ability id. A ball with none renders nothing. */
  ability: string | undefined | null;
  /** The ball's colour, which decides whether the mark is drawn light or dark. */
  color: string;
  /** Rendered diameter in px, used only to match the board's stroke weight. */
  size: number;
}

export function BallMark({ ability, color, size }: Props) {
  const mark = useMemo(() => ballMarkDrawing(ability, color, size), [ability, color, size]);
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!mark) return;
    for (const s of mark.shapes) {
      if (s.kind === "dot") {
        g.circle(s.cx, s.cy, s.r).fill(mark.ink);
      } else {
        g.moveTo(s.points[0], s.points[1]);
        for (let i = 2; i < s.points.length; i += 2) g.lineTo(s.points[i], s.points[i + 1]);
        g.stroke({ width: mark.width, color: mark.ink, cap: "round", join: "round" });
      }
    }
  }, [mark]);
  // Nothing at all, not an empty box: it would still take a place in the tree.
  if (!mark) return null;
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: size, height: size }} alpha={0.92}>
      <pixiGraphics draw={draw} />
    </View>
  );
}

/**
 * The How to Play roster's swatches on the canvas: a ball in its colour with
 * the ability mark the board draws (the shared canvas BallMark, which reads
 * the renderer's own BALL_MARKS table), and a bug's colour dot.
 */
import { useCallback } from "react";
import type { Graphics } from "pixi.js";
import { COLOR, View, hex } from "../kit/ui";
import { BallMark } from "../game/BallMark";

/** A soft glow ring around a disc (the DOM's coloured box-shadow). */
function glow(g: Graphics, r: number, color: number, spread: number) {
  for (let i = spread; i > 0; i -= 2) g.circle(0, 0, r + i).fill({ color, alpha: 0.07 });
}

/** A ball swatch with its ability mark (none for a ball that simply rolls). */
export function BallSwatch({ color, ability, size = 48 }: { color: string; ability: string | undefined | null; size?: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const r = size / 2;
    const c = hex(color);
    glow(g, r, c, 12);
    g.circle(0, 0, r).fill({ color: c });
    // The inset shadow toward the bottom right, then the faint white rim.
    g.arc(0, 0, r - 3, -Math.PI * 0.1, Math.PI * 0.6).stroke({ width: 5, color: COLOR.black, alpha: 0.2 });
    g.circle(0, 0, r - 0.5).stroke({ width: 1, color: COLOR.white, alpha: 0.25 });
  }, [color, size]);
  return (
    <View layout={{ width: size, height: size, flexShrink: 0 }}>
      <pixiGraphics draw={draw} x={size / 2} y={size / 2} layout={false} />
      {/* Same shape table as the renderer, so this roster is where a player
          learns to read the board's marks. */}
      <BallMark ability={ability} color={color} size={size} />
    </View>
  );
}

/** A bug's board colour, the only thing a player has to go on in the moment. */
export function BugSwatch({ color, size = 40 }: { color: string; size?: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const r = size / 2;
    const c = hex(color);
    glow(g, r, c, 10);
    g.circle(0, 0, r).fill({ color: c });
    g.circle(0, 0, r - 0.5).stroke({ width: 1, color: COLOR.white, alpha: 0.25 });
  }, [color, size]);
  return (
    <View layout={{ width: size, height: size, flexShrink: 0 }}>
      <pixiGraphics draw={draw} x={size / 2} y={size / 2} layout={false} />
    </View>
  );
}

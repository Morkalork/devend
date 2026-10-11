/**
 * On-screen frame-timing HUD, admin only (canvas port of
 * components/game/PerfOverlay.tsx).
 *
 * The stats are recorded every frame by the game loop; the only other reader
 * paints into a 2D context, which the WebGL board does not have. Drawn on the
 * interface canvas, so it costs the board's renderer nothing and cannot land
 * inside the render timing it reports. A tap clears the worst-frame record.
 */
import { useEffect, useState } from "react";
import { perfLines, perfColor, startLongTaskWatch, resetWorstFrame } from "@/lib/rendering/perfStats";
import { Label, Pressable, RADIUS, tint } from "../kit/ui";
import { cssHex } from "./fxModel";

export function PerfOverlay({ visible, origin }: {
  visible: boolean;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [color, setColor] = useState("#00ff88");

  // Started with the HUD rather than at module load: the observer is only of
  // interest while someone is reading these numbers.
  useEffect(() => { if (visible) startLongTaskWatch(); }, [visible]);

  // Polled, and deliberately slower than the frame rate: the numbers are rolling
  // averages over ~1.5s, so sampling faster would only add renders to the thing
  // being measured.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setLines(perfLines());
      setColor(perfColor());
    }, 250);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;
  const c = cssHex(color);

  return (
    <Pressable
      label="perf-overlay"
      onTap={() => { resetWorstFrame(); setLines(perfLines()); }}
      pressedAlpha={0.85}
      layout={{
        position: "absolute", left: origin.x + 4, top: origin.y + 4,
        // Lines flush left, as the DOM's block rows were: stretched, a shorter
        // line is placed in the middle of its row and the columns stop lining up.
        alignItems: "flex-start",
        paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6,
        borderRadius: RADIUS.base, borderWidth: 1, borderColor: c, backgroundColor: tint(0x000000, 0.72),
      }}
    >
      {lines.map((l, i) => (
        <Label key={i} text={l} size={10} lineHeight={14.5} font="mono"
          color={i === 0 ? c : 0xe6ebf5} alpha={i === 0 ? 1 : 0.92} weight={i === 0 ? "700" : "400"} />
      ))}
    </Pressable>
  );
}

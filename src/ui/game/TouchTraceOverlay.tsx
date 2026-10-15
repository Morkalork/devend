/**
 * The touch trace (lib/touchTrace.ts), bottom left of the board: what the
 * input layer did with the last few touches. Admin only.
 *
 * Deliberately not pressable, unlike the perf HUD: it sits over the board,
 * and anything interactive there is a place a fence cannot start (ui/hitGate),
 * which is the very thing this exists to diagnose.
 */
import { useEffect, useState } from "react";
import { touchTraceLines, touchTraceVersion } from "@/lib/touchTrace";
import { Label, RADIUS, View, tint } from "../kit/ui";

const LINE_H = 14.5;

export function TouchTraceOverlay({ visible, origin, height, lines: fixed }: {
  visible: boolean;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  /** The container's height, in CSS px: the trace hangs from its bottom edge. */
  height: number;
  /** Gallery: show these instead of the live trace. */
  lines?: readonly string[];
}) {
  const [lines, setLines] = useState<readonly string[]>([]);

  // Polled like the perf HUD, and only re-rendered when a line was added.
  useEffect(() => {
    if (!visible || fixed) return;
    let seen = -1;
    const id = setInterval(() => {
      const v = touchTraceVersion();
      if (v !== seen) { seen = v; setLines([...touchTraceLines()]); }
    }, 150);
    return () => clearInterval(id);
  }, [visible, fixed]);

  const shown = fixed ?? lines;
  if (!visible || shown.length === 0) return null;
  const boxH = shown.length * LINE_H + 8;

  return (
    <View
      label="touch-trace"
      layout={{
        position: "absolute", left: origin.x + 4, top: origin.y + height - boxH - 4,
        paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6,
        borderRadius: RADIUS.base, borderWidth: 1, borderColor: 0x38bdf8, backgroundColor: tint(0x000000, 0.72),
      }}
    >
      {shown.map((l, i) => (
        <Label key={i} text={l} size={10} lineHeight={LINE_H} font="mono"
          color={i === shown.length - 1 ? 0x38bdf8 : 0xe6ebf5} alpha={i === shown.length - 1 ? 1 : 0.85} />
      ))}
    </View>
  );
}

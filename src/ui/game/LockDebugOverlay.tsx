/**
 * On-screen lock-decision log, admin only (`devend:lockDebug`; canvas port of
 * components/game/LockDebugOverlay.tsx).
 *
 * Deliberately not a console log: the locks worth investigating happen on a
 * phone against a deployed build, where there is no console to open. It is also
 * why this is plain text with no animation: it has to survive being
 * screenshotted and read back later. The strings are the DOM overlay's own
 * (admin diagnostics, never shown to a player).
 */
import { useEffect, useState } from "react";
import { getLockDecisions, clearLockDecisions, type LockDecision } from "@/lib/lockDiagnostics";
import { Label, Pressable, RADIUS, tint, View } from "../kit/ui";
import { Blocker, Region } from "./boardParts";
import { OUTCOME_COLOR, lockDecisionLine } from "./overlayModel";

// The panel's own colours are the outcomes' (a lock's green, a refusal's
// amber, the boring case's grey), as in the DOM overlay.
const GREEN = OUTCOME_COLOR.locked;
const AMBER = OUTCOME_COLOR["rejected-unsealed"];
const GREY = OUTCOME_COLOR["below-gate"];

export function LockDebugOverlay({ visible, origin, width, height }: {
  visible: boolean;
  /** The play region's top-left on screen, in CSS px (the DOM's positioned wrapper). */
  origin: { x: number; y: number };
  /** The play region's size in CSS px. */
  width: number;
  height: number;
}) {
  const [rows, setRows] = useState<LockDecision[]>([]);

  // Polled rather than pushed: the recorder is called from the physics step,
  // and having it trigger renders would put this overlay in the hot path.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setRows(getLockDecisions().slice(0, 6)), 400);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <Region layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}>
      {/* The panel takes touches (the DOM's pointer-events-auto). Near-opaque
          and monospace on purpose: this gets read back off a phone screenshot
          taken over a busy board, not skimmed live. */}
      <Blocker label="lock-debug" layout={{
        position: "absolute", left: 4, right: 4, bottom: 4,
        paddingTop: 4, paddingBottom: 4, paddingLeft: 5, paddingRight: 5,
        borderRadius: RADIUS.base, borderWidth: 1, borderColor: tint(GREEN, 0x55 / 255), backgroundColor: tint(0x000000, 0.93),
      }}>
        <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <Label text="LOCK DECISIONS (newest first)" size={10} lineHeight={14} font="mono" color={GREEN} />
          <Pressable label="lock-debug-clear" onTap={() => { clearLockDecisions(); setRows([]); }} layout={{ paddingLeft: 4, paddingRight: 4 }}>
            <Label text="clear" size={10} lineHeight={14} font="mono" color={AMBER} />
          </Pressable>
        </View>
        {rows.length === 0 && <Label text="no candidates yet" size={10} lineHeight={14} font="mono" color={GREY} />}
        {/* Wrapped, as the DOM's rows were: a long verdict (sliver, area, boss)
            runs past a phone's width, and shrinking it would defeat reading
            it back off a screenshot. */}
        {rows.map((d, i) => (
          <Label key={i} text={lockDecisionLine(d)} size={10} lineHeight={14} font="mono" color={OUTCOME_COLOR[d.outcome]} wrap />
        ))}
      </Blocker>
    </Region>
  );
}

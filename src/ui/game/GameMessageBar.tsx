/**
 * One line, under the board, saying why the last thing you tried did nothing
 * (canvas port of components/game/GameMessageBar.tsx).
 *
 * Sits in the bottom stack's shared context lane rather than over the board:
 * the message that explains a failed cut is useless if it hides the board you
 * were cutting. Exactly HUD.contextLane tall whether or not a message is up.
 *
 * Takes no taps (plain Views, no Pressable), like the DOM's pointer-events-none.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { MESSAGE_MS, messageExpired, type GameMessage } from "@/lib/gameMessages";
import { Appear, COLOR, Icon, Label, RADIUS, View, hex, tint } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { gameMessageKey } from "./bottomModel";

interface Props {
  message: GameMessage | null;
  accentColor?: string;
  /** Hidden the instant a map is won: nothing here may outlive the board. */
  visible: boolean;
}

export function GameMessageBar({ message, accentColor, visible }: Props) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<GameMessage | null>(null);

  useEffect(() => {
    if (!message) { setShown(null); return; }
    setShown(message);
    // Keyed on `at`, so a repeat of the SAME message restarts the countdown
    // without restarting the animation: the bar holds steady while a player
    // retries an illegal cut instead of flickering once per attempt.
    const id = setTimeout(() => {
      setShown(current => (current && messageExpired(current, Date.now()) ? null : current));
    }, MESSAGE_MS);
    return () => clearTimeout(id);
  }, [message]);

  const accent = accentColor ? hex(accentColor) : COLOR.foreground;

  return (
    <View layout={{ height: HUD.contextLane, alignSelf: "stretch", paddingLeft: 12, paddingRight: 12, paddingBottom: 2, justifyContent: "flex-end", alignItems: "center" }}>
      {shown && visible && (
        // Keyed on `seq`, which only changes for a DIFFERENT message, so
        // swapping messages animates and repeating one does not.
        <Appear key={shown.seq} fromY={6} duration={0.18} layout={{ width: "100%", maxWidth: 896 }}>
          {/* Two lines at most: the lane is fixed, and the longest message in
              any locale wraps to two at this size on a phone. */}
          <View layout={{
            height: 32, flexDirection: "row", alignItems: "center", gap: 8,
            paddingLeft: 12, paddingRight: 12, borderRadius: RADIUS.lg, overflow: "hidden",
            borderWidth: 1, borderColor: tint(accent, 0x55 / 255), backgroundColor: tint(COLOR.black, 0.82),
          }}>
            <Icon icon={Info} size={14} color={accent} />
            <View layout={{ flex: 1 }}>
              <Label text={t(gameMessageKey(shown))} size={11} lineHeight={13} color={COLOR.foreground} wrap />
            </View>
          </View>
        </Appear>
      )}
    </View>
  );
}

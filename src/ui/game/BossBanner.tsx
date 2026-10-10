/**
 * BossBanner (issue #56): the persistent boss nameplate (canvas port of
 * components/game/BossBanner.tsx). The boss name, the deadline counting down
 * (red and pulsing in the final seconds), and a health bar of HP pips that
 * empty as the boss is trapped. Pure presentation; all state is threaded from
 * GameScreen.
 *
 * The DOM version pinned itself 70px from the top, centred over the board. Here
 * the parent places it through `layout`. It takes no touches (the DOM's
 * pointer-events-none), so a cut aimed under it still reaches the board: the
 * root is a raw layout container with eventMode "none", because a kit View with
 * a background is a hit target and the board defers to any hit (hitGate.ts).
 */
import { Skull } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Icon, Label, RADIUS, View, hex, tint, usePulse, type Layout } from "../kit/ui";
import { bossBannerState } from "./bossBannerModel";

interface BossBannerProps {
  name: string;
  timeLimit: number | null;
  activeSeconds: number;
  hp: number;
  maxHp: number;
  defeated: boolean;
  accentColor?: string;
  /** Canvas only: where the parent puts it (the DOM pinned it at top: 70px, centred). */
  layout?: Layout;
}

const URGENT = 0xff5a5a;
const DEFEATED = 0x4ade80;

export function BossBanner({ name, timeLimit, activeSeconds, hp, maxHp, defeated, accentColor = "#ff2d55", layout }: BossBannerProps) {
  const { t } = useTranslation();
  const accent = hex(accentColor);
  const s = bossBannerState(timeLimit, activeSeconds, hp, maxHp, defeated);

  return (
    <layoutContainer eventMode="none" layout={{ flexDirection: "column", alignItems: "center", gap: 4, ...(layout ?? {}) }}>
      <View layout={{
        flexDirection: "row", alignItems: "center", gap: 8,
        paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
        borderRadius: RADIUS.md, borderWidth: 1,
        backgroundColor: tint(0x1c0006, 0.82),
        borderColor: tint(accent, 0xaa / 255),
      }}>
        <Icon icon={Skull} size={16} color={accent} />
        <Label text={name} font="display" size={14} weight="700" upper letterSpacing={0.7} color={accent} glow={10} />
        {s.remaining != null && <Countdown seconds={s.remaining} urgent={s.urgent} />}
      </View>

      <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {defeated ? (
          <Label text={t("boss.defeated")} font="display" size={12} weight="700" upper letterSpacing={0.6} color={DEFEATED} glow={8} />
        ) : (
          s.pips?.map((full, i) => (
            <View key={i} layout={{
              width: 16, height: 8, borderRadius: 2,
              backgroundColor: full ? accent : tint(0xffffff, 0.15),
            }} />
          ))
        )}
      </View>
    </layoutContainer>
  );
}

/** The deadline, pulsing (`animate-pulse`) in the final ten seconds. */
function Countdown({ seconds, urgent }: { seconds: number; urgent: boolean }) {
  const pulse = usePulse(2000, urgent);
  return (
    <Label
      text={`${seconds}s`}
      font="display" size={14} weight="700"
      color={urgent ? URGENT : 0xffd0d8}
      glow={urgent ? 10 : undefined}
      alpha={urgent ? 1 - 0.5 * pulse : 1}
    />
  );
}

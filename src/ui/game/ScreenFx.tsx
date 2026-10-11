/**
 * The play screen's full-screen moments, inline in GameScreen's render until
 * now: the deadline vignette, the boss's phase banner and the SHIPPED IT
 * payoff. Inert and full screen: they set the mood, never take a touch.
 */
import { useCallback } from "react";
import type { Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { Label, TEXT, usePulse, useUiScreen, View } from "../kit/ui";
import { Inert } from "./boardParts";
import { insetGlow } from "./boardDraw";
import { SM_BREAKPOINT } from "./fxModel";

interface Props {
  deadlineUrgent: boolean;
  /** HOTFIX INCOMING / PANIC MODE as the boss's HP drops; null between phases. */
  bossPhaseLabel: string | null;
  bossDefeated: boolean;
  shippedIt: boolean;
}

const BOSS_RED = 0xff2d55;
const SHIPPED_GREEN = 0x4ade80;

export function ScreenFx({ deadlineUrgent, bossPhaseLabel, bossDefeated, shippedIt }: Props) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const pulse = usePulse(2000, deadlineUrgent || !!bossPhaseLabel || shippedIt);
  const breath = 0.6 + 0.4 * pulse;
  const { width, height } = screen;
  // One line each, in a row capped short of the screen's edges, so a long
  // phase name or a narrow phone squeezes the words (which scales them down)
  // instead of cutting them off.
  const row = { flexDirection: "row" as const, maxWidth: width - 32 };
  const fit = { flexShrink: 1 };

  // Deadline tension: a red vignette pressing in from the edges.
  const drawVignette = useCallback((g: Graphics) => {
    g.clear();
    insetGlow(g, width, height, 0xff1e3c, 0.55, 140, 40);
  }, [width, height]);

  // The payoff's soft green bloom from the middle of the screen.
  const drawBloom = useCallback((g: Graphics) => {
    g.clear();
    const cx = width / 2, cy = height / 2;
    // CSS `radial-gradient(circle, c 0%, transparent 60%)`: a circle sized to
    // the farthest corner, fading out at 60% of it.
    const end = Math.hypot(cx, cy) * 0.6;
    const rings = 24;
    for (let i = rings - 1; i >= 0; i--) {
      const r0 = (i / rings) * end, r1 = ((i + 1) / rings) * end;
      const a = 0.18 * (1 - (i + 0.5) / rings);
      g.circle(cx, cy, r1).fill({ color: SHIPPED_GREEN, alpha: a });
      if (r0 > 0) g.circle(cx, cy, r0).cut();
    }
  }, [width, height]);

  if (!deadlineUrgent && !(bossPhaseLabel && !bossDefeated) && !shippedIt) return null;

  return (
    <Inert label="screen-fx" layout={{ position: "absolute", left: 0, top: 0, width, height }}>
      {deadlineUrgent && (
        <Inert layout={{ position: "absolute", left: 0, top: 0, width, height }} alpha={breath}>
          <pixiGraphics draw={drawVignette} />
        </Inert>
      )}

      {/* Boss phase banner, a third of the way down. */}
      {bossPhaseLabel && !bossDefeated && (
        <Inert layout={{ position: "absolute", left: 0, top: height / 3, width, height: 0, alignItems: "center", justifyContent: "center" }}>
          <View layout={row}>
            <Label text={bossPhaseLabel} size={TEXT["2xl"]} font="display" weight="700" upper letterSpacing={TEXT["2xl"] * 0.1}
              color={BOSS_RED} glow={12} alpha={breath} layout={fit} />
          </View>
        </Inert>
      )}

      {/* SHIPPED IT: the boss-defeat payoff flash. */}
      {shippedIt && (
        <Inert layout={{ position: "absolute", left: 0, top: 0, width, height, alignItems: "center", justifyContent: "center" }}>
          <pixiGraphics draw={drawBloom} />
          <View layout={row}>
            <Label text={t("boss.shippedIt")} size={width >= SM_BREAKPOINT ? 48 : TEXT["4xl"]} font="display" weight="700" upper
              letterSpacing={(width >= SM_BREAKPOINT ? 48 : TEXT["4xl"]) * 0.1} color={SHIPPED_GREEN} glow={16} alpha={breath} layout={fit} />
          </View>
        </Inert>
      )}
    </Inert>
  );
}

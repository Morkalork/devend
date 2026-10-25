/**
 * GravityStinger: "FULL GRAVITY!" shouted over the board the moment a
 * full-map gravity map goes live, with the board held still under it
 * (gravityStingerModel.ts has the timeline and the why).
 *
 * Inert: it covers the board but never takes a touch; the map is held anyway.
 * The headline slams in over the violet the map rule already wears, a wide
 * arrow drops through it on a loop, and the board's edge flashes the same
 * violet so the signal reaches peripheral vision as well as the fovea.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowBigDownDash } from "lucide-react";
import { MAP_RULE_VIOLET } from "@/components/game/mapRuleTheme";
import { useReducedMotion } from "../reducedMotion";
import { Icon, Label, hex, tint } from "../kit/ui";
import { GlowFrame, Inert } from "./boardParts";
import { useElapsed } from "./fxClock";
import type { BoardFrameCss } from "./overlayModel";
import { STINGER_SECONDS, STINGER_SECONDS_STILL, stingerState } from "./gravityStingerModel";

interface Props {
  /** Where the board is drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  /** The stinger has run its course: release the board. */
  onDone: () => void;
}

const VIOLET = hex(MAP_RULE_VIOLET);

export function GravityStinger({ frame, origin, onDone }: Props) {
  const { t } = useTranslation();
  const still = useReducedMotion();
  const total = still ? STINGER_SECONDS_STILL : STINGER_SECONDS;
  const elapsed = useElapsed(total + 0.05);
  const s = stingerState(elapsed, still);

  useEffect(() => {
    if (s.done) {
      onDone();
    }
  }, [s.done, onDone]);

  if (!frame) {
    return null;
  }
  const left = origin.x + frame.left;
  const top = origin.y + frame.top;
  const headline = Math.round(Math.min(44, Math.max(28, frame.width * 0.11)));
  const arrow = Math.round(headline * 2.2);
  // The arrow drops from above the headline to below it and loops.
  const arrowY = frame.height * 0.5 - arrow * 1.4 + s.drop * arrow * 1.8;

  return (
    <Inert label="gravity-stinger" layout={{ position: "absolute", left, top, width: frame.width, height: frame.height }} alpha={s.alpha}>
      {/* A violet veil so the headline reads over any board, and the edge flash. */}
      <Inert layout={{ position: "absolute", left: 0, top: 0, width: frame.width, height: frame.height, backgroundColor: tint(0x120a24, 0.55) }} />
      <Inert layout={{ position: "absolute", left: 0, top: 0, width: frame.width, height: frame.height }} alpha={s.edge}>
        <GlowFrame width={frame.width} height={frame.height} color={VIOLET} border={6}
          inner={{ blur: 48, alpha: 0.5 }} outer={{ blur: 28, alpha: 0.6 }} />
      </Inert>
      <Inert layout={{ position: "absolute", left: 0, top: arrowY, width: frame.width, alignItems: "center" }} alpha={0.35}>
        <Icon icon={ArrowBigDownDash} size={arrow} color={VIOLET} strokeWidth={1.5} />
      </Inert>
      {/* The headline: scaled about its own centre, so the slam grows from the
          middle of the board rather than from its top-left corner. */}
      <layoutContainer
        layout={{ position: "absolute", left: frame.width / 2, top: frame.height / 2, width: 0, height: 0 }}
        eventMode="none"
      >
        <layoutContainer scale={s.scale} eventMode="none"
          layout={{ position: "absolute", left: -frame.width / 2, top: -headline, width: frame.width, height: headline * 2, alignItems: "center", justifyContent: "center" }}>
          <Label text={t("game.fullGravityStinger")} font="display" size={headline} weight="900" upper
            letterSpacing={headline * 0.12} color={0xe9dcff} glow={Math.round(14 + 22 * s.glow)} align="center" />
        </layoutContainer>
      </layoutContainer>
    </Inert>
  );
}

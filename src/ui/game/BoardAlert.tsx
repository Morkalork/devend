/**
 * The one thing the player must notice without looking away (canvas port of
 * components/game/BoardAlert.tsx, whose reasoning still holds).
 *
 * The deadline's only visual signal used to be a bar at the bottom of the
 * screen, the furthest point from where the player is looking, so the alert
 * goes over the board. Two rules make that safe rather than obnoxious:
 *
 * TEXT IS THE LAST CHANNEL, NOT THE FIRST. Reading needs foveal attention, which
 * is exactly what is unavailable in the last ten seconds. The edge pulse carries
 * the signal (peripheral vision reads motion and contrast, not glyphs), and the
 * number is a brief flash for the moment the state changes, not a readout.
 *
 * IT NEVER TAKES A TAP. Inert, without exception: an alert that swallows the cut
 * which would have saved the run is worse than no alert.
 *
 * Red and pulsing because the board edge is shared with WinGateFrame's steady
 * amber: two things in one place must differ on two channels (hue AND motion)
 * or they read as one thing.
 */
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "../reducedMotion";
import { Label, TEXT, usePulse } from "../kit/ui";
import { FlashNumeral, GlowFrame, Inert } from "./boardParts";
import { ALARM, alarmEdgeAlpha } from "./overlayModel";

interface Props {
  /** The deadline is close. Drives the edge. */
  urgent: boolean;
  /**
   * Seconds left, shown once as a flash when it changes. Null hides the
   * numeral entirely and leaves only the edge.
   */
  seconds: number | null;
  /** The play region's top-left on screen, in CSS px (the DOM's positioned wrapper). */
  origin: { x: number; y: number };
  /** The play region's size in CSS px. */
  width: number;
  height: number;
}

export function BoardAlert({ urgent, seconds, origin, width, height }: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  if (!urgent) return null;

  return (
    <Inert label="board-alert" layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}>
      {/* The signal itself. Under prefers-reduced-motion it holds steady
          instead of pulsing: the alarm survives, only the animation goes. */}
      <AlarmEdge width={width} height={height} reduceMotion={reduceMotion} />
      {/* One numeral, keyed on the second so each tick replaces the last rather
          than queueing; the same flash as DeadlineFrame's milestones, so the two
          read as one countdown. */}
      {seconds != null && (
        <FlashNumeral key={seconds} value={seconds} color={ALARM} width={width} height={height} duration={0.8} />
      )}
      {/* The word, for a player who does look, kept off the middle of the board
          where the balls are. One word: its job is shape recognition. */}
      <Inert layout={{ position: "absolute", left: 0, bottom: 12, width, flexDirection: "row", justifyContent: "center" }}>
        <Label text={t("game.timeAlarm")} size={TEXT.xs} font="display" weight="700" upper letterSpacing={TEXT.xs * 0.2}
          color={ALARM} glow={8} />
      </Inert>
    </Inert>
  );
}

/** The pulsing edge, on its own so only it re-renders each frame of the pulse. */
function AlarmEdge({ width, height, reduceMotion }: { width: number; height: number; reduceMotion: boolean }) {
  const pulse = usePulse(1000, !reduceMotion);
  return (
    <Inert layout={{ position: "absolute", left: 0, top: 0, width, height }} alpha={alarmEdgeAlpha(pulse, reduceMotion)}>
      <GlowFrame width={width} height={height} color={ALARM} border={3}
        inner={{ blur: 26, alpha: 0x66 / 255 }} outer={{ blur: 16, alpha: 0x55 / 255 }} />
    </Inert>
  );
}

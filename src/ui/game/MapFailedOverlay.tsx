/**
 * Why you just lost a life, shown before the map restarts (canvas port of
 * components/game/MapFailedOverlay.tsx, which carries the full history).
 *
 * The restart WAITS here: running out of time used to dock a life, flash red
 * and remount the level inside 700ms with nothing naming the clock. It is
 * dismissed by a tap or by its own timer, and only then does the level remount.
 *
 * It states two things, in this order: what ended the map, then what was still
 * outstanding when it did, with the numbers. "Out of time" is a rule the player
 * already knew; "you still needed 2 locks and had 1" is what they can act on.
 *
 * `runOver`: the last life gets one too. Same two lines, because the question
 * is identical; what changes is the promise underneath, since "tap to try
 * again" over a finished run is simply untrue.
 *
 * The ticket (the default, as on the Debrief): under the headline, the map's
 * Acceptance Criteria card from before the map, each row marked met or missed
 * on the board as it failed, in place of the "still needed" lines. Admin's
 * "Full debrief" brings the lines back.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Heart, HeartCrack } from 'lucide-react';
import type { MapFailure } from '@/lib/mapFailure';
import type { AcceptanceRow } from '@/types/game';
import { Appear, Icon, Label, Pressable, RADIUS, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { AcceptanceTicket } from "./AcceptanceTicket";
import { isFullDebrief } from "../screens/debriefMode";

import { mapFailedCopy, mapFailedDelay } from "./MapFailedOverlayModel";

interface Props {
  failure: MapFailure;
  /** The pre-map ticket's rows, marked as the map failed; drawn in place of the lines. */
  acceptance?: AcceptanceRow[];
  levelNumber?: number;
  levelId?: string;
  /** Force the "still needed" lines (true) or the ticket (false); default: Admin's choice. */
  full?: boolean;
  /** Lives left after this one was docked, so the stakes are stated too. */
  livesLeft: number;
  /**
   * That life was the last one: this loss ends the RUN.
   *
   * Changes what the overlay promises, because "tap to try again" over a run
   * that is over is a lie, and it waits for a tap rather than hurrying on.
   */
  runOver?: boolean;
  accentColor?: string;
  /** Dismiss: remounts the level and starts the retry, or ends the run. */
  onDismiss: () => void;
}

export function MapFailedOverlay({
  failure, acceptance, levelNumber = 0, levelId = "", full, livesLeft, runOver = false, accentColor = '#ff2244', onDismiss,
}: Props) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const copy = mapFailedCopy(t, failure, livesLeft, runOver);
  // The outstanding lines are fixed at mount: they describe the moment the map
  // ended, not whatever the state does while this is up.
  const [lines] = useState(() => copy.lines);
  const [rows] = useState(() => (full ?? isFullDebrief()) ? undefined : acceptance);
  const accent = hex(accentColor);
  // Inside the scrim's 32px gutters.
  const cardWidth = Math.min(448, screen.width - 64);

  // Auto-dismiss, so a player who has already read it is not made to tap, and
  // one who looked away still gets on with the retry. On the last life this
  // stretches to a backstop instead: see MAP_FAILED_RUN_OVER_MS.
  useEffect(() => {
    const id = setTimeout(onDismiss, mapFailedDelay(runOver, !!rows));
    return () => clearTimeout(id);
  }, [onDismiss, runOver, rows]);

  const ink = 0xc8ffd8;
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={90}>
      <Appear duration={0.25} layout={{ width: screen.width, height: screen.height }}>
        <Pressable
          onTap={onDismiss}
          pressedAlpha={1}
          label={t('mapFailure.title')}
          layout={{
            width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center",
            paddingLeft: 32, paddingRight: 32, backgroundColor: tint(0x040002, 0.92),
          }}
        >
          <Appear fromScale={0.94} fromY={8} duration={0.35}>
            <View layout={{ width: cardWidth, alignItems: "center", gap: rows ? 12 : 16 }}>
              {/* The ticket leaves the warning glyph out: the card needs the room. */}
              {!rows && <Icon icon={AlertTriangle} size={40} color={accent} />}

              <Label text={copy.headline} size={rows ? TEXT.xl : TEXT["2xl"]} weight="900" font="display" upper
                letterSpacing={(rows ? TEXT.xl : TEXT["2xl"]) * 0.1} color={accent} glow={22} align="center" wrap />

              {rows && (
                <AcceptanceTicket rows={rows} levelNumber={levelNumber} levelId={levelId} accent={accent}
                  width={cardWidth} sayAvoided={false} />
              )}

              {!rows && lines.length > 0 && (
                <View layout={{
                  alignSelf: "stretch", borderRadius: RADIUS.lg, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                  borderWidth: 1, borderColor: tint(accent, 0x44 / 255), backgroundColor: tint(accent, 0x0f / 255),
                }}>
                  <Label text={t('mapFailure.stillNeeded')} size={TEXT.xs} font="mono" upper letterSpacing={TEXT.xs * 0.1}
                    color={accent} alpha={0xcc / 255} layout={{ marginBottom: 8 }} wrap />
                  <View layout={{ gap: 4 }}>
                    {lines.map((line, i) => (
                      <Label key={i} text={line} size={TEXT.sm} font="mono" color={0xe8fff0} wrap />
                    ))}
                  </View>
                </View>
              )}

              <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }} alpha={0.85}>
                <Icon icon={runOver ? HeartCrack : Heart} size={16} color={accent} />
                <Label text={copy.stakes} size={TEXT.sm} font="mono" color={ink} />
              </View>

              <Label text={copy.tapLine} size={TEXT.xs} font="mono" color={ink} alpha={0.5} layout={{ marginTop: 8 }} />
            </View>
          </Appear>
        </Pressable>
      </Appear>
    </View>
  );
}

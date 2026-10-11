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
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Heart, HeartCrack } from 'lucide-react';
import type { MapFailure } from '@/lib/mapFailure';
import { Appear, Icon, Label, Pressable, RADIUS, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";

import { mapFailedCopy, mapFailedDelay } from "./MapFailedOverlayModel";

interface Props {
  failure: MapFailure;
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
  failure, livesLeft, runOver = false, accentColor = '#ff2244', onDismiss,
}: Props) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const copy = mapFailedCopy(t, failure, livesLeft, runOver);
  // The outstanding lines are fixed at mount: they describe the moment the map
  // ended, not whatever the state does while this is up.
  const [lines] = useState(() => copy.lines);
  const accent = hex(accentColor);

  // Auto-dismiss, so a player who has already read it is not made to tap, and
  // one who looked away still gets on with the retry. On the last life this
  // stretches to a backstop instead: see MAP_FAILED_RUN_OVER_MS.
  useEffect(() => {
    const id = setTimeout(onDismiss, mapFailedDelay(runOver));
    return () => clearTimeout(id);
  }, [onDismiss, runOver]);

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
            <View layout={{ width: Math.min(448, screen.width - 64), alignItems: "center", gap: 16 }}>
              <Icon icon={AlertTriangle} size={40} color={accent} />

              <Label text={copy.headline} size={TEXT["2xl"]} weight="900" font="display" upper
                letterSpacing={TEXT["2xl"] * 0.1} color={accent} glow={22} align="center" wrap />

              {lines.length > 0 && (
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

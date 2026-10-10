/**
 * The explainer behind press-and-hold on a board object (canvas port of
 * components/game/BoardEntityInfoModal.tsx).
 *
 * Deliberately reachable rather than taught: the one-time modals this is meant to
 * replace fire once, interrupt play to do it, and are then gone for good. A
 * player meeting a mirror for the third time, or returning after a week, had no
 * route back to the explanation. Here the player chooses the moment, which is
 * also why a non-blocking tooltip would be worse - the ball is still moving and
 * they cannot read it either way.
 *
 * Not the kit's Modal: the title takes the bug's colour while the border keeps
 * the accent, and the body is bounded and scrolls with the X outside it.
 */
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { BoardEntityHit } from '@/lib/boardEntityInfo';
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { WrapText } from "./modalParts";
import { boardEntityCopy } from "./BoardEntityInfoModalModel";

export function BoardEntityInfoModal({
  hit,
  onClose,
  accentColor,
}: {
  hit: BoardEntityHit;
  onClose: () => void;
  accentColor?: string;
}) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = accentColor || '#00ff88';
  const copy = boardEntityCopy(t, hit, accent);
  const relaxed = Math.round(TEXT.sm * 1.625);

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={70}>
      <Appear duration={0.2} layout={{
        width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center", padding: 24,
      }}>
        <Pressable
          onTap={onClose}
          pressedAlpha={1}
          layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.7) }}
        />
        <Appear fromScale={0.92} fromY={8} duration={0.2}>
          <View layout={{
            width: Math.min(320, screen.width - 48), maxHeight: screen.height - 48,
            borderRadius: RADIUS.xl, borderWidth: 2, borderColor: tint(hex(accent), 0x66 / 255),
            backgroundColor: COLOR.card,
          }}>
            {/* Bounded and scrollable: a centred card taller than the screen
                would be clipped at BOTH ends with neither reachable. The close
                button stays outside the scroller. */}
            <ScrollView layout={{ flexShrink: 1, padding: 20 }}>
              <WrapText text={copy.title} size={TEXT.base} weight="700" font="display" color={hex(copy.titleColor)}
                layout={{ marginBottom: 6, paddingRight: 24 }} />

              {copy.bug ? (
                <View layout={{ gap: 12 }}>
                  <WrapText text={copy.body} size={TEXT.sm} lineHeight={relaxed} color={COLOR.mutedForeground} />
                  <View>
                    <Label text={copy.bug.givesLabel} size={11} weight="600" upper letterSpacing={0.3}
                      color={COLOR.mutedForeground} alpha={0.7} />
                    <WrapText text={copy.bug.gives} size={TEXT.sm} lineHeight={relaxed} color={COLOR.foreground} />
                  </View>
                  <View>
                    <Label text={copy.bug.costsLabel} size={11} weight="600" upper letterSpacing={0.3}
                      color={COLOR.mutedForeground} alpha={0.7} />
                    <WrapText text={copy.bug.costs} size={TEXT.sm} lineHeight={relaxed} color={COLOR.mutedForeground} />
                  </View>
                  {copy.bug.danger && (
                    <View layout={{
                      borderRadius: RADIUS.lg, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                      backgroundColor: tint(hex(copy.bug.color), 0x1a / 255),
                    }}>
                      <WrapText text={copy.bug.danger} size={TEXT.sm} weight="600" lineHeight={relaxed} color={hex(copy.bug.color)} />
                    </View>
                  )}
                </View>
              ) : (
                <WrapText text={copy.body} size={TEXT.sm} lineHeight={relaxed} color={COLOR.mutedForeground} />
              )}

              <WrapText text={copy.hint} size={11} color={COLOR.mutedForeground} alpha={0.6} layout={{ marginTop: 12 }} />
            </ScrollView>
            <Pressable onTap={onClose} label="close" layout={{ position: "absolute", top: 8, right: 8, padding: 2 }}>
              <Icon icon={X} size={16} color={COLOR.mutedForeground} />
            </Pressable>
          </View>
        </Appear>
      </Appear>
    </View>
  );
}

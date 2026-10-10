/**
 * The one-time teaching overlay (canvas port of
 * components/game/TutorialOverlay.tsx): a scrim, a card with a title, an
 * optional picture and a short body, and "tap anywhere to continue". With a
 * spotlight the scrim leaves the top or bottom strip clear, frames it in the
 * accent and points a bobbing arrow at it.
 */
import { useCallback, type ReactNode } from "react";
import type { Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { Appear, Label, Pressable, RADIUS, TEXT, View, hex, tint, usePulse, useUiScreen } from "../kit/ui";
import { WrapText } from "./modalParts";
import {
  arrowBob, arrowShape, scrimBands, spotlightHole, spotlightSeparator, tutorialCardWidth, tutorialSpotlight,
} from "./TutorialOverlayModel";

interface TutorialOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  body: string;
  /**
   * Left-align the body instead of centring it.
   *
   * Centred prose is right for an explainer paragraph and wrong for a LIST: a
   * centred bullet list has a ragged left edge, so the eye has to find where
   * each line starts and the headings stop lining up with the items under
   * them. The acceptance criteria are the only body here that is a list.
   */
  align?: "center" | "left";
  /** Optional illustration shown between the title and the (shorter) body: a canvas node. */
  graphic?: ReactNode;
  arrowDirection?: 'up' | 'down' | 'none';
  showTapHint?: boolean;
  spotlightArea?: 'top' | 'bottom';
  spotlightHeightPx?: number;
  accentColor?: string;
}

/** The card's breathing glow, always the brand green whatever the accent (as in the DOM). */
const GLOW = 0x00ff88;

export function TutorialOverlay({
  visible,
  onDismiss,
  title,
  body,
  align = "center",
  graphic,
  arrowDirection = 'none',
  showTapHint = true,
  spotlightArea,
  spotlightHeightPx = 0,
  accentColor = '#00ff88',
}: TutorialOverlayProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const h = spotlightHeightPx;
  const { hasSpotlight, isArrowUp } = tutorialSpotlight(spotlightArea, h, arrowDirection);
  // The arrow bobs on a 1.3s ease; the card's glow breathes every 2.4s.
  const bobPulse = usePulse(1300, visible && hasSpotlight);
  const glowPulse = usePulse(2400, visible);

  // The scrim, and with a spotlight, the glowing frame around the clear strip
  // and the glowing separator at its edge.
  const drawScrim = useCallback((g: Graphics) => {
    g.clear();
    for (const b of scrimBands(screen, spotlightArea, h)) {
      if (b.h > 0) g.rect(b.x, b.y, b.w, b.h).fill({ color: 0x000000, alpha: b.alpha });
    }
    if (!spotlightArea || h <= 0) return;
    const hole = spotlightHole(screen, spotlightArea, h);
    // box-shadow 0 0 32px 10px accent55 / inset accent22, as soft strokes.
    g.rect(hole.x, hole.y, hole.w, hole.h).stroke({ width: 24, color: accent, alpha: 0.12 });
    g.rect(hole.x, hole.y, hole.w, hole.h).stroke({ width: 12, color: accent, alpha: 0.18 });
    g.rect(hole.x + 1, hole.y + 1, hole.w - 2, hole.h - 2).stroke({ width: 2, color: accent, alpha: 0.8 });
    const sep = spotlightSeparator(screen, spotlightArea, h);
    g.rect(sep.x, sep.y - 6, sep.w, sep.h + 12).fill({ color: accent, alpha: 0.18 });
    g.rect(sep.x, sep.y - 3, sep.w, sep.h + 6).fill({ color: accent, alpha: 0.3 });
    g.rect(sep.x, sep.y, sep.w, sep.h).fill(accent);
  }, [screen, spotlightArea, h, accent]);

  const drawArrow = useCallback((g: Graphics) => {
    const { shaft, head } = arrowShape(isArrowUp);
    g.clear();
    // drop-shadow 0 0 8px accent: a slightly fatter faint copy underneath.
    g.rect(shaft.x - 3, shaft.y, shaft.w + 6, shaft.h).fill({ color: accent, alpha: 0.25 });
    g.poly(head).stroke({ width: 6, color: accent, alpha: 0.25, join: "round" });
    g.rect(shaft.x, shaft.y, shaft.w, shaft.h).fill(accent);
    g.poly(head).fill(accent);
  }, [isArrowUp, accent]);

  if (!visible) return null;

  const wide = screen.width >= 640;
  const arrow = (
    <View layout={{ alignItems: "center" }}>
      <View layout={{ width: 60, height: 220 }}>
        <pixiGraphics draw={drawArrow} y={arrowBob(bobPulse, isArrowUp)} />
      </View>
    </View>
  );

  // "Tap anywhere to continue" means the card too: it is not a Pressable, so a
  // tap on it reaches the overlay's own dismiss (nothing on it to protect).
  const card = (
    <Appear fromScale={0.92} fromY={16} duration={0.25} layout={{ alignSelf: "center" }}>
      {/* The breathing outer glow (the DOM's animated box-shadow) as a halo border. */}
      <View layout={{
        width: tutorialCardWidth(screen.width) + 8, padding: 2, borderRadius: RADIUS.xl + 4,
        borderWidth: 2, borderColor: tint(GLOW, 0.1 + 0.3 * glowPulse),
      }}>
        <View layout={{
          padding: 24, gap: 12, borderRadius: RADIUS.xl,
          backgroundColor: 0x0a0f0a, borderColor: accent, borderWidth: 2,
        }}>
          <WrapText text={title} size={wide ? TEXT.xl : TEXT.lg} weight="900" font="display" color={accent}
            upper letterSpacing={(wide ? TEXT.xl : TEXT.lg) * 0.1} align="center" />

          {graphic && <View layout={{ alignItems: "center" }}>{graphic}</View>}

          <WrapText text={body} size={wide ? TEXT.base : TEXT.sm} font="mono" color={0xc8ffd8}
            lineHeight={Math.round((wide ? TEXT.base : TEXT.sm) * 1.625)} align={align === "left" ? "left" : "center"} />

          {showTapHint && (
            <View layout={{ alignItems: "center", marginTop: 4 }}>
              <Label text={t('tutorialOverlay.tapToContinue')} size={TEXT.xs} font="display" color={accent}
                alpha={0.7} upper letterSpacing={TEXT.xs * 0.1} />
            </View>
          )}

          <View layout={{ alignItems: "center", marginTop: 4 }}>
            <WrapText text={t('tutorialOverlay.replayFromOptions')} size={10} font="mono" color={0x4a7a5a}
              upper letterSpacing={0.25} align="center" />
          </View>
        </View>
      </View>
    </Appear>
  );

  const section = (first: ReactNode, second: ReactNode) => (
    <View layout={{ flex: 1, justifyContent: "space-between", paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24 }}>
      {first}
      {second}
    </View>
  );
  // Clear strip that reveals the top bar or the stats panel beneath.
  const spacer = <View layout={{ height: h }} />;

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={60}>
      <Appear duration={0.25} layout={{ width: screen.width, height: screen.height }}>
        <Pressable onTap={onDismiss} pressedAlpha={1} layout={{ width: screen.width, height: screen.height }}>
          <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
            <pixiGraphics draw={drawScrim} />
          </View>
          {hasSpotlight ? (
            spotlightArea === 'top' ? (
              <>
                {spacer}
                {/* Dark section: arrow near the separator, card near the bottom. */}
                {section(arrow, card)}
              </>
            ) : (
              <>
                {/* Dark section: card near the top, arrow near the separator. */}
                {section(card, arrow)}
                {spacer}
              </>
            )
          ) : (
            /* No spotlight: a centred card, no arrow. */
            <View layout={{ flex: 1, justifyContent: "center", alignItems: "center", paddingLeft: 24, paddingRight: 24 }}>
              {card}
            </View>
          )}
        </Pressable>
      </Appear>
    </View>
  );
}

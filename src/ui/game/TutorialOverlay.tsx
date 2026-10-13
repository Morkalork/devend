/**
 * The one-time teaching overlay (canvas port of
 * components/game/TutorialOverlay.tsx): a scrim, a card with a title, an
 * optional picture and a short body, and "tap anywhere to continue". With a
 * spotlight the scrim leaves the top or bottom strip clear, frames it in the
 * accent and points a bobbing arrow at it.
 */
import { useCallback, useRef, type ReactNode } from "react";
import type { LayoutContainer } from "@pixi/layout/components";
import type { Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { Appear, Label, Pressable, RADIUS, ROLE, TEXT, View, hex, usePulse, useUiScreen } from "../kit/ui";
import { useBoxSize } from "./modalMotion";

import {
  ARROW_H, ARROW_W, arrowBob, arrowScale, arrowShape, scrimBands, spotlightHole, spotlightSeparator, tutorialCardWidth, tutorialSpotlight,
} from "./TutorialOverlayModel";

interface TutorialOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  body: string;
  /**
   * How the card's text lines up. Left by default since the UI redo, where
   * every card shares one left edge; centre is kept for a caller that wants
   * it. (A centred list was always wrong: its ragged left edge hides where
   * each line starts.)
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

export function TutorialOverlay({
  visible,
  onDismiss,
  title,
  body,
  align = "left",
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
  // The arrow bobs on a 1.3s ease; it is the one thing here that moves.
  const bobPulse = usePulse(1300, visible && hasSpotlight);
  // The arrow gives way when the card and the strip leave it less than its
  // full height (a short phone with a tall bottom strip): it shrinks rather
  // than running into the strip it points at.
  const arrowBox = useRef<LayoutContainer | null>(null);
  const arrowSize = useBoxSize(arrowBox);
  const arrowK = arrowScale(arrowSize.h);

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
    // drop-shadow 0 0 8px accent: widening strokes of falling alpha under the
    // fill, so the glow fades out rather than reading as a dark outline.
    for (const [width, alpha] of [[16, 0.06], [11, 0.1], [6, 0.16]] as const) {
      g.rect(shaft.x, shaft.y, shaft.w, shaft.h).stroke({ width, color: accent, alpha, join: "round" });
      g.poly(head).stroke({ width, color: accent, alpha, join: "round" });
    }
    g.rect(shaft.x, shaft.y, shaft.w, shaft.h).fill(accent);
    g.poly(head).fill(accent);
  }, [isArrowUp, accent]);

  if (!visible) return null;

  const wide = screen.width >= 640;
  const arrow = (
    <View layout={{ alignItems: "center", flexShrink: 1, minHeight: ARROW_H * 0.4 }}>
      <layoutContainer ref={arrowBox} eventMode="passive" layout={{ width: ARROW_W, height: ARROW_H, flexShrink: 1 }}>
        <pixiGraphics draw={drawArrow} scale={arrowK} x={(ARROW_W * (1 - arrowK)) / 2} y={arrowBob(bobPulse, isArrowUp)} />
      </layoutContainer>
    </View>
  );

  // "Tap anywhere to continue" means the card too: it is not a Pressable, so a
  // tap on it reaches the overlay's own dismiss (nothing on it to protect).
  //
  // Flat, like every card in the redo (UI_REDO_PLAN.md): the raised panel, a
  // stripe of the explainer's accent down the left, the title in ink, the body
  // in the body face. It used to be a glowing, breathing, all-caps card in a
  // monospace body, which made every explainer read as an alarm.
  const card = (
    <Appear fromY={12} duration={0.25} layout={{ alignSelf: "center" }}>
      <View layout={{
        width: tutorialCardWidth(screen.width), flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
        backgroundColor: ROLE.raised, borderColor: ROLE.edge, borderWidth: 1,
      }}>
        <View layout={{ width: 4, backgroundColor: accent }} />
        <View layout={{ flex: 1, padding: 20, gap: 12 }}>
          <Label text={title} size={wide ? TEXT.xl : TEXT.lg} weight="700" font="display" color={ROLE.ink}
            align={align === "left" ? "left" : "center"} wrap />

          {graphic && <View layout={{ alignItems: "center" }}>{graphic}</View>}

          <Label text={body} size={wide ? TEXT.base : TEXT.sm} color={ROLE.ink}
            lineHeight={Math.round((wide ? TEXT.base : TEXT.sm) * 1.6)} align={align === "left" ? "left" : "center"} wrap />

          {showTapHint && (
            <View layout={{ alignItems: align === "left" ? "flex-start" : "center", marginTop: 4 }}>
              <Label text={t('tutorialOverlay.tapToContinue')} size={TEXT.xs} weight="600" color={accent} align={align} wrap />
            </View>
          )}

          <View layout={{ alignItems: align === "left" ? "flex-start" : "center" }}>
            <Label text={t('tutorialOverlay.replayFromOptions')} size={TEXT.xs} color={ROLE.muted} align={align} wrap />
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
        <Pressable onTap={onDismiss} pressedAlpha={1} label="tutorial-dismiss" layout={{ width: screen.width, height: screen.height }}>
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

/**
 * The draw-hint hand (canvas port of components/game/InteractiveTutorialOverlay.tsx).
 *
 * Step 2 of the draw tutorial (#62): the explainer was a paused modal (step 1);
 * here the board is clear and only the hand plays, pressing, dragging along a
 * dotted guide and lifting, so the player sees where and how to slice. Reused,
 * aimed, for the circuit hint and over the Rubber Band's drag surface.
 *
 * Inert: it demonstrates the drag over the very surface that is listening for
 * it, so it must never take the touch itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Graphics } from "pixi.js";
import type { TutorialStep } from "@/types/game";
import { COLOR, Icon } from "../kit/ui";
import type { IconNode } from "../kit/icons";
import { Inert } from "./boardParts";
import { useElapsed } from "./fxClock";
import { pressRipple, tutorialAnimState, tutorialDots, tutorialGesture } from "./tutorialModel";

interface InteractiveTutorialOverlayProps {
  tutorialStep: TutorialStep;
  isPlayerDragging: boolean;
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /**
   * Where to draw the gesture, in the same CSS-pixel space as the offsets
   * above. Omitted keeps the original behaviour: a diagonal swipe centred in
   * the canvas, which is what the level-1 tutorial wants because it is teaching
   * the gesture itself and has nowhere in particular to point at.
   *
   * Supplied, the gesture is aimed - at a circuit terminal, say - and the hand
   * traces that line instead.
   */
  gesture?: { fromX: number; fromY: number; toX: number; toY: number };
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
}

/** The DOM's own hand glyph (a 64-unit path), scaled into the icon's 24-unit box. */
const HAND_PATH = "M32 4c-2.2 0-4 1.8-4 4v24c0 1.1-.9 2-2 2s-2-.9-2-2V14c0-2.2-1.8-4-4-4s-4 1.8-4 4v22c0 1.1-.9 2-2 2s-2-.9-2-2V20c0-2.2-1.8-4-4-4s-4 1.8-4 4v20c0 13.3 10.7 24 24 24s24-10.7 24-24V16c0-2.2-1.8-4-4-4s-4 1.8-4 4v16c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.2-1.8-4-4-4z";
const handNode = (fill: string): IconNode => [["path", { d: HAND_PATH, fill, stroke: "none", transform: "scale(0.375)" }]];
const HAND = handNode("#ffffff");
const HAND_SHADOW = handNode("#000000");
/** The guide dots' orange. */
const DOT = 0xff8800;
const HAND_SIZE = 48;

export function InteractiveTutorialOverlay({
  tutorialStep, isPlayerDragging, canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft, gesture, origin,
}: InteractiveTutorialOverlayProps) {
  const [showHand, setShowHand] = useState(true);
  // Bumped to restart the loop from its first frame when the hand comes back.
  const [loopEpoch, setLoopEpoch] = useState(0);
  const reshowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasDraggedRef = useRef(false);

  const g = tutorialGesture(
    { width: canvasWidth, height: canvasHeight, offsetTop: canvasOffsetTop, offsetLeft: canvasOffsetLeft }, gesture);
  const elapsed = useElapsed(Infinity, showHand && tutorialStep !== "completed", loopEpoch);
  const anim = tutorialAnimState(elapsed, g);

  // Hide hand when player starts dragging; once they've dragged, never re-show
  useEffect(() => {
    if (isPlayerDragging) {
      hasDraggedRef.current = true;
      setShowHand(false);
      if (reshowTimeoutRef.current) {
        clearTimeout(reshowTimeoutRef.current);
        reshowTimeoutRef.current = null;
      }
    } else if (!showHand && !hasDraggedRef.current) {
      // Re-show after 2 seconds only if the player hasn't attempted a drag yet
      reshowTimeoutRef.current = setTimeout(() => {
        setShowHand(true);
        setLoopEpoch(e => e + 1);
      }, 2000);
    }
    return () => {
      if (reshowTimeoutRef.current) clearTimeout(reshowTimeoutRef.current);
    };
  }, [isPlayerDragging, showHand]);

  const lineProgress = anim.lineProgress;
  const { startX, startY, endX, endY } = g;
  const drawDots = useCallback((gr: Graphics) => {
    gr.clear();
    // The dotted guide from start to end, each dot swelling as the hand passes.
    for (const d of tutorialDots({ startX, startY, endX, endY }, lineProgress)) {
      gr.circle(d.x, d.y, d.size / 2).fill({ color: DOT, alpha: d.alpha });
    }
  }, [startX, startY, endX, endY, lineProgress]);

  if (tutorialStep === "completed") return null;

  const ripple = anim.phase === "press" ? pressRipple(anim.progress) : null;

  return (
    <Inert label="tutorial-hand" layout={{ position: "absolute", left: origin.x, top: origin.y, width: 0, height: 0 }}>
      {showHand && (
        <>
          <pixiGraphics draw={drawDots} />
          <layoutContainer
            layout={{ position: "absolute", left: anim.handX - 24, top: anim.handY - 12, width: HAND_SIZE, height: HAND_SIZE }}
            scale={anim.handScale}
            alpha={anim.handOpacity}
          >
            {/* Tap indicator pulse at press. */}
            {ripple && <Ripple scale={ripple.scale} alpha={ripple.alpha} />}
            {/* A soft shadow under the hand, for the DOM's drop-shadow. */}
            <Icon icon={HAND_SHADOW} size={HAND_SIZE} alpha={0.45} layout={{ position: "absolute", left: 0, top: 3 }} />
            <Icon icon={HAND} size={HAND_SIZE} layout={{ position: "absolute", left: 0, top: 0 }} />
          </layoutContainer>
        </>
      )}
    </Inert>
  );
}

/** The press ripple: a primary-tinted disc 16px past the hand on every side. */
function Ripple({ scale, alpha }: { scale: number; alpha: number }) {
  const draw = useCallback((gr: Graphics) => {
    gr.clear();
    gr.circle(HAND_SIZE / 2, HAND_SIZE / 2, (HAND_SIZE / 2 + 16) * scale).fill({ color: COLOR.primary, alpha: 0.4 * alpha });
  }, [scale, alpha]);
  return <pixiGraphics draw={draw} />;
}

/**
 * The draw-hint hand's animation (InteractiveTutorialOverlay), as a pure
 * function of elapsed time, with the DOM overlay's own timing constants.
 */

// Animation timing constants (in seconds)
export const FADE_IN_DURATION = 0.2;
export const PRESS_DURATION = 0.15;
export const DRAG_DURATION = 0.9;
export const RELEASE_DURATION = 0.15;
export const PAUSE_DURATION = 0.7;
export const TOTAL_LOOP_DURATION = FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + RELEASE_DURATION + PAUSE_DURATION;

/** The default gesture's span: a diagonal swipe centred in the board. */
export const DRAG_WIDTH = 140;
export const DRAG_HEIGHT = 90;

export type AnimationPhase = "fadeIn" | "press" | "drag" | "release" | "pause";

export interface AnimationState {
  phase: AnimationPhase;
  progress: number; // 0-1 within current phase
  handX: number;
  handY: number;
  lineProgress: number; // 0-1 for line drawing
  handScale: number;
  handOpacity: number;
  showLine: boolean;
}

export interface Gesture {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * Where the gesture runs, in the container's CSS px. Without an aimed gesture,
 * the swipe's whole span is centred in the board: start at the centre MINUS
 * half the drag, so it does not start at the centre and run off to one side.
 */
export function tutorialGesture(
  board: { width: number; height: number; offsetTop: number; offsetLeft: number },
  gesture?: { fromX: number; fromY: number; toX: number; toY: number },
): Gesture {
  const startX = gesture ? gesture.fromX : board.offsetLeft + board.width / 2 - DRAG_WIDTH / 2;
  const startY = gesture ? gesture.fromY : board.offsetTop + board.height / 2 - DRAG_HEIGHT / 2;
  return {
    startX, startY,
    endX: gesture ? gesture.toX : startX + DRAG_WIDTH,
    endY: gesture ? gesture.toY : startY + DRAG_HEIGHT,
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The hand at `elapsedSec` into the loop: fade in, press, drag, release, pause. */
export function tutorialAnimState(elapsedSec: number, g: Gesture): AnimationState {
  const { startX, startY, endX, endY } = g;
  const loopTime = elapsedSec % TOTAL_LOOP_DURATION;

  let phase: AnimationPhase;
  let phaseProgress: number;
  let currentX = startX;
  let currentY = startY;
  let scale = 1;
  let opacity = 0.6;
  let lineProgress = 0;
  let showLine = false;

  if (loopTime < FADE_IN_DURATION) {
    phase = "fadeIn";
    phaseProgress = loopTime / FADE_IN_DURATION;
    opacity = 0.6 * easeInOutCubic(phaseProgress);
  } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION) {
    phase = "press";
    phaseProgress = (loopTime - FADE_IN_DURATION) / PRESS_DURATION;
    scale = 1 - 0.1 * easeInOutCubic(phaseProgress);
    showLine = true;
  } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION) {
    phase = "drag";
    phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION) / DRAG_DURATION;
    const eased = easeInOutCubic(phaseProgress);
    currentX = startX + (endX - startX) * eased;
    currentY = startY + (endY - startY) * eased;
    scale = 0.9;
    showLine = true;
    lineProgress = eased;
  } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + RELEASE_DURATION) {
    phase = "release";
    phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION - DRAG_DURATION) / RELEASE_DURATION;
    scale = 0.9 + 0.1 * easeInOutCubic(phaseProgress);
    currentX = endX;
    currentY = endY;
    showLine = true;
    lineProgress = 1;
    opacity = 0.6 * (1 - easeInOutCubic(phaseProgress) * 0.3);
  } else {
    phase = "pause";
    phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION - DRAG_DURATION - RELEASE_DURATION) / PAUSE_DURATION;
    opacity = 0;
  }

  return {
    phase, progress: phaseProgress, handX: currentX, handY: currentY,
    lineProgress, handScale: scale, handOpacity: opacity, showLine,
  };
}

/** The dotted guide: eleven dots, start to end, each growing once the hand has passed it. */
export function tutorialDots(g: Gesture, lineProgress: number): { x: number; y: number; size: number; alpha: number }[] {
  const out: { x: number; y: number; size: number; alpha: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const passed = lineProgress >= t;
    out.push({
      x: g.startX + (g.endX - g.startX) * t,
      y: g.startY + (g.endY - g.startY) * t,
      size: passed ? 10 : 8,
      alpha: passed ? 1 : 0.4,
    });
  }
  return out;
}

/** The tap ripple under the finger during the press: grows 0.5 -> 2 and fades from 0.8. */
export function pressRipple(progress: number): { scale: number; alpha: number } {
  // framer's easeOut
  const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 2);
  return { scale: 0.5 + 1.5 * e, alpha: 0.8 * (1 - e) };
}

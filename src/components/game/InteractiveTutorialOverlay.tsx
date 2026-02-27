import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useRef, useCallback } from 'react';
import { TutorialStep } from '@/hooks/useInteractiveTutorial';

interface InteractiveTutorialOverlayProps {
  tutorialStep: TutorialStep;
  isPlayerDragging: boolean;
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
}

// Animation timing constants (in seconds)
const FADE_IN_DURATION = 0.2;
const PRESS_DURATION = 0.15;
const DRAG_DURATION = 0.9;
const RELEASE_DURATION = 0.15;
const PAUSE_DURATION = 0.7;
const TOTAL_LOOP_DURATION = FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + RELEASE_DURATION + PAUSE_DURATION;

// Animation phases
type AnimationPhase = 'fadeIn' | 'press' | 'drag' | 'release' | 'pause';

interface AnimationState {
  phase: AnimationPhase;
  progress: number; // 0-1 within current phase
  handX: number;
  handY: number;
  lineProgress: number; // 0-1 for line drawing
  handScale: number;
  handOpacity: number;
  showLine: boolean;
}

export function InteractiveTutorialOverlay({
  tutorialStep,
  isPlayerDragging,
  canvasWidth,
  canvasHeight,
  canvasOffsetTop,
  canvasOffsetLeft,
}: InteractiveTutorialOverlayProps) {
  const [showHand, setShowHand] = useState(true);
  const [loopCount, setLoopCount] = useState(0);
  const reshowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasDraggedRef = useRef(false);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  
  // Animation state
  const [animState, setAnimState] = useState<AnimationState>({
    phase: 'fadeIn',
    progress: 0,
    handX: 0,
    handY: 0,
    lineProgress: 0,
    handScale: 1,
    handOpacity: 0,
    showLine: false,
  });

  // Calculate hand animation positions based on canvas size and position
  // Center the gesture in the middle of the canvas
  const startX = canvasOffsetLeft + canvasWidth * 0.4;
  const startY = canvasOffsetTop + canvasHeight * 0.45;
  const endX = startX + 140;
  const endY = startY + 90;

  // Easing function for smooth motion
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // Calculate animation state based on elapsed time
  const calculateAnimState = useCallback((elapsedSec: number): AnimationState => {
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
      // Fade in phase
      phase = 'fadeIn';
      phaseProgress = loopTime / FADE_IN_DURATION;
      opacity = 0.6 * easeInOutCubic(phaseProgress);
      currentX = startX;
      currentY = startY;
    } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION) {
      // Press phase
      phase = 'press';
      phaseProgress = (loopTime - FADE_IN_DURATION) / PRESS_DURATION;
      scale = 1 - 0.1 * easeInOutCubic(phaseProgress);
      currentX = startX;
      currentY = startY;
      showLine = true;
      lineProgress = 0;
    } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION) {
      // Drag phase
      phase = 'drag';
      phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION) / DRAG_DURATION;
      const eased = easeInOutCubic(phaseProgress);
      currentX = startX + (endX - startX) * eased;
      currentY = startY + (endY - startY) * eased;
      scale = 0.9;
      showLine = true;
      lineProgress = eased;
    } else if (loopTime < FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + RELEASE_DURATION) {
      // Release phase
      phase = 'release';
      phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION - DRAG_DURATION) / RELEASE_DURATION;
      scale = 0.9 + 0.1 * easeInOutCubic(phaseProgress);
      currentX = endX;
      currentY = endY;
      showLine = true;
      lineProgress = 1;
      opacity = 0.6 * (1 - easeInOutCubic(phaseProgress) * 0.3);
    } else {
      // Pause phase
      phase = 'pause';
      phaseProgress = (loopTime - FADE_IN_DURATION - PRESS_DURATION - DRAG_DURATION - RELEASE_DURATION) / PAUSE_DURATION;
      currentX = startX;
      currentY = startY;
      opacity = 0;
      showLine = false;
    }

    return {
      phase,
      progress: phaseProgress,
      handX: currentX,
      handY: currentY,
      lineProgress,
      handScale: scale,
      handOpacity: opacity,
      showLine,
    };
  }, [startX, startY, endX, endY]);

  // Animation loop using requestAnimationFrame
  useEffect(() => {
    if (!showHand || tutorialStep === 'completed') {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    startTimeRef.current = performance.now();
    
    const animate = (timestamp: number) => {
      const elapsed = (timestamp - startTimeRef.current) / 1000;
      const newState = calculateAnimState(elapsed);
      
      // Track loop restarts
      const currentLoop = Math.floor(elapsed / TOTAL_LOOP_DURATION);
      if (currentLoop !== loopCount) {
        setLoopCount(currentLoop);
      }
      
      setAnimState(newState);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [showHand, tutorialStep, calculateAnimState, loopCount]);

  // Hide hand when player starts dragging; once they've dragged, never re-show
  useEffect(() => {
    if (isPlayerDragging) {
      hasDraggedRef.current = true;
      setShowHand(false);
      // Clear any pending re-show timeout
      if (reshowTimeoutRef.current) {
        clearTimeout(reshowTimeoutRef.current);
        reshowTimeoutRef.current = null;
      }
    } else if (!showHand && !hasDraggedRef.current) {
      // Re-show after 2 seconds only if the player hasn't attempted a drag yet
      reshowTimeoutRef.current = setTimeout(() => {
        setShowHand(true);
        startTimeRef.current = performance.now();
        setLoopCount(0);
      }, 2000);
    }

    return () => {
      if (reshowTimeoutRef.current) {
        clearTimeout(reshowTimeoutRef.current);
      }
    };
  }, [isPlayerDragging, showHand]);

  // Don't render if completed
  if (tutorialStep === 'completed') {
    return null;
  }

  // Calculate current line end point based on progress
  const lineEndX = startX + (endX - startX) * animState.lineProgress;
  const lineEndY = startY + (endY - startY) * animState.lineProgress;

  // Helper to get dot style based on hand progress
  const getDotStyle = (t: number) => {
    const passed = animState.lineProgress >= t;
    const size = passed ? 10 : 8;
    const opacity = passed ? 1 : 0.4;
    return {
      width: size,
      height: size,
      backgroundColor: `rgba(255,136,0,${opacity})`,
      transition: 'all 0.15s ease-out',
    };
  };


  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {/* Instruction text - top */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="absolute top-4 left-0 right-0 flex justify-center px-4"
      >
        <div
          className="rounded-xl px-6 py-4 max-w-md text-center"
          style={{
            background: '#0a0f0a',
            border: '2px solid #00ff88',
            boxShadow: '0 0 24px rgba(0,255,136,0.15)',
          }}
        >
          <p
            className="text-sm sm:text-base font-black tracking-widest uppercase"
            style={{ fontFamily: 'Orbitron, sans-serif', color: '#00ff88' }}
          >
            DRAW A FENCE
          </p>
          <p
            className="text-xs sm:text-sm mt-2 leading-relaxed"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: '#c8ffd8' }}
          >
            Drag anywhere inside the area to create a slicing wall. Don't let the ball hit the wall while it's growing!
          </p>
        </div>
      </motion.div>

      {/* Magic Hand Animation */}
      <AnimatePresence>
        {showHand && (
          <div
            className="absolute inset-0"
            style={{ 
              width: '100%',
              height: '100%',
            }}
          >
            {/* Dotted line from start to end - animates as hand passes */}
            <div className="absolute rounded-full" style={{ left: startX - getDotStyle(0).width/2, top: startY - getDotStyle(0).height/2, ...getDotStyle(0) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.1 - getDotStyle(0.1).width/2, top: startY + (endY - startY) * 0.1 - getDotStyle(0.1).height/2, ...getDotStyle(0.1) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.2 - getDotStyle(0.2).width/2, top: startY + (endY - startY) * 0.2 - getDotStyle(0.2).height/2, ...getDotStyle(0.2) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.3 - getDotStyle(0.3).width/2, top: startY + (endY - startY) * 0.3 - getDotStyle(0.3).height/2, ...getDotStyle(0.3) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.4 - getDotStyle(0.4).width/2, top: startY + (endY - startY) * 0.4 - getDotStyle(0.4).height/2, ...getDotStyle(0.4) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.5 - getDotStyle(0.5).width/2, top: startY + (endY - startY) * 0.5 - getDotStyle(0.5).height/2, ...getDotStyle(0.5) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.6 - getDotStyle(0.6).width/2, top: startY + (endY - startY) * 0.6 - getDotStyle(0.6).height/2, ...getDotStyle(0.6) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.7 - getDotStyle(0.7).width/2, top: startY + (endY - startY) * 0.7 - getDotStyle(0.7).height/2, ...getDotStyle(0.7) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.8 - getDotStyle(0.8).width/2, top: startY + (endY - startY) * 0.8 - getDotStyle(0.8).height/2, ...getDotStyle(0.8) }} />
            <div className="absolute rounded-full" style={{ left: startX + (endX - startX) * 0.9 - getDotStyle(0.9).width/2, top: startY + (endY - startY) * 0.9 - getDotStyle(0.9).height/2, ...getDotStyle(0.9) }} />
            <div className="absolute rounded-full" style={{ left: endX - getDotStyle(1).width/2, top: endY - getDotStyle(1).height/2, ...getDotStyle(1) }} />

            {/* Hand icon container */}
            <div
              className="absolute"
              style={{
                left: animState.handX - 24,
                top: animState.handY - 12,
                width: 48,
                height: 48,
                transform: `scale(${animState.handScale})`,
                opacity: animState.handOpacity,
                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
                transition: 'none',
              }}
            >
              {/* Tap indicator pulse at press */}
              {animState.phase === 'press' && (
                <motion.div
                  className="absolute -inset-4 rounded-full bg-primary/40"
                  initial={{ scale: 0.5, opacity: 0.8 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: PRESS_DURATION, ease: "easeOut" }}
                />
              )}
              
              {/* Hand SVG */}
              <svg 
                viewBox="0 0 64 64" 
                className="w-12 h-12 text-white"
                style={{
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                }}
              >
                <path 
                  fill="currentColor"
                  d="M32 4c-2.2 0-4 1.8-4 4v24c0 1.1-.9 2-2 2s-2-.9-2-2V14c0-2.2-1.8-4-4-4s-4 1.8-4 4v22c0 1.1-.9 2-2 2s-2-.9-2-2V20c0-2.2-1.8-4-4-4s-4 1.8-4 4v20c0 13.3 10.7 24 24 24s24-10.7 24-24V16c0-2.2-1.8-4-4-4s-4 1.8-4 4v16c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.2-1.8-4-4-4z"
                />
              </svg>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2"
      >
        <div
          className="rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest"
          style={{
            fontFamily: 'Orbitron, sans-serif',
            background: 'rgba(0,255,136,0.08)',
            border: '1px solid rgba(0,255,136,0.4)',
            color: '#00ff88',
          }}
        >
          DRAW A FENCE TO CONTINUE
        </div>
      </motion.div>
    </div>
  );
}

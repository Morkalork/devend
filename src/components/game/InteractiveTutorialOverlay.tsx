import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';
import { TutorialStep } from '@/hooks/useInteractiveTutorial';

interface InteractiveTutorialOverlayProps {
  tutorialStep: TutorialStep;
  isPlayerDragging: boolean;
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
}

export function InteractiveTutorialOverlay({
  tutorialStep,
  isPlayerDragging,
  canvasWidth,
  canvasHeight,
  canvasOffsetTop,
}: InteractiveTutorialOverlayProps) {
  const [showHand, setShowHand] = useState(true);
  const [animationKey, setAnimationKey] = useState(0);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reshowTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hide hand when player starts dragging
  useEffect(() => {
    if (isPlayerDragging) {
      setShowHand(false);
      // Clear any pending re-show timeout
      if (reshowTimeoutRef.current) {
        clearTimeout(reshowTimeoutRef.current);
        reshowTimeoutRef.current = null;
      }
    } else {
      // Re-show after a delay if player stopped dragging
      reshowTimeoutRef.current = setTimeout(() => {
        setShowHand(true);
        setAnimationKey(prev => prev + 1);
      }, 1500);
    }

    return () => {
      if (reshowTimeoutRef.current) {
        clearTimeout(reshowTimeoutRef.current);
      }
    };
  }, [isPlayerDragging]);

  // Calculate hand animation positions based on canvas size
  const startX = canvasWidth * 0.35;
  const startY = canvasOffsetTop + canvasHeight * 0.4;
  const endX = canvasWidth * 0.65;
  const endY = canvasOffsetTop + canvasHeight * 0.6;

  // Preview line coordinates
  const lineStartX = startX;
  const lineStartY = startY;
  const lineEndX = endX;
  const lineEndY = endY;

  // Don't render if completed
  if (tutorialStep === 'completed') {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-40">
      {/* Instruction text - top */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="absolute top-4 left-0 right-0 flex justify-center px-4"
      >
        <div className="bg-card/90 backdrop-blur-sm border border-primary/30 rounded-xl px-6 py-4 max-w-md text-center shadow-lg">
          <p className="text-foreground font-medium text-sm sm:text-base">
            Drag anywhere inside the area to create a slicing wall.
          </p>
          <p className="text-muted-foreground text-xs sm:text-sm mt-2">
            Don't let the ball hit the wall while it's growing!
          </p>
        </div>
      </motion.div>

      {/* Magic Hand Animation */}
      <AnimatePresence mode="wait">
        {showHand && (
          <motion.div
            key={animationKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute"
            style={{ 
              left: 0, 
              top: 0,
              width: '100%',
              height: '100%',
            }}
          >
            {/* Preview line that follows the hand drag */}
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ overflow: 'visible' }}
            >
              <motion.line
                x1={lineStartX}
                y1={lineStartY}
                x2={lineStartX}
                y2={lineStartY}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray="8 4"
                animate={{
                  x2: [lineStartX, lineEndX, lineEndX, lineStartX],
                  y2: [lineStartY, lineEndY, lineEndY, lineStartY],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  times: [0, 0.4, 0.6, 1],
                  ease: "easeInOut",
                }}
              />
            </svg>

            {/* Hand icon */}
            <motion.div
              className="absolute"
              initial={{ x: startX - 20, y: startY - 10 }}
              animate={{
                x: [startX - 20, endX - 20, endX - 20, startX - 20],
                y: [startY - 10, endY - 10, endY - 10, startY - 10],
                scale: [1, 0.95, 1, 1],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                times: [0, 0.4, 0.6, 1],
                ease: "easeInOut",
              }}
              style={{ 
                width: 48, 
                height: 48,
                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
              }}
            >
              {/* Tap indicator pulse at start */}
              <motion.div
                className="absolute -inset-4 rounded-full bg-primary/30"
                animate={{
                  scale: [0, 1.5, 0, 0],
                  opacity: [0.6, 0, 0, 0],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  times: [0, 0.15, 0.2, 1],
                  ease: "easeOut",
                }}
              />
              
              {/* Hand SVG */}
              <svg 
                viewBox="0 0 64 64" 
                className="w-12 h-12 text-white opacity-60"
                style={{
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                }}
              >
                <path 
                  fill="currentColor"
                  d="M32 4c-2.2 0-4 1.8-4 4v24c0 1.1-.9 2-2 2s-2-.9-2-2V14c0-2.2-1.8-4-4-4s-4 1.8-4 4v22c0 1.1-.9 2-2 2s-2-.9-2-2V20c0-2.2-1.8-4-4-4s-4 1.8-4 4v20c0 13.3 10.7 24 24 24s24-10.7 24-24V16c0-2.2-1.8-4-4-4s-4 1.8-4 4v16c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.2-1.8-4-4-4z"
                />
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tutorial mode badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2"
      >
        <div className="bg-primary/20 border border-primary/40 rounded-full px-4 py-2 text-primary text-xs font-medium uppercase tracking-wider">
          Tutorial Mode
        </div>
      </motion.div>
    </div>
  );
}

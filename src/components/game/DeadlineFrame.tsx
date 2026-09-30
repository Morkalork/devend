/**
 * DeadlineFrame - the map clock, drawn as the board's own frame.
 *
 * A timed map's countdown lived in a thin bar below the fence slots, where it
 * was easy to miss (and hidden while a refusal message owned that row). The
 * player's eyes are on the board, so the clock goes there: a band traced round
 * the board's frame that sweeps back towards twelve o'clock as time runs out,
 * shading green to amber to red. At the milestone seconds (DEADLINE_MILESTONES)
 * the number flashes once over the board, the same brief numeral BoardAlert
 * uses for the last ten seconds, so the run-up to that alarm is not silent.
 *
 * Positioned from the frame GameCanvas already computes for the board (see
 * BoardPlaceholder), so it sits exactly on the drawn frame band and never over
 * the arena. It never takes a tap.
 */
import { useReducedMotion } from 'framer-motion';
import type { BoardFrameCss } from './BoardPlaceholder';
import { clockRectPath, deadlineColor, deadlineMilestone } from '@/lib/deadlineDisplay';

interface DeadlineFrameProps {
  /** Where the board is drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
  /** Whole seconds left on the clock; null hides the frame (no clock, or done). */
  secondsLeft: number | null;
  /** The map's time limit in seconds. */
  limit: number | null;
}

export function DeadlineFrame({ frame, secondsLeft, limit }: DeadlineFrameProps) {
  const reduceMotion = useReducedMotion();
  if (!frame || secondsLeft == null || limit == null || !(limit > 0)) {
    return null;
  }

  const remaining = Math.max(0, Math.min(1, secondsLeft / limit));
  const color = deadlineColor(remaining);
  // The centre line of the frame band, so the stroke covers the band itself.
  const band = Math.max(3, frame.frame * 0.6);
  const half = frame.frame / 2;
  const { d, length } = clockRectPath(half, half, frame.width - frame.frame, frame.height - frame.frame);
  const milestone = deadlineMilestone(secondsLeft, limit);

  return (
    <div
      className="absolute pointer-events-none"
      data-testid="deadline-frame"
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height, zIndex: 4 }}
      aria-hidden
    >
      <svg width={frame.width} height={frame.height} className="absolute inset-0 overflow-visible">
        {/* The spent part of the clock, faint, so the drain reads as a loss
            rather than as the frame getting shorter for no reason. */}
        <path d={d} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={band} />
        <path
          data-testid="deadline-frame-fill"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={band}
          strokeLinecap="butt"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - remaining)}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            // Ticks arrive once a second; a 1s linear slide keeps it a sweep.
            transition: reduceMotion ? undefined : 'stroke-dashoffset 1s linear, stroke 1s linear',
          }}
        />
      </svg>
      {milestone != null && (
        // A CSS animation keyed on the milestone, so it plays once per
        // milestone whatever GameCanvas re-renders (.animate-deadline-flash).
        <div
          key={milestone}
          data-testid="deadline-milestone"
          className="absolute inset-0 flex items-center justify-center animate-deadline-flash"
        >
          <span
            className="font-display font-black tabular-nums"
            style={{
              fontSize: 'clamp(3rem, 22vw, 7rem)',
              color,
              textShadow: `0 0 40px ${color}, 0 0 12px #000`,
            }}
          >
            {milestone}
          </span>
        </div>
      )}
    </div>
  );
}

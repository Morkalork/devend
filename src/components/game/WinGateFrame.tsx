/**
 * The board's own "this is not a normal clear" mark.
 *
 * A frame around the play area on the maps that want something beyond fencing
 * off space and locking balls, which resolves the moment that requirement is
 * satisfied.
 *
 * ONE state, not a palette. The original idea was a distinct border per
 * condition kind - one design for a coloured-area gate, another for a superior
 * lock, and so on. A border language has to be learned, and languages are
 * learned by repetition: there are seven unusual kinds and a player meets three
 * of them, at levels 32 to 34, so each border would be seen once or twice in a
 * whole run. A code seen twice is not clearer than words, it is a second puzzle
 * on top of the map. So the frame says exactly one thing - something here is
 * still outstanding - and the chip in the top bar says which and how far.
 *
 * Amber rather than the run's accent, because the accent already means "done"
 * everywhere else in the HUD (a satisfied chip, a locked pocket, the CLEAR
 * readout). A frame in the same colour as every completion signal, drawn
 * precisely when the map is NOT complete, would say the opposite of what it
 * means.
 *
 * `absolute` inside the board wrapper rather than `fixed`: the page-transition
 * transform breaks fixed positioning and viewport coordinates, so board-aligned
 * UI has to live in the wrapper's coordinate space.
 */
import { motion } from 'framer-motion';

/** The colour of an outstanding requirement. Not the accent. See above. */
const OUTSTANDING = '#ffb347';

interface Props {
  /** True while the map still owes something beyond an ordinary clear. */
  outstanding: boolean;
  /** The map has an unusual requirement at all; false hides the frame entirely. */
  present: boolean;
}

export function WinGateFrame({ outstanding, present }: Props) {
  // Nothing at all on an ordinary map. A frame that is merely dimmer on 37 of
  // 40 maps is chrome, and the eye stops seeing it exactly where it matters.
  if (!present) return null;

  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 pointer-events-none rounded-sm"
      initial={false}
      animate={{
        // Fades out rather than vanishing: the resolve is a small reward and
        // worth seeing, and an element that blinks away reads as a glitch.
        opacity: outstanding ? 1 : 0,
      }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      style={{
        border: `2px solid ${OUTSTANDING}`,
        boxShadow: `inset 0 0 18px ${OUTSTANDING}55, 0 0 12px ${OUTSTANDING}44`,
        zIndex: 6,
      }}
    />
  );
}

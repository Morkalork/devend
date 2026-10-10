/**
 * The board's own "this is not a normal clear" mark (canvas port of
 * components/game/WinGateFrame.tsx, whose reasoning still holds).
 *
 * A frame around the play area on the maps that want something beyond fencing
 * off space and locking balls, which resolves the moment that requirement is
 * satisfied.
 *
 * ONE state, not a palette. A border language is learned by repetition, and
 * there are seven unusual kinds of which a player meets three, each once or
 * twice a run: a code seen twice is a second puzzle on top of the map. So the
 * frame says one thing - something here is still outstanding - and the chip in
 * the top bar says which and how far.
 *
 * Amber rather than the run's accent, because the accent already means "done"
 * everywhere else in the HUD; a frame in the completion colour, drawn precisely
 * when the map is NOT complete, would say the opposite of what it means.
 *
 * Inert: it covers the whole play area, and the player has to be able to cut.
 */
import { useTween } from "../kit/ui";
import { GlowFrame, Inert } from "./boardParts";
import { OUTSTANDING } from "./overlayModel";

interface Props {
  /** True while the map still owes something beyond an ordinary clear. */
  outstanding: boolean;
  /** The map has an unusual requirement at all; false hides the frame entirely. */
  present: boolean;
  /** The play region's top-left on screen, in CSS px (the DOM's positioned wrapper). */
  origin: { x: number; y: number };
  /** The play region's size in CSS px. */
  width: number;
  height: number;
}

export function WinGateFrame({ outstanding, present, origin, width, height }: Props) {
  // Fades out rather than vanishing: the resolve is a small reward and worth
  // seeing, and an element that blinks away reads as a glitch. Starts at its
  // target, like framer's `initial={false}`.
  const alpha = useTween(outstanding ? 1 : 0, 0.45);
  // Nothing at all on an ordinary map. A frame that is merely dimmer on 37 of
  // 40 maps is chrome, and the eye stops seeing it exactly where it matters.
  if (!present) return null;

  return (
    <Inert label="win-gate-frame" layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }} alpha={alpha}>
      <GlowFrame width={width} height={height} color={OUTSTANDING} border={2}
        inner={{ blur: 18, alpha: 0x55 / 255 }} outer={{ blur: 12, alpha: 0x44 / 255 }} />
    </Inert>
  );
}

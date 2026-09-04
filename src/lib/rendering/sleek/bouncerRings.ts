/**
 * A bumper's three radii, as geometry rather than as three numbers buried in a
 * draw call.
 *
 * Reported from play as "when something hits a bumper it should be clear that
 * it is counting down". It was not: the bank was drawn as a COLOUR - green
 * while anything was left, red once it was not - so a bumper holding one hour
 * looked exactly like one holding five, and a bump costing an hour looked like
 * nothing at all happening.
 *
 * The fix is a size, because a size can show a fraction and a colour cannot.
 * Three rings, and which of them moves is the whole design:
 *
 *   RIM      never moves. It is where the ball actually bounces. A rim that
 *            shrank with the bank would be the one lie this cannot afford -
 *            the player would aim at a small circle and hit a big one.
 *   CHARGE   is the gauge. Full bank at 0.78 of the rim, closing to nothing as
 *            the last hour goes, so the GAP between it and the rim is the
 *            readout. Legible on a phone in a way a digit inside a 40-pixel
 *            circle never was.
 *   CORE     shrinks with it and lights up on a hit, so an emptying bumper
 *            dims and closes together rather than reporting its state in one
 *            place and its mood in another. Never reaches zero: a spent bumper
 *            is an ember, still a bumper and visibly not worth aiming at.
 *
 * Pulled out of the draw call for the reason compassRing was: a renderer layer
 * is the one place in this codebase nothing can check, so the rule lives where
 * it can be, and the layer is left holding only the strokes.
 */

export interface BouncerRings {
  /** The collision boundary, drawn. Constant, whatever the bank holds. */
  rim: number;
  /** The countdown. Zero when the bank is empty, and then not drawn at all. */
  charge: number;
  /** The lit middle, shrinking with the bank and flaring on a hit. */
  core: number;
}

/** Fraction of the rim the full gauge occupies. Comfortably inside it, so the
 *  two never touch and the gap is always readable. */
const CHARGE_SPAN = 0.78;

/**
 * @param charge 0..1, from bouncerCharge - the single definition of how full.
 * @param r      the bumper's drawn radius, in screen units.
 * @param flare  0..1, how recently it fired.
 */
export function bouncerRings(charge: number, r: number, flare: number): BouncerRings {
  const c = Math.max(0, Math.min(1, charge));
  const f = Math.max(0, Math.min(1, flare));
  return {
    rim: r * 0.94,
    charge: r * CHARGE_SPAN * c,
    core: r * (0.12 + 0.18 * c + f * 0.22),
  };
}

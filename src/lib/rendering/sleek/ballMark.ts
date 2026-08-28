/**
 * A ball says what it does without using its colour to say it.
 *
 * Every one of the twelve ball types is identified by hue alone. That fails
 * three ways at once: a phone in daylight, a dark map (which the game now
 * offers deliberately), and colour vision deficiency, which about one man in
 * twelve has. Measured as CIELAB distance under deuteranopia, purple/compass
 * sit 4.6 apart, red/lodestone 5.3 and yellow/rainbow 5.8 - all far under the
 * ~15 where two colours stop being confusable. Those are not shades of the same
 * idea: they are "slows every other ball" against "nine seconds until the turn".
 *
 * So each ABILITY gets a mark, and a plain ball stays plain. That rule is worth
 * more than a per-type mark would be: it means a mark on a ball always means
 * "this one does something", and the two plain types (red, blue) are far apart
 * in every colour space anyway.
 *
 * ── Why the marks look like this ───────────────────────────────────────────
 *
 * A ball is 18 world units on a 900-unit board, so on a phone it is about
 * sixteen screen pixels across and the mark inside it gets eleven. That is the
 * same budget that made the compass a ring instead of a numeral. Eleven pixels
 * buys a topology, not a picture: how many strokes, and roughly where they run.
 * So every mark here is at most three bold strokes and no two share a topology,
 * which is a claim ballMark.test.ts checks by rasterising them at phone size and
 * comparing the actual pixels rather than trusting this paragraph.
 *
 * Coordinates are unit ball radius, x right and y down, kept inside 0.6 so the
 * mark sits on the lit face of the sphere rather than riding its dark rim.
 */

/** A mark is a handful of these. Coordinates are fractions of the ball radius. */
export type MarkStroke =
  | { kind: "poly"; pts: [number, number][]; close?: boolean }
  | { kind: "dot"; at: [number, number]; r: number };

/**
 * Below this on-screen ball radius the mark is not drawn at all.
 *
 * A mark too small to resolve is not a faint mark, it is a smudge that dirties
 * the ball and reads as damage. Balls get this small during the level-clear
 * shrink and on assimilating balls, where identity has stopped mattering
 * anyway.
 */
export const MARK_MIN_RADIUS_PX = 5;

/** Stroke width, in screen pixels, at a given ball radius. Bold or nothing. */
export function markWidth(radiusPx: number): number {
  return Math.max(1.7, radiusPx * 0.23);
}

/**
 * The marks, by ability id (see public/balls.yml).
 *
 * Each is chosen to fit its ability where that was possible without costing
 * legibility - a bolt for the ball whose speed jumps around, a wedge for the
 * one that smashes things - and to differ in
 * stroke COUNT and DIRECTION from every other, which is the part that survives
 * being sixteen pixels wide.
 */
export const BALL_MARKS: Record<string, MarkStroke[]> = {
  // Speed that jumps: a bolt.
  variableSpeed: [
    { kind: "poly", pts: [[-0.27, -0.55], [0.11, -0.11], [-0.11, 0.11], [0.27, 0.55]] },
  ],
  // An aura pushing outward at everything else on the board.
  slowOthers: [
    { kind: "poly", pts: ring(0.58) , close: true },
  ],
  // A gem: this is the one that pays.
  moneyBall: [
    { kind: "poly", pts: [[0, -0.6], [0.44, 0], [0, 0.6], [-0.44, 0]], close: true },
  ],
  // Winding down: two chevrons pointing the way the speed is going.
  slowDown: [
    { kind: "poly", pts: [[-0.44, -0.4], [0, 0.02], [0.44, -0.4]] },
    { kind: "poly", pts: [[-0.44, 0.1], [0, 0.52], [0.44, 0.1]] },
  ],
  // The compass rose. It also wears a countdown ring outside the ball, drawn
  // separately by the ball layer; this is what identifies it when the ring is
  // between cycles.
  turnTimer: [
    { kind: "poly", pts: [[-0.58, 0], [0.58, 0]] },
    { kind: "poly", pts: [[0, -0.58], [0, 0.58]] },
  ],
  // Pulling inward from both sides.
  attract: [
    { kind: "poly", pts: [[-0.48, -0.38], [-0.14, 0], [-0.48, 0.38]] },
    { kind: "poly", pts: [[0.48, -0.38], [0.14, 0], [0.48, 0.38]] },
  ],
  // A wedge, driven into things.
  breakObjects: [
    { kind: "poly", pts: [[0, -0.58], [0.46, 0.4], [-0.46, 0.4]], close: true },
  ],
  // It splits into more of itself.
  rainbow: [
    { kind: "dot", at: [-0.42, 0], r: 0.2 },
    { kind: "dot", at: [0, 0], r: 0.2 },
    { kind: "dot", at: [0.42, 0], r: 0.2 },
  ],
  // Press here.
  tappable: [
    { kind: "dot", at: [0, 0], r: 0.34 },
  ],
};

/** A closed polygon approximating a circle, so a ring needs no arc primitive. */
function ring(r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/**
 * The mark for a ball's ability, or null for a ball that simply rolls.
 *
 * "none" and an unknown ability are the same answer deliberately: a ball type
 * added to balls.yml without a mark here draws clean rather than throwing or
 * borrowing another ability's symbol, which would be a lie about what it does.
 */
export function markFor(ability: string | undefined | null): MarkStroke[] | null {
  if (!ability || ability === "none") return null;
  return BALL_MARKS[ability] ?? null;
}

/**
 * Black or white, whichever the ball's own colour can carry.
 *
 * Marks are drawn over the sphere bake, which is lit and therefore lighter at
 * the middle than the flat colour suggests - so the threshold sits above mid
 * grey rather than at it. Getting this wrong does not make the mark ugly, it
 * makes it invisible on exactly the balls (white, yellow) whose colours are
 * already the hardest to tell apart.
 */
export function markColor(ballColor: string): number {
  const hex = ballColor.replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, c => c + c) : hex, 16);
  if (!Number.isFinite(n)) return 0x000000;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 115 ? 0x101418 : 0xffffff;
}

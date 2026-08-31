/**
 * The nudge that shows a player how to wake a sleeper.
 *
 * "Wire the Integration" is explained by a modal, and that modal is gated on a
 * single once-ever flag - so it appears on level 15 and never again. Level 16
 * is the map whose whole point is waking BOTH terminals, and level 31 is
 * sixteen levels later crossed with a one-way membrane, and neither of them
 * says anything at all. A returning player meets a teal dot with no explanation
 * attached to it.
 *
 * So: if a circuit map has been played for a while and nothing has been lit,
 * draw the gesture instead of describing it. Lighting a terminal is literally
 * "a committed cut passes within radius of the node", so a ghost fence through
 * a node is not an illustration of the lesson, it IS the lesson.
 *
 * ── Why there is no "have they done it yet" flag ───────────────────────────
 *
 * There does not need to be one. A lit terminal is the record: the player
 * cannot have lit one without routing a fence through it, so `any terminal lit`
 * and `the player knows how` are the same fact. Tracking it separately would be
 * a second copy of one truth, and the copy is the one that goes stale.
 */

/** Just enough of a runtime terminal for the decision. */
export interface HintTerminal {
  x: number;
  y: number;
  lit: boolean;
}

export interface CircuitHintInput {
  /** The map's terminals, or null/empty when it has no circuit. */
  terminals: HintTerminal[] | null | undefined;
  /**
   * Seconds of ACTIVE play. Not the wall clock: the hint must not count down
   * while its own explainer modal is open, or while the game is paused in a
   * menu, or it fires the instant the player returns and reads as a glitch.
   * Every other timer in this game runs on this for the same reason.
   */
  activePlaySeconds: number;
  /** Suppressed while any of these hold. */
  paused?: boolean;
  modalOpen?: boolean;
  levelEnded?: boolean;
  /** Suppressed mid-drag: the player is already doing the thing. */
  isDragging?: boolean;
}

/** How long a circuit map plays with nothing lit before the gesture appears. */
export const CIRCUIT_HINT_DELAY_SECONDS = 10;

/**
 * Which terminal to demonstrate on, or null for "say nothing".
 *
 * Returns the FIRST unlit terminal in authored order rather than the one
 * nearest anything. Nearest-to-a-ball would re-target as the ball moves and the
 * hint would hop between nodes while the player is reading it; authored order
 * is stable, and it is the designer's order, which is the closest thing to an
 * intended teaching sequence the map has.
 */
export function circuitHintTarget(input: CircuitHintInput): HintTerminal | null {
  const { terminals, activePlaySeconds } = input;
  if (!terminals || terminals.length === 0) return null;
  if (input.paused || input.modalOpen || input.levelEnded || input.isDragging) return null;

  // Any lit terminal means the player has already routed a fence through one,
  // which is the whole lesson. Silent from then on, for the rest of the map.
  if (terminals.some(t => t.lit)) return null;

  if (activePlaySeconds < CIRCUIT_HINT_DELAY_SECONDS) return null;

  return terminals.find(t => !t.lit) ?? null;
}

/**
 * The demo gesture for a terminal, in world coordinates.
 *
 * Horizontal and centred on the node. Horizontal because the game's fences are
 * axis-aligned, so this is the SHAPE of a real cut rather than an arbitrary
 * line; centred because the instruction is "a fence that passes through here",
 * not "make this exact cut" - which would be a promise the hint cannot keep.
 * The board is dealt in one of four orientations and the surrounding obstacles
 * move with it, so no authored line can be guaranteed legal, let alone wise.
 *
 * Clamped to the board so a node near an edge still gets a symmetrical-looking
 * gesture rather than one running off into the letterbox.
 */
export function circuitHintGesture(
  terminal: HintTerminal, boardWidth: number,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const half = Math.max(40, boardWidth * 0.11);
  const from = { x: Math.max(0, terminal.x - half), y: terminal.y };
  const to = { x: Math.min(boardWidth, terminal.x + half), y: terminal.y };
  return { from, to };
}

/**
 * Storage key for the circuit explainer modal, per map.
 *
 * Lives here rather than in GameScreen because it is not a component concern:
 * the modal reads it, the tutorial reset sweeps it by prefix, and the tests
 * assert on it. Exporting it from a component file also trips
 * react-refresh/only-export-components, which is the linter making the same
 * point about where a constant belongs.
 */
export function circuitSeenKey(levelId: string): string {
  return `${CIRCUIT_SEEN_PREFIX}${levelId}`;
}

/** The prefix resetAllTutorials sweeps. Changing it silently breaks that sweep. */
export const CIRCUIT_SEEN_PREFIX = "devend_circuit_tutorial_seen:";

/**
 * The map the retired single flag was really about.
 *
 * `devend_circuit_tutorial_seen` (no suffix) used to mean "seen the circuit
 * explainer anywhere". It is still honoured for level 15 so a player who has
 * already read it there is not shown it again, and ignored everywhere else -
 * which is the whole point of the change.
 */
export const FIRST_CIRCUIT_MAP_ID = "level-15";
export const LEGACY_CIRCUIT_SEEN_KEY = "devend_circuit_tutorial_seen";

/** One-time flag for the delivery-box explainer. Swept by resetAllTutorials. */
export const BOX_SEEN_KEY = "devend_box_tutorial_seen";

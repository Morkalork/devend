/**
 * The colour a map's RULE wears in the UI.
 *
 * One constant because the rule is stated in more than one place and those
 * places have to look like the same statement. It is deliberately not the run
 * accent (that is the player's own colour, and it re-skins to danger red on a
 * boss map) and not the reward gold, which now means "something you earned".
 *
 * The board's gravity cue keeps its own colour in PALETTE: that marks a
 * DIRECTION on the board and has to be read against the play surface, which is
 * a different job from naming the rule in the chrome.
 */
export const MAP_RULE_VIOLET = '#c084fc';

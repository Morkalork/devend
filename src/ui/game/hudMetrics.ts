/**
 * The play screen's HUD heights, in CSS pixels, decided rather than measured.
 *
 * The board is laid out in the space the HUD leaves (GameCanvas), once, and
 * must never move after it appears (e414b10). The DOM HUD got there by
 * reserving rows and measuring the stack; on the canvas the rows have fixed
 * heights, so the space is known in the same render that decides what the HUD
 * shows, before the board is laid out. The values are the DOM HUD's own,
 * measured on a 390x844 phone, so the board keeps exactly the size it had.
 */
export const HUD = {
  /** Level, lives and the menu chevron. */
  topRow1: 41,
  /** The stat chips. */
  topRow2: 34,
  /** The projected-score bar under the chips, when a highscore is in reach. */
  highscoreRow: 22,
  /** The five fence slots. */
  fenceRow: 52,
  /** The ability buttons, one row (it scrolls sideways rather than wrapping). */
  abilityRow: 52,
  /** The one line shared by the message, Ship Early and ability timers. */
  contextLane: 34,
  /** The "bank and stop pushing" action, while pushing. */
  pushExitRow: 56,
  /** Menu, pause, specs and win buttons. */
  controlsRow: 56,
} as const;

export function topBarHeight(showHighscoreBar: boolean): number {
  return HUD.topRow1 + HUD.topRow2 + (showHighscoreBar ? HUD.highscoreRow : 0);
}

export interface BottomStackShape {
  /** The fence slot and ability rows go when the map is won. */
  mapComplete: boolean;
  /** Any ability owned (the row is empty, and takes no space, otherwise). */
  hasAbilities: boolean;
  pushExit: boolean;
}

export function bottomStackHeight(s: BottomStackShape): number {
  return (s.mapComplete ? 0 : HUD.fenceRow)
    + (!s.mapComplete && s.hasAbilities ? HUD.abilityRow : 0)
    + HUD.contextLane
    + (s.pushExit ? HUD.pushExitRow : 0)
    + HUD.controlsRow;
}

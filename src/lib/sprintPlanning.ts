/**
 * Sprint Planning (the run-start loadout draft) — ON HOLD.
 *
 * Sprint Planning is the RunDraftScreen step that a fresh run used to visit
 * before level 1, where the player drafted one curse + blessing loadout (or
 * skipped) to shape the run. It is switched off for now.
 *
 * This is a HOLD, not a deletion: RunDraftScreen, public/loadouts.yml, the
 * draft RNG and the whole modifier pipeline are untouched. With Ascension
 * (the other loadout draft) removed, this is now the only way loadouts reach a
 * run, so the main menu's Loadouts entry is hidden while it is off. Flipping
 * this constant back to `true` restores the run-start draft on all three
 * run-start paths (New Game, Play Again, Restart) and the menu entry, with no
 * other edit.
 *
 * What the flag gates, all in useGameSession:
 *  - `enterRun` never routes to the runDraft screen, so a run goes straight
 *    into the map (via the Tenure draft when one is owed).
 *  - the final-level win credits no run-start loadout toward unique wins.
 *  - Index hides the main menu's Loadouts entry.
 */
export const SPRINT_PLANNING_ENABLED = false;

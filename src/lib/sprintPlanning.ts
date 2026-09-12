/**
 * Sprint Planning (the run-start loadout draft) — ON HOLD.
 *
 * Sprint Planning is the RunDraftScreen step that a fresh run used to visit
 * before level 1, where the player drafted one curse + blessing loadout (or
 * skipped) to shape the run. It is switched off for now.
 *
 * This is a HOLD, not a deletion: RunDraftScreen, public/loadouts.yml, the
 * draft RNG and the whole modifier pipeline are untouched, and so is the
 * ASCENSION loadout draft, which is a separate step after beating the final
 * level and still runs. Flipping this constant back to `true` restores the
 * run-start draft on all three run-start paths (New Game, Play Again, Restart)
 * with no other edit.
 *
 * What the flag gates, all in useGameSession:
 *  - `enterRun` never routes to the runDraft screen, so a run goes straight
 *    into the map (via the Tenure draft when one is owed).
 *  - the final-level win credits no run-start loadout toward unique wins,
 *    because `draftedLoadoutIds[0]` would otherwise be an ascension pick
 *    rather than the run-start one the count is specified against.
 */
export const SPRINT_PLANNING_ENABLED = false;

/**
 * Sprint Planning: the run-start offer (SPRINT_PLANNING_PLAN.md).
 *
 * Before map 1 the run deals three cards from public/offers.yml (a boon, a
 * Specialisation, a gamble; src/lib/sprintOffers.ts) and the player takes one
 * or skips. When the previous run earned Tenure its chain is the boon card.
 *
 * It replaced the curse + blessing loadout draft, which was on hold here
 * because every loadout was a stat trade the shop already sold.
 *
 * The constant is the kill switch: false sends every run straight into the
 * map (Tenure included, so it would be lost), hides the main menu's entry, and
 * leaves the rest of the game untouched. What it gates, in useGameSession:
 *  - `enterRun` routes to the runDraft screen only while it is on, and only
 *    once the 'sprintPlanning' feature is unlocked (or Tenure is owed, or
 *    Admin forces the draft on);
 *  - Index shows the main menu's Sprint Planning entry.
 */
export const SPRINT_PLANNING_ENABLED = true;

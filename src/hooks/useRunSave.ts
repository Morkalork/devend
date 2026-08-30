/**
 * useRunSave — persists the current in-progress run so the player can leave the
 * app and Continue later.
 *
 * A snapshot is written each time a new map begins (see the save effect in
 * useGameSession), and cleared when the run ends (win/retire/loss-out) or a New
 * Game is started. The welcome screen shows a Continue button while a save
 * exists.
 *
 * Resume granularity is one map: the run resumes at the START of the map the
 * player was on, with score, upgrades, lives, carries, door/capstone and
 * ascension state intact. Doors/capstones are stored by id and re-hydrated from
 * the loaded pools; the level sequence is stored by id so the resumed variants
 * match the ones the player was playing (the sequence is otherwise re-randomized
 * every run).
 *
 * Not to be confused with useCheckpointSnapshots (the welcome-screen level
 * picker) or the in-run Continue revive (a per-run resource spent on death).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AssignmentMapResult } from '@/types/assignment';

const RUN_SAVE_KEY = 'jezzball_run_v1';
const RUN_SAVE_VERSION = 1;

export interface RunSave {
  version: number;
  savedAt: number;
  // Level position: the run's chosen map variants (by id) + where we are in it.
  levelSequenceIds: string[];
  currentLevelIndex: number;
  // Economy / progression.
  totalScore: number;
  ownedUpgradeIds: string[];
  currentLives: number;
  livesAtLevelStart: number;
  continuesRemaining: number;
  cumulativeLockedBalls: number;
  runLevelsCompleted: number;
  // One-map carries (Clean Release / Budget Cycle).
  carryInstantFences: number;
  carrySpendFences: number;
  carrySpendFenceSpeed: number;
  // Budget Cycle: Retained Earnings head-start carry. Optional: pre-feature
  // saves default to 0 on restore.
  carrySpendCapture?: number;
  // Free-store-item pickups awaiting the next OPEN store (issue #48).
  // Optional: saves from before the feature default to 0.
  carryFreeShopItems?: number;
  // Running contract report card (#49): what the active door's block has
  // produced so far. Optional; missing = zeros.
  blockStats?: { overtime: number; maps: number; locks: number; livesLost: number };
  // Per-map mission results across the active assignment's block (#60), for
  // resuming multi-map mission progress. Optional; missing = empty.
  blockResults?: AssignmentMapResult[];
  // Assignment reward modifiers granted for the rest of the run (#60), re-applied
  // on resume. Optional; missing = none.
  assignmentRewardModifiers?: Record<string, number>;
  // Run-defining picks (re-hydrated from the loaded pools by id).
  activeDoorId: string | null;
  capstoneId: string | null;
  ascensionDepth: number;
  draftedLoadoutIds: string[];
  // Records (HIGHSCORES.md): cumulative overtime after each completed map, and
  // whether the run may file on the ledger (debug starts are not eligible).
  // Optional so saves written before Phase A still load; default [] / true.
  runTrajectory?: number[];
  recordEligible?: boolean;
  // Daily Stand-up (Phase D): the seeded day this run belongs to, or null for
  // a normal run. Optional for the same backward-compat reason; default null.
  dailyKey?: string | null;
  // Chest-earned ability charges banked this run (#38): { abilityId -> count }.
  // Optional; pre-feature saves default to {} on restore.
  abilityCharges?: Record<string, number>;
  // Every ability EARNED this run, spent ones included. Kept apart from
  // abilityCharges because a replenishing ability (abilities.yml `replenishTo`)
  // must keep coming back after its last charge is spent, and a zeroed entry
  // cannot say whether it was earned-and-spent or never held. Optional;
  // pre-feature saves seed it from whatever charges they carry.
  heldAbilityIds?: string[];
}

/** Payload the caller supplies; version + savedAt are stamped on write. */
export type RunSaveInput = Omit<RunSave, 'version' | 'savedAt'>;

function loadRunSave(): RunSave | null {
  try {
    const raw = localStorage.getItem(RUN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSave;
    // A schema bump invalidates old saves rather than risking a broken resume.
    if (!parsed || parsed.version !== RUN_SAVE_VERSION) return null;
    if (!Array.isArray(parsed.levelSequenceIds) || parsed.levelSequenceIds.length === 0) return null;
    if (typeof parsed.currentLevelIndex !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRunSave(save: RunSave): void {
  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(save));
  } catch {
    // ignore storage errors (quota / private mode)
  }
}

function removeRunSave(): void {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    // ignore
  }
}

/** The little the main menu needs to know about a save without loading it. */
export interface SavedRunSummary {
  ascensionDepth: number;
}

const summarise = (save: RunSave | null): SavedRunSummary | null =>
  save ? { ascensionDepth: save.ascensionDepth ?? 0 } : null;

export function useRunSave() {
  // One piece of state, not a boolean beside a depth: two would drift the
  // moment a save was written without updating both.
  const [savedRun, setSavedRun] = useState<SavedRunSummary | null>(() => summarise(loadRunSave()));

  // Re-check on mount in case another tab wrote a save.
  useEffect(() => {
    setSavedRun(summarise(loadRunSave()));
  }, []);

  const saveRun = useCallback((input: RunSaveInput) => {
    writeRunSave({ ...input, version: RUN_SAVE_VERSION, savedAt: Date.now() });
    // Read back rather than summarising what we just wrote, so the menu can
    // only ever describe a save that would actually load. A write rejected on
    // quota, or one the loader would refuse, now leaves Continue hidden instead
    // of offering a run that is not there.
    setSavedRun(summarise(loadRunSave()));
  }, []);

  const clearRun = useCallback(() => {
    removeRunSave();
    setSavedRun(null);
  }, []);

  const readRun = useCallback((): RunSave | null => loadRunSave(), []);

  return { hasSavedRun: savedRun !== null, savedRun, saveRun, clearRun, readRun };
}

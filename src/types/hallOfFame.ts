/**
 * Hall of Fame — the all-time run ledger behind the highscore system
 * (see HIGHSCORES.md). A run's score is its banked overtime; entries carry the
 * run's identity so a record is a story, not just a number.
 */
import { UpgradeTag } from './upgrade';

export interface RunLedgerEntry {
  /** Banked overtime at run end (death or retirement). */
  score: number;
  /** Raw maps completed this run (trajectory length, ascension included). */
  levelsCompleted: number;
  ascensionDepth: number;
  /** Build identity at run end (null = Generalist). */
  primaryTag: UpgradeTag | null;
  secondaryTag: UpgradeTag | null;
  capstoneId: string | null;
  capstoneName: string | null;
  /** Drafted loadouts (index 0 = run start; ascension appends). */
  loadoutIds: string[];
  savedAt: number;
}

export interface HallOfFameState {
  /** All-time best runs, highest score first, capped at MAX_TOP_RUNS. */
  topRuns: RunLedgerEntry[];
  /**
   * The #1 run's cumulative banked overtime after each completed map
   * (index 0 = after the first map). Drives the Record Pace comparison.
   */
  bestRunTrajectory: number[];
}

export const HALL_STORAGE_KEY = 'jezzball_hall_v1';
export const MAX_TOP_RUNS = 10;

export const DEFAULT_HALL_STATE: HallOfFameState = {
  topRuns: [],
  bestRunTrajectory: [],
};

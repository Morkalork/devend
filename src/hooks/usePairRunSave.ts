/**
 * usePairRunSave — Continue, for a pair (TWO_PLAYER_PLAN.md step 6b).
 *
 * The solo run save already has the right shape: it writes a RunSave at the
 * start of every map and resumes at the start of the map the player was on,
 * with score, upgrades, lives and door state intact. One map is also the only
 * granularity a PAIR could resume at, because the mid-map state is the thing
 * this whole plan deliberately never serialises.
 *
 * So a pair save is that record plus a pair identity, under its own key. Its
 * own key matters: a pair run must never overwrite the solo Continue, or an
 * evening of co-op eats the run someone was in the middle of.
 *
 * Kept on BOTH phones, which is the point that is easy to get wrong. One
 * player clearing site data, or coming back on a reinstalled app, would
 * otherwise lose the run for both; with a copy each, whichever phone still has
 * it offers it and sends it across.
 */
import { useCallback, useState } from "react";
import type { RunSave, RunSaveInput } from "@/hooks/useRunSave";

const PAIR_SAVE_KEY = "jezzball_pair_run_v1";
const PAIR_SAVE_VERSION = 1;

export interface PairRunSave {
  version: number;
  /** Hash of the two device ids, sorted, so either phone may host next time. */
  pairId: string;
  /** This particular run, so two saves can be told apart rather than merged. */
  runId: string;
  /** The run seed both devices arm. */
  seed: string;
  /** Both device ids, for showing who the partner was. */
  devices: [string, string];
  savedAt: number;
  /** The same record the solo Continue uses. */
  run: RunSave;
}

/** What a device tells its partner in the hello, so the two can compare. */
export interface PairSaveOffer {
  runId: string;
  levelIndex: number;
  savedAt: number;
}

function read(): PairRunSave | null {
  try {
    const raw = localStorage.getItem(PAIR_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PairRunSave;
    if (!parsed || parsed.version !== PAIR_SAVE_VERSION) return null;
    if (!parsed.pairId || !parsed.run) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(save: PairRunSave): void {
  try { localStorage.setItem(PAIR_SAVE_KEY, JSON.stringify(save)); } catch { /* full or blocked */ }
}

function clear(): void {
  try { localStorage.removeItem(PAIR_SAVE_KEY); } catch { /* nothing to do */ }
}

/**
 * Which of two saves to continue from.
 *
 * The further-along one wins, which covers the ordinary way they differ: one
 * phone was closed before its write landed. Exported because both devices run
 * it on the same two inputs and must reach the same answer without asking each
 * other.
 */
export function chooseSave(
  mine: PairSaveOffer | null, theirs: PairSaveOffer | null,
): "mine" | "theirs" | "none" {
  if (!mine && !theirs) return "none";
  if (!theirs) return "mine";
  if (!mine) return "theirs";
  if (mine.runId !== theirs.runId) {
    // Two different runs under one pair id: the more recent one is the one
    // they were last playing together.
    return mine.savedAt >= theirs.savedAt ? "mine" : "theirs";
  }
  if (mine.levelIndex !== theirs.levelIndex) {
    return mine.levelIndex > theirs.levelIndex ? "mine" : "theirs";
  }
  return mine.savedAt >= theirs.savedAt ? "mine" : "theirs";
}

export function usePairRunSave() {
  const [save, setSave] = useState<PairRunSave | null>(read);

  const refresh = useCallback(() => setSave(read()), []);

  const saveFor = useCallback((pairId: string): PairRunSave | null => {
    const current = read();
    return current && current.pairId === pairId ? current : null;
  }, []);

  const offerFor = useCallback((pairId: string): PairSaveOffer | null => {
    const current = read();
    if (!current || current.pairId !== pairId) return null;
    return {
      runId: current.runId,
      levelIndex: current.run.currentLevelIndex,
      savedAt: current.savedAt,
    };
  }, []);

  const store = useCallback((
    meta: { pairId: string; runId: string; seed: string; devices: [string, string] },
    run: RunSaveInput | RunSave,
  ) => {
    const record: PairRunSave = {
      version: PAIR_SAVE_VERSION,
      ...meta,
      savedAt: Date.now(),
      run: { ...(run as RunSave), version: 1, savedAt: Date.now() },
    };
    write(record);
    setSave(record);
  }, []);

  /** Adopt the partner's copy wholesale. Used when only they had one. */
  const adopt = useCallback((record: PairRunSave) => {
    write(record);
    setSave(record);
  }, []);

  const discard = useCallback(() => { clear(); setSave(null); }, []);

  return { save, refresh, saveFor, offerFor, store, adopt, discard };
}

/**
 * Starting the device check, and where its result goes (DEVICE_LAB.md).
 *
 * Three ways in, one path: Admin's button, `window.__devendStartDeviceCheck()`
 * (the emulated CI tiers call it), and a Firebase Test Lab launch of the APK
 * (testLoop.ts). Each asks here; Index, which owns the screens, listens and
 * opens the check. Before it does, the menu is measured where the player
 * meets it: once loaded and with the splash gone, as pixels read back off the
 * interface canvas.
 */
import { useSyncExternalStore } from "react";
import { startupReadyAt } from "@/lib/startupReadiness";
import { BOOT_SPLASH_ID, dismissBootSplash } from "@/lib/bootSplash";
import { uiCanvasLit } from "@/ui/uiProbe";
import type { DeviceCheckResult, LitSample } from "./model";

export type DeviceCheckSource = "admin" | "ci" | "testLoop";

export interface DeviceCheckRun {
  source: DeviceCheckSource;
  /** Page start to the menu loaded, ms; null when it never finished. */
  bootMs: number | null;
  menu: LitSample | null;
  /** Errors already on the record before the check started, so the result can say which came during it. */
  errorsBefore: number;
  /** Whether frame rate is judged (model.ts VerdictOptions); off only for the emulated CI tiers. */
  judgeFrames: boolean;
}

export type DeviceCheckStatus = "idle" | "starting" | "running" | "done";

interface State {
  status: DeviceCheckStatus;
  run: DeviceCheckRun | null;
  result: DeviceCheckResult | null;
}

let state: State = { status: "idle", run: null, result: null };
const listeners = new Set<() => void>();
const doneListeners = new Set<(r: DeviceCheckResult, run: DeviceCheckRun) => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  const w = window as unknown as { __devendDeviceCheck?: { status: DeviceCheckStatus; result: DeviceCheckResult | null } };
  w.__devendDeviceCheck = { status: state.status, result: state.result };
  for (const l of listeners) {
    l();
  }
}

/** How long it waits for the menu to load and the splash to lift before measuring anyway. */
export const MENU_WAIT_MS = 25000;
/** Settling time on the menu before it is read. */
export const MENU_SETTLE_MS = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function splashUp(): boolean {
  return !!document.getElementById(BOOT_SPLASH_ID);
}

/** Ask for a check. Ignored while one is starting or running. */
export async function requestDeviceCheck(source: DeviceCheckSource, opts: { judgeFrames?: boolean } = {}): Promise<void> {
  if (state.status === "starting" || state.status === "running") {
    return;
  }
  set({ status: "starting", run: null, result: null });
  const since = performance.now();
  while ((startupReadyAt() === null || splashUp()) && performance.now() - since < MENU_WAIT_MS) {
    await sleep(100);
  }
  // The menu's own entrance (a staggered fade, under half a second) finished,
  // and two frames on, so its last change is on the canvas before it is read.
  await sleep(MENU_SETTLE_MS);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let menu: LitSample | null = null;
  try {
    menu = uiCanvasLit();
  } catch {
    menu = null;
  }
  // A splash still up after the wait would stay over the check's own screen
  // (only the menu's gate dismisses it), and a Test Lab video of a splash says
  // nothing.
  dismissBootSplash();
  const errorsBefore = (window as unknown as { __devendBoot?: { errors: string[] } }).__devendBoot?.errors.length ?? 0;
  set({ status: "running", run: { source, bootMs: startupReadyAt(), menu, errorsBefore, judgeFrames: opts.judgeFrames ?? true } });
}

/** The check screen hands its result over. */
export function finishDeviceCheck(result: DeviceCheckResult): void {
  const run = state.run;
  set({ status: "done", result });
  if (run) {
    for (const l of doneListeners) {
      l(result, run);
    }
  }
}

/** Back to idle (the screen was left). */
export function closeDeviceCheck(): void {
  set({ status: state.status === "done" ? "done" : "idle", run: null });
}

/** Told once per finished check: the Test Lab bridge writes it out. */
export function onDeviceCheckDone(listener: (r: DeviceCheckResult, run: DeviceCheckRun) => void): () => void {
  doneListeners.add(listener);
  return () => {
    doneListeners.delete(listener);
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The current run, re-rendering on change: Index opens the screen while there is one. */
export function useDeviceCheckRun(): DeviceCheckRun | null {
  return useSyncExternalStore(subscribe, () => state.run, () => state.run);
}

/** The hook a test harness calls (the emulated CI tiers), installed from main.tsx. */
export function installDeviceCheckHook(): void {
  const w = window as unknown as { __devendStartDeviceCheck?: (opts?: { judgeFrames?: boolean }) => void };
  w.__devendStartDeviceCheck = (opts = {}) => {
    void requestDeviceCheck("ci", opts);
  };
  set({});
}

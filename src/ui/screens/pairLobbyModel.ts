/**
 * The 2-Player screen's non-drawing half (canvas port of
 * components/game/PairLobby): the QR code as a module matrix, the server-nap
 * readout's rules, and the server-nap hook the screen uses. Kept out of the .tsx
 * so it can be tested without a canvas, and so the component file exports
 * only components.
 */
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import qrcode from "qrcode-generator";
import { Coffee, Moon, Sun, CloudOff, Server } from "lucide-react";
import { probeServerNap, type NapState } from "@/lib/net/serverNap";
import { getSimulatedNap, type SimulatedNap } from "@/lib/devFlags";
import type { PairRoute } from "@/lib/net/relay";
import { COLOR } from "../theme";

/** Where the 2-Player screen is in a pairing. */
export type PairPhase =
  | "choose"        // host, or find nearby
  | "hosting"       // showing the code, waiting
  | "joining"       // answering an offer we arrived with
  | "nearby"        // the radios are looking
  | "connected"
  | "failed";

// ── QR code ────────────────────────────────────────────────────────────────

/** Quiet zone around the code, in modules (the DOM's `margin: 2`). */
export const QR_MARGIN = 2;

/**
 * The QR code for `text` as rows of dark (true) / light modules, without the
 * quiet zone.
 *
 * Type 0 = let the encoder pick the smallest version that fits; L is the
 * lowest error correction, which keeps the modules big and therefore easy to
 * scan off a phone screen. A code on a screen is not going to be scratched or
 * printed badly, which is what higher levels buy.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * One row's dark modules as [start, length] runs, so a row is drawn as a few
 * rectangles instead of one per module: fewer shapes, and no hairline seams
 * between neighbouring modules.
 */
export function qrRuns(row: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let c = 0; c <= row.length; c++) {
    const dark = c < row.length && row[c];
    if (dark && start < 0) start = c;
    if (!dark && start >= 0) { runs.push([start, c - start]); start = -1; }
  }
  return runs;
}

/**
 * Where the modules go in a square of `size` px: a whole number of px per
 * module (fractional modules blur on a phone screen), centred.
 */
export function qrGeometry(moduleCount: number, size: number): { cell: number; offset: number } {
  const cells = moduleCount + QR_MARGIN * 2;
  const cell = Math.max(1, Math.floor(size / cells));
  return { cell, offset: Math.floor((size - cell * cells) / 2) + QR_MARGIN * cell };
}

// ── The server's nap ───────────────────────────────────────────────────────

/** What each simulated nap stands in for. "asleep" holds the waking state,
 *  which is the one a real nap spends its seconds in. */
export const SIMULATED: Record<Exclude<SimulatedNap, "off">, NapState> = {
  asleep: "waking",
  justWoke: "justWoke",
  unreachable: "unreachable",
};

/**
 * Whether the server is awake, asked once when the screen opens.
 *
 * Not on the Android app: its pages are served from the phone itself, so there
 * is no server behind `/api/health` to ask, and it pairs with Nearby anyway.
 */
export function useServerNap(): NapState | null {
  const [state, setState] = useState<NapState | null>(null);
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const sim = getSimulatedNap();
    if (sim !== "off") { setState(SIMULATED[sim]); return; }
    return probeServerNap(setState);
  }, []);
  return state;
}

export const NAP_ICON: Record<NapState, typeof Coffee> = {
  checking: Server,
  waking: Moon,
  awake: Sun,
  justWoke: Coffee,
  unreachable: CloudOff,
};

/** amber-500, the DOM's warning tone on this screen. */
export const PAIR_AMBER = 0xf59e0b;

export function napTone(state: NapState): number {
  return state === "unreachable" ? COLOR.destructive
    : state === "waking" ? PAIR_AMBER
    : state === "checking" ? COLOR.mutedForeground
    : COLOR.primary;
}

/**
 * Whether the nap readout shows while a code is up or a join is under way.
 * Only when it has something to say: a server that answered promptly is not
 * news while the QR is up.
 */
export const napWorthShowing = (nap: NapState | null): nap is NapState =>
  !!nap && nap !== "awake" && nap !== "checking";

export const napTextKey = (state: NapState) => `pair.nap.${state}`;
export const napTipKey = (state: NapState) => `pair.nap.tip.${state}`;

export const routeKey = (route: PairRoute) => (route === "relay" ? "pair.viaRelay" : "pair.viaDirect");

export const permissionKey = (missing: string) => (missing === "location" ? "pair.needLocation" : "pair.needPermission");

// ── Copy feedback ──────────────────────────────────────────────────────────

export type CopyState = "idle" | "copied" | "failed";

/** How long "Copied" shows before the button reads "Copy link" again. */
export const COPIED_RESET_MS = 2000;

/**
 * The state after a copy attempt, and whether it fades back to idle:
 * "Copied" fades back to the button; a failure stays, since the link it
 * reveals is what the player now needs.
 */
export const copyOutcome = (ok: boolean): { state: CopyState; resets: boolean } =>
  ({ state: ok ? "copied" : "failed", resets: ok });

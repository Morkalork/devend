/**
 * The rules behind MapTuningModal's number fields, apart from the drawing.
 * Dev tooling, so the copy is plain English, matching the Admin panel.
 */
import type { MapTuning } from "@/lib/mapTuning";

export interface TuningFieldSpec {
  key: keyof Required<MapTuning>;
  label: string;
  hint: string;
  min: number;
  max: number;
  suffix?: string;
}

/** The two fields, in the order shown. */
export const TUNING_FIELDS: TuningFieldSpec[] = [
  {
    key: "expectedCuts",
    label: "Par (fences)",
    hint: "A clean solve's fence count. Drives the under-par bonus and the over-par penalty.",
    min: 1,
    max: 40,
  },
  {
    key: "sizeThreshold",
    label: "Clear threshold",
    hint: "How much board may be left when the map is won. Lower is a longer map.",
    min: 1,
    max: 95,
    suffix: "%",
  },
];

export function clampTuning(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * What typing into a field commits: the clamped number, or null to keep the
 * last good value. A blank or half-typed field ("", "-", "1e") is null, so
 * clearing the field to type a new number does not snap it to the minimum.
 */
export function parseTuningInput(text: string, min: number, max: number): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? clampTuning(n, min, max) : null;
}

/** The step buttons: one up or down, clamped, and whether each can move at all. */
export function tuningStep(value: number, min: number, max: number) {
  return {
    down: clampTuning(value - 1, min, max),
    up: clampTuning(value + 1, min, max),
    canDown: value > min,
    canUp: value < max,
  };
}

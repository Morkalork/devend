/**
 * Find the beam in a live session, because it will not show itself in a test.
 *
 * A player reported a thin line reaching across the board from a ball, three
 * times. Two fixes were made and both were real bugs, and the line is still
 * there. A headless sweep over all nine layers (rendererNoBeams.test.ts) is
 * clean, and playing the map locally for several minutes never reproduced it.
 * So the trigger is something about a real, long-lived session that neither a
 * synthetic game state nor a fresh run has.
 *
 * At that point the useful thing is not another hypothesis, it is eyes on the
 * frame where it actually happens. This walks the live display tree, finds any
 * Graphics holding a straight span longer than a mark could honestly be, and
 * names the layer.
 *
 * ── Off unless asked for ──────────────────────────────────────────────────
 *
 * Gated on `?beam=1` and does nothing at all otherwise: no walk, no allocation,
 * no cost on the frame. It also throttles to roughly twice a second, because
 * the walk is O(all geometry) and running it at 60fps would change the thing it
 * is measuring.
 */
import type { Container, Graphics } from "pixi.js";

/**
 * How close to the canvas origin a point has to be to count as a stray.
 *
 * The test is the ORIGIN, not length, and the first live run is why. A length
 * threshold flagged a board grid line, a shadow span and a board edge on the
 * very first frame: the canvas is in DEVICE pixels, so on a 2x display the
 * board itself is ~1250px and every honest full-height line clears any bound
 * low enough to catch a beam.
 *
 * The origin has no such problem. The board is inset within the canvas - its
 * own geometry starts around (1276,89) on that same frame - so nothing any
 * layer draws on purpose lands on (0,0). A point there is a subpath that was
 * never opened, which is exactly what a beam is: Pixi joins the shape to
 * wherever the path last was, and on a cleared Graphics that is the origin.
 */
const ORIGIN_TOL = 2;

/** Twice a second. The walk is not free and must not perturb the frame. */
const PROBE_MS = 500;

/**
 * Show the answer ON SCREEN, not in the console.
 *
 * The person who can reproduce this is on a phone. A console.warn there is
 * effectively write-only, so the probe would be a diagnostic only its author
 * could read. A fixed banner they can screenshot is the entire delivery
 * mechanism.
 */
export function showBeamReadout(lines: string[]): void {
  if (typeof document === "undefined") return;
  const ID = "devend-beam-readout";
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    el.setAttribute("style", [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483647",
      "background:rgba(120,0,0,0.92)", "color:#fff",
      "font:11px/1.35 ui-monospace,Menlo,Consolas,monospace",
      "padding:6px 8px", "white-space:pre-wrap", "pointer-events:none",
    ].join(";"));
    document.body.appendChild(el);
  }
  el.textContent = lines.join(" │ ");
}

export interface BeamHit {
  layer: string;
  /** Screen-space endpoints, so the report can be checked against the picture. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  length: number;
}

/** Is the live URL asking for the probe? */
export function beamProbeOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("beam") === "1";
  } catch {
    return false; // no window (SSR / test env without a location)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Every straight run in one Graphics, longest first.
 *
 * Reads the built geometry rather than the draw calls, so it does not care
 * which call produced the line or whether anyone predicted that call could.
 * That is the whole point: the last two diagnoses were both reasoning about
 * which call was at fault, and both were wrong.
 */
function straysIn(g: any): Array<{ to: { x: number; y: number }; length: number }> {
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);

  const strays: Array<{ to: { x: number; y: number }; length: number }> = [];
  for (const path of paths) {
    for (const prim of path.shapePath?.shapePrimitives ?? []) {
      const pts: number[] = (prim.shape as any).points ?? [];
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (Math.hypot(pts[i], pts[i + 1]) > ORIGIN_TOL) continue;
        strays.push({
          to: { x: pts[i + 2], y: pts[i + 3] },
          length: Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]),
        });
      }
    }
  }
  return strays;
}

function walk(node: Container, label: string, out: BeamHit[]): void {
  const g = node as unknown as { context?: unknown };
  if (g.context) {
    for (const s of straysIn(node)) {
      // A zero-length stray is a duplicated first point, not a line anyone can
      // see. Only a stray that actually goes somewhere is a beam.
      if (s.length <= ORIGIN_TOL) continue;
      out.push({ layer: label, from: { x: 0, y: 0 }, to: s.to, length: Math.round(s.length) });
    }
  }
  const kids = (node as any).children ?? [];
  for (let i = 0; i < kids.length; i++) walk(kids[i], `${label}[${i}]`, out);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Run the probe over a set of named roots, or return null if it is not due yet.
 *
 * Returns the hits so the caller can decide what to do with them; this module
 * deliberately does not draw or log on its own, so it stays testable and has no
 * opinion about how the answer is surfaced.
 */
export class BeamProbe {
  /**
   * -Infinity, not 0. Starting at zero throttles the probe's own FIRST call
   * against a clock that also starts near zero, so the earliest frames - the
   * ones right after a map loads, which is where the beam was photographed -
   * are exactly the ones it would skip.
   */
  private lastRun = -Infinity;
  /** So a beam that comes and goes still gets reported once per appearance. */
  private lastReport = "";

  /** null when throttled or when nothing is wrong. */
  run(roots: Array<[string, Container | Graphics]>, now: number): BeamHit[] | null {
    if (now - this.lastRun < PROBE_MS) return null;
    this.lastRun = now;

    const hits: BeamHit[] = [];
    for (const [label, root] of roots) walk(root as Container, label, hits);
    if (hits.length === 0) { this.lastReport = ""; return null; }

    hits.sort((a, b) => b.length - a.length);
    // Report on change only. A beam that persists for thirty seconds is one
    // fact, not eighteen hundred console lines.
    const key = hits.map(h => h.layer).join(",");
    if (key === this.lastReport) return null;
    this.lastReport = key;
    return hits;
  }
}

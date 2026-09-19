/**
 * simState — the simulation's module-level state, in one place.
 *
 * Most of the game lives on the CanvasGameState object, which is why so much
 * of this plan was possible. Three things do not, and they all feed the
 * simulation:
 *
 *   1. the sim clock (simClock.ts);
 *   2. the seeded streams' positions (runRng.ts);
 *   3. the id counters that name new regions and walls when a cut splits the
 *      board (gameUtils.ts, spaceGrid.ts).
 *
 * On a phone that is fine: one device, one module instance, and both devices
 * run the same commands in the same order, so all three stay in step by
 * construction. It stops being fine in exactly two places, and both of them
 * matter:
 *
 *   - A REPAIR. Putting a drifted guest back on the host's board means its
 *     clock and its dice too, or the very next roll parts them again, and its
 *     id counters too, or the next split names a region something the host has
 *     never heard of. A snapshot of positions alone was the first version of
 *     the resync, and it did not hold.
 *   - A TEST that runs two simulations in one process, which is the only way
 *     to test any of this without two phones. There, one module instance is
 *     shared by both sims, and without taking turns with it device A draws
 *     device B's numbers and names its regions with B's counter. That is not a
 *     bug the product can have; it is a bug the test bench has, and it looks
 *     exactly like a desync, which makes it worth naming rather than working
 *     around quietly.
 */
import { simNow, setSimNow } from "@/lib/simClock";
import {
  exportStreamCursors, importStreamCursors, type StreamCursors,
} from "@/lib/runRng";
import { exportMapIdCounters, importMapIdCounters } from "@/lib/gameUtils";
import { exportGridRegionIdCounter, importGridRegionIdCounter } from "@/lib/spaceGrid";

export interface SimModuleState {
  clockMs: number;
  cursors: StreamCursors;
  ids: { region: number; wall: number };
  gridRegionId: number;
}

export function captureSimModuleState(): SimModuleState {
  return {
    clockMs: simNow(),
    cursors: exportStreamCursors(),
    ids: exportMapIdCounters(),
    gridRegionId: exportGridRegionIdCounter(),
  };
}

export function restoreSimModuleState(s: SimModuleState): void {
  setSimNow(s.clockMs);
  importStreamCursors(s.cursors);
  importMapIdCounters(s.ids);
  importGridRegionIdCounter(s.gridRegionId);
}

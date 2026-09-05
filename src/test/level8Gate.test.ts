/**
 * Level 8's gate is satisfiable, which is not the same as "the map has a gate".
 *
 * The map asks for two things at once: clear to 81%, AND lock a ball inside the
 * pink box. The second one is the risky half, because the box sits over ground
 * that does not exist when the map starts - the corner is `reveals` space,
 * locked and uncuttable until the curtain breaks. A gate over cells no ball can
 * enter is a map that cannot be won, and nothing on screen would say why.
 *
 * So this checks the three things that have to hold, in order:
 *
 *   1. the corner is genuinely sealed at load (or the reveal means nothing),
 *   2. the box covers the corner and only the corner (containment: a lock
 *      counts as "in the area" only if EVERY cell of the pocket is inside it),
 *   3. the corner is big enough to hold a lockable pocket after it opens, and
 *      too big to be one itself - which is the map's whole inversion.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { resolveWinSpec } from "@/lib/winSpec";
import { gateAreas } from "@/lib/coloredAreas";
import { CellState } from "@/lib/spaceGrid";
import { rotateColoredArea } from "@/lib/mapRotation";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import type { LevelConfig, LevelData } from "@/types/level";

const MAPS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const L8 = MAPS.find(l => l.level === 8)!;

describe("level 8 asks for the box, and can be given it", () => {
  it("requires the clear AND the lock, never one instead of the other", () => {
    const spec = resolveWinSpec(L8);
    expect(spec.authored, "a bare gate would drop the space clause").toBe(true);
    const kinds = spec.require.map(c => c.kind).sort();
    expect(kinds).toEqual(["area", "space"]);
    const area = spec.require.find(c => c.kind === "area") as { count: number };
    expect(area.count).toBe(1);
    const space = spec.require.find(c => c.kind === "space") as { threshold: number };
    expect(space.threshold, "the clear must match the map's own threshold")
      .toBe(L8.sizeThreshold);
  });

  it("draws the box as a GATE, so it reads as required rather than optional", () => {
    // A bonus pocket is dotted and faint; a gate is solid and bright. The win
    // asks for the area, so the area has to say it asks.
    expect(gateAreas(L8.coloredAreas ?? []).length).toBe(1);
  });

  it("puts the box exactly over the ground the curtain reveals", () => {
    const box = (L8.coloredAreas ?? [])[0];
    const curtain = (L8.entities ?? []).find(e => (e as { id: string }).id === "curtain") as
      unknown as { reveals: { x: number; y: number; width: number; height: number } };
    expect(curtain?.reveals, "the curtain reveals nothing").toBeTruthy();
    const r = curtain.reveals;
    // Containment: a seal counts as "inside the area" only when every cell of
    // it is inside the box, so revealed ground outside the box would be ground
    // the player can capture and never lock in.
    expect(r.x).toBeGreaterThanOrEqual(box.x);
    expect(r.y).toBeGreaterThanOrEqual(box.y);
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width);
    expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height);
  });

  it("keeps the corner shut until something breaks the curtain", () => {
    // If a ball could already be in there, the reveal is decoration and the
    // gate is free. Measured on the built grid: every cell under the box is
    // REMOVED at load.
    const d = createInitialGameData(L8, 8, DEFAULT_MODIFIERS);
    const g = d.spaceGrid!;
    // Level 8 is past ROTATION_MIN_LEVEL, so the authored box is not where the
    // box IS. GameCanvas rotates it with rotateColoredArea; do the same here,
    // or this measures an empty corner of the board and passes for nothing.
    const built = rotateColoredArea((L8.coloredAreas ?? [])[0], d.mapRotation);
    let active = 0, total = 0;
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const x = g.originX + c * g.cellSize + g.cellSize / 2;
        const y = g.originY + r * g.cellSize + g.cellSize / 2;
        if (x < built.x || x > built.x + built.width) continue;
        if (y < built.y || y > built.y + built.height) continue;
        total++;
        if (g.cells[r * g.width + c] === CellState.ACTIVE) active++;
      }
    }
    expect(total, "no cells found under the box").toBeGreaterThan(50);
    expect(active / total, "the corner is already open, so the gate is free")
      .toBeLessThan(0.05);
  });

  it("is too big to lock whole, and big enough to cut a lock out of", () => {
    const d = createInitialGameData(L8, 8, DEFAULT_MODIFIERS);
    const g = d.spaceGrid!;
    // Against the board's own playable cell count, which is the denominator a
    // lock is actually graded on early in a map.
    const boardCells = g.initialActiveCount;
    const box = (L8.coloredAreas ?? [])[0];
    const cornerCells = (box.width / g.cellSize) * (box.height / g.cellSize);

    // Whole: over the lock threshold, so sealing the corner in one cut does
    // not pay. This is the map's inversion and it must actually hold.
    expect((cornerCells / boardCells) * 100).toBeGreaterThan(BALL_WON_REGION_THRESHOLD);
    // Halved: comfortably under it, so there IS a cut that wins the map.
    expect((cornerCells / 2 / boardCells) * 100).toBeLessThan(BALL_WON_REGION_THRESHOLD);
  });
});

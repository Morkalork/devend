/**
 * The gap rule, measured on the geometry that actually ships.
 *
 * `featureSchedule.test.ts` already forbids a gap in the 12-60 band: wide
 * enough to look like a way through, narrow enough that a 36-unit ball (47
 * enlarged) never takes it, so the space behind it is neither reachable nor
 * sealable. It checks the numbers typed into map.yml.
 *
 * Those are not the numbers the player meets. `applyRectVariation` scales every
 * non-mirror rect's width and height by up to +/-variety% about its centre, so
 * each facing edge of a neck moves by variety% x its own extent / 2. Two
 * 300-tall stubs at variety 10 move 15 each: an authored 60-unit neck arrives
 * anywhere in [30, 90], and half that range is the band the rule exists to
 * forbid. The authored guard cannot see any of it.
 *
 * This is not hypothetical. When this test was written, SEVEN shipping maps
 * landed in the band at runtime while passing the authored check - level 27
 * on nearly every deal, and level 34's typed pipe (documented in map.yml as a
 * "66-unit corridor only grey balls may enter") measuring 51-60 in practice.
 *
 * So this builds each map several times and measures what came out.
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
import type { LevelConfig, LevelData } from "@/types/level";

const MAPS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

const SEAM_MAX = 12;
const NECK_MIN = 60;
/** Deals per map. The rotation and the variety draw both key off the run rng. */
const BUILDS = 8;

/**
 * Maps whose runtime gaps are known to land in the band, pending their act's
 * redesign. Every one of them is a map authored with variety > 0 and a neck
 * sized as though variety did not exist.
 *
 * May only SHRINK. An entry comes off when its act is authored to survive its
 * own variety draw (or is dropped to variety 0, which is what act I did); none
 * is ever added to silence a new map.
 */
const UNMIGRATED = [
  "level-6", "level-13", "level-23", "level-25", "level-27", "level-31", "level-34",
];

type Rect = { id: string; x0: number; x1: number; y0: number; y1: number };

/** The built outline of every authored rect wall, read back off its edge walls. */
function builtRects(level: LevelConfig): Rect[] {
  const d = createInitialGameData(level, level.level, DEFAULT_MODIFIERS);
  const ids = (level.entities ?? [])
    .filter(e => e.kind === "wall" && e.shape === "rect")
    .map(e => (e as unknown as { id: string }).id);
  const out: Rect[] = [];
  for (const id of ids) {
    const ws = d.walls.filter(w => w.id.startsWith(`obstacle-${id}-`));
    if (!ws.length) continue;
    const xs = ws.flatMap(w => [w.start.x, w.end.x]);
    const ys = ws.flatMap(w => [w.start.y, w.end.y]);
    out.push({
      id, x0: Math.min(...xs), x1: Math.max(...xs),
      y0: Math.min(...ys), y1: Math.max(...ys),
    });
  }
  return out;
}

/** Gaps between stubs that line up: the places a ball could try to pass. */
function gapsIn(rs: Rect[]): { gap: number; between: string }[] {
  const out: { gap: number; between: string }[] = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0) {
        const g = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
        if (g > 0) out.push({ gap: g, between: `${a.id}|${b.id}` });
      }
      if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0) {
        const g = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        if (g > 0) out.push({ gap: g, between: `${a.id}|${b.id}` });
      }
    }
  }
  return out;
}

describe("the gap rule holds on the geometry that ships", () => {
  it("leaves no runtime gap a ball half-fits through", { timeout: 120000 }, () => {
    const offenders: string[] = [];
    for (const l of MAPS) {
      if (UNMIGRATED.includes(l.id)) continue;
      const seen = new Set<string>();
      for (let b = 0; b < BUILDS; b++) {
        for (const { gap, between } of gapsIn(builtRects(l))) {
          if (gap > SEAM_MAX && gap < NECK_MIN) {
            seen.add(`${l.id}: ${Math.round(gap)}u between ${between}`);
          }
        }
      }
      offenders.push(...seen);
    }
    expect(offenders).toEqual([]);
  });

  it("proves the check would catch a map that only passes on paper", () => {
    // Guard-me-not. Two stubs 90 apart is legal on paper and legal at variety 0,
    // and at variety 30 the facing edges move 45 each: the neck closes to 0 and
    // passes through the whole forbidden band on the way. If this fixture ever
    // reads clean, the test above is measuring authored numbers again.
    const level = {
      id: "gap-fixture", level: 3, sizeThreshold: 30, expectedCuts: 4, points: 20,
      variety: 30, randomShapes: 0, maxBalls: 1,
      entities: [
        { id: "a", kind: "wall", shape: "rect", x: 437, y: 45, width: 26, height: 300 },
        { id: "b", kind: "wall", shape: "rect", x: 437, y: 435, width: 26, height: 300 },
      ],
    } as unknown as LevelConfig;
    const authored = 435 - 345;
    expect(authored, "the fixture is not authored legal").toBeGreaterThanOrEqual(NECK_MIN);

    let sawBand = false;
    for (let b = 0; b < 40 && !sawBand; b++) {
      for (const { gap } of gapsIn(builtRects(level))) {
        if (gap > SEAM_MAX && gap < NECK_MIN) sawBand = true;
      }
    }
    expect(sawBand, "variety never moved an authored-legal neck into the band").toBe(true);
  });
});

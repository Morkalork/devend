/**
 * A circuit's sleeper is never buried under a decoration.
 *
 * A dormant ball reserves the space around it and cannot be cleared until a
 * fence routes through its terminal and wakes it. Bury one inside an obstacle
 * and it can never be woken, the space it holds can never be taken, and the map
 * is unwinnable with nothing on screen to say why.
 *
 * `generateRandomObstacles` has always taken a list of positions to keep clear,
 * and initGame passed it an empty one with the note "balls now spawn at
 * game-chosen positions (after obstacles), so none to avoid here". True of
 * ordinary balls, which are placed into whatever open space is left. NOT true
 * of a circuit's sleepers, whose positions are authored on the map and fixed
 * long before anything random is rolled.
 *
 * The existing circuit test sampled four random inits per map and caught this
 * about one run in three, which reads as a flaky test rather than as a real
 * defect. This sweeps SEEDS instead: `getRunRng` is a Math.random passthrough
 * until a run seed is armed, so arming one makes the obstacle field
 * reproducible and the whole thing a decision rather than a dice roll.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { isPositionActive } from "@/lib/spaceGrid";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig, LevelData } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const MODS = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, startingCapturePercent: 0,
} as unknown as GameModifiers;

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const CIRCUIT_MAPS = LEVELS.filter(l => l.circuit);

afterEach(() => setRunSeedText(null));

describe("circuit sleepers and the random decorations", () => {
  it("has circuit maps to check", () => {
    expect(CIRCUIT_MAPS.length).toBeGreaterThan(0);
  });

  it("never buries a sleeper, across a wide sweep of seeds", () => {
    // Forty seeds per map rather than four random inits: enough that the bug
    // this was written for shows up every time the fix is removed, instead of
    // one run in three.
    const buried: string[] = [];
    for (const level of CIRCUIT_MAPS) {
      for (let seed = 0; seed < 40; seed++) {
        setRunSeedText(`sleeper-sweep-${seed}`);
        const data = createInitialGameData(level, level.level ?? 1, MODS);
        for (const b of data.balls.filter(x => x.state === "dormant")) {
          if (!isPositionActive(data.spaceGrid!, b.position)) {
            buried.push(`${level.id} seed ${seed} at (${b.position.x | 0},${b.position.y | 0})`);
          }
        }
      }
    }
    expect(buried.slice(0, 5), `${buried.length} buried sleepers`).toEqual([]);
  });

  it("still spawns one sleeper per terminal, dormant and stopped", () => {
    // The avoidance must not have been bought by dropping a sleeper: a map that
    // spawns nothing also buries nothing.
    for (const level of CIRCUIT_MAPS) {
      setRunSeedText(`sleeper-count-${level.id}`);
      const data = createInitialGameData(level, level.level ?? 1, MODS);
      const dormant = data.balls.filter(b => b.state === "dormant");
      expect(dormant.length, `${level.id} sleeper count`).toBe(level.circuit!.terminals.length);
      for (const b of dormant) expect(b.speed, `${level.id} sleeper speed`).toBe(0);
    }
  });
});

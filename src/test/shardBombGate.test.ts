/**
 * Shard bombs wait for their map (lib/bombCore.ts `effectiveShardBombChance`).
 *
 * They used to roll on every brick on every map, so the maps that teach bricks
 * (5 and 6 first) dealt explosions nobody had introduced: a blast that reopens
 * claimed ground on the map whose whole job is "a ball breaks this". Now the
 * roll starts at game-config.yml's `start_level` (17, the Demolition map), a
 * map can say otherwise with `shardBombChance`, and the Playground's bonus can
 * still force one onto any map.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  DEFAULT_SHARD_BOMB_CONFIG, effectiveShardBombChance, mapCanHaveShardBombs,
} from "@/lib/bombCore";
import { createBotGame, plainModifiers } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { sfxGate } from "@/lib/sfxGate";
import { LADDER } from "./fixtures/maps";

const CFG = DEFAULT_SHARD_BOMB_CONFIG;
const level = (n: number) => {
  const l = LADDER.find(x => x.level === n);
  if (!l) throw new Error(`no level ${n}`);
  return l;
};
const shards = (n: number, over: Parameters<typeof createBotGame>[3] = {}, bonus = 0) => {
  setRunSeedText(`shard-bomb-gate-${n}`);
  const ctx = createBotGame(level(n), n, plainModifiers({ shardBombChanceBonus: bonus }), over);
  return ctx.game.destructibles.filter(d => d.kind === "breakable" && d.brittle && !d.fenceStyle);
};

afterEach(() => setRunSeedText(null));

describe("the chance a map's shards carry a bomb", () => {
  it("is none before the start level and the global chance from it on", () => {
    expect(effectiveShardBombChance(CFG, CFG.startLevel - 1, undefined)).toBe(0);
    expect(effectiveShardBombChance(CFG, CFG.startLevel, undefined)).toBe(CFG.chance);
    expect(effectiveShardBombChance(CFG, CFG.startLevel + 5, undefined)).toBe(CFG.chance);
  });

  it("lets a map override it both ways", () => {
    expect(effectiveShardBombChance(CFG, 5, 0.3)).toBe(0.3);
    expect(effectiveShardBombChance(CFG, 30, 0)).toBe(0);
  });

  it("lets the Playground force it anywhere, clamped to every shard", () => {
    expect(effectiveShardBombChance(CFG, 5, undefined, 1)).toBe(1);
    expect(effectiveShardBombChance(CFG, 30, 0, 0.5)).toBe(0.5);
    expect(effectiveShardBombChance(CFG, 30, undefined, 5)).toBe(1);
  });

  it("starts where game-config.yml says, and the code's default agrees", () => {
    // The ledger reads the default (mechanicSpread has no YAML at hand), so a
    // start level moved in one place and not the other would put the ledger
    // and the game on different maps.
    const doc = yaml.load(readFileSync("public/game-config.yml", "utf8")) as { shard_bombs: { chance: number; start_level: number } };
    expect(doc.shard_bombs.start_level).toBe(CFG.startLevel);
    expect(doc.shard_bombs.chance).toBe(CFG.chance);
  });
});

describe("the ladder", () => {
  it("keeps every brick map before 17 free of bombs, and gives 17 them", () => {
    const withShards = LADDER.filter(l => (l.entities ?? []).some(e => e.kind === "wall" && "brittle" in e && e.brittle));
    expect(withShards.map(l => l.level)).toEqual(expect.arrayContaining([5, 6, 17]));
    const bombed = withShards.filter(l => mapCanHaveShardBombs(l)).map(l => l.level);
    expect(bombed).toEqual([17]);
  });
});

describe("a dealt board", () => {
  it("deals level 5 and 6 plain bricks", () => {
    for (const n of [5, 6]) {
      const s = shards(n, { bombs: CFG });
      expect(s.length).toBeGreaterThan(0);
      expect(s.filter(d => d.shardBomb), `level ${n}`).toEqual([]);
    }
  });

  it("deals level 17 some bombs, seeded", () => {
    const a = shards(17, { bombs: CFG }).filter(d => d.shardBomb).map(d => d.id);
    const b = shards(17, { bombs: CFG }).filter(d => d.shardBomb).map(d => d.id);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("still forces them onto a teaching map from the Playground", () => {
    const s = shards(6, { bombs: CFG }, 1);
    // A shard holding a bug is skipped, and level 6 rolls none (bugs are off here).
    expect(s.every(d => d.shardBomb)).toBe(true);
  });

  it("arms nothing when the harness is not asked to", () => {
    expect(shards(17).some(d => d.shardBomb)).toBe(false);
    setRunSeedText("x");
    const ctx = createBotGame(level(17), 17);
    expect(ctx.game.shardBombBlast).toBeNull();
    expect(ctx.game.boxBombBlast).toBeNull();
  });
});

describe("a bomb chain's sound", () => {
  it("plays at most once per gap", () => {
    let t = 0;
    const gate = sfxGate(110, () => t);
    const played: number[] = [];
    // Six bombs a frame apart, then one well after.
    for (const at of [0, 16, 33, 50, 66, 120, 400]) { t = at; if (gate()) played.push(at); }
    expect(played).toEqual([0, 120, 400]);
  });
});

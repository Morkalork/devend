/**
 * When shards carry bombs (lib/bombCore.ts `effectiveShardBombChance`), and
 * Chaos Engineering, the upgrade line that raises it.
 *
 * They once rolled on every brick on every map, then waited for 17 (the
 * Demolition map) so the brick could be taught plain first. The owner moved
 * them back to 5, the first brick map, as a randomizer worth having early:
 * the roll starts at game-config.yml's `start_level`, a map can say otherwise
 * with `shardBombChance`, Chaos Engineering adds to the chance, its Game Day
 * fork puts a floor under the count, and the Playground can force either.
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
  it("lets every brick map from 5 on roll bombs, the first one included", () => {
    expect(CFG.startLevel).toBe(5);
    const withShards = LADDER.filter(l => (l.entities ?? []).some(e => e.kind === "wall" && "brittle" in e && e.brittle));
    expect(withShards.map(l => l.level)).toEqual(expect.arrayContaining([5, 6, 17]));
    const bombed = withShards.filter(l => mapCanHaveShardBombs(l)).map(l => l.level);
    expect(bombed).toEqual(withShards.map(l => l.level));
  });
});

describe("a dealt board", () => {
  it("rolls level 5's bricks at the base chance", () => {
    expect(effectiveShardBombChance(CFG, 5, level(5).shardBombChance)).toBe(CFG.chance);
    expect(effectiveShardBombChance(CFG, 4, undefined)).toBe(0);
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

describe("Game Day: a floor under the count", () => {
  const plain = (n: number) => shards(n, { bombs: { ...CFG, chance: 0 } });
  const floored = (n: number, floor: number, chance = 0) => {
    setRunSeedText(`shard-bomb-floor-${n}`);
    const ctx = createBotGame(level(n), n, plainModifiers({ shardBombsPerMap: floor }), { bombs: { ...CFG, chance } });
    return ctx.game.destructibles.filter(d => d.kind === "breakable" && d.brittle && !d.fenceStyle);
  };

  it("arms at least that many shards on a map that rolled none", () => {
    expect(plain(5).filter(d => d.shardBomb)).toEqual([]);
    const s = floored(5, 2);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.filter(d => d.shardBomb)).toHaveLength(2);
  });

  it("never takes away what the roll gave: a floor, not a count", () => {
    const rolled = floored(17, 0, 1).filter(d => d.shardBomb).length;
    expect(rolled).toBeGreaterThan(2);
    expect(floored(17, 2, 1).filter(d => d.shardBomb).length).toBe(rolled);
  });

  it("is seeded, so a Daily and both phones of a pair arm the same shards", () => {
    const a = floored(6, 2).filter(d => d.shardBomb).map(d => d.id);
    const b = floored(6, 2).filter(d => d.shardBomb).map(d => d.id);
    expect(a).toHaveLength(2);
    expect(b).toEqual(a);
  });

  it("stops at the shards there are", () => {
    const s = floored(5, 999);
    expect(s.filter(d => d.shardBomb).length).toBe(s.filter(d => !d.bug).length);
  });
});

describe("Chaos Engineering", () => {
  type Up = { id: string; tier: string; choiceGroup?: string; prerequisites?: string[]; modifiers: Record<string, number>; unlockLevel?: number };
  const doc = yaml.load(readFileSync("public/upgrades.yml", "utf8")) as { upgrades: Up[] };
  const line = doc.upgrades.filter(u => u.id.startsWith("chaos_engineering_"));
  const by = (id: string) => line.find(u => u.id === id)!;

  it("is a Junior, a Senior and a Principal fork", () => {
    expect(line.map(u => u.id).sort()).toEqual([
      "chaos_engineering_junior", "chaos_engineering_principal_a", "chaos_engineering_principal_b", "chaos_engineering_senior",
    ]);
    expect(by("chaos_engineering_principal_a").choiceGroup).toBe("chaos_engineering_principal");
    expect(by("chaos_engineering_principal_b").choiceGroup).toBe("chaos_engineering_principal");
    // On the shelf before the first brick map, so it can be bought for it.
    expect(by("chaos_engineering_junior").unlockLevel).toBeLessThan(CFG.startLevel);
  });

  it("raises the chance tier by tier, and the forks pay as described", () => {
    const sum = (ids: string[], key: string) => ids.reduce((t, id) => t + (by(id).modifiers[key] ?? 0), 0);
    const base = ["chaos_engineering_junior", "chaos_engineering_senior"];
    expect(sum(["chaos_engineering_junior"], "shardBombChanceBonus")).toBeCloseTo(0.1);
    expect(sum(base, "shardBombChanceBonus")).toBeCloseTo(0.2);
    // Fault Injection: 40% in all. Game Day: the 20%, and a floor of 2.
    expect(sum([...base, "chaos_engineering_principal_a"], "shardBombChanceBonus")).toBeCloseTo(0.4);
    expect(sum([...base, "chaos_engineering_principal_b"], "shardBombChanceBonus")).toBeCloseTo(0.2);
    expect(by("chaos_engineering_principal_b").modifiers.shardBombsPerMap).toBe(2);
  });

  it("is in every language", () => {
    for (const lang of ["es", "sv", "bn"]) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, "utf8")) as { content: { upgrades: Record<string, { name: string; description: string }> } };
      for (const u of line) {
        expect(loc.content.upgrades[u.id]?.description, `${lang} ${u.id}`).toBeTruthy();
        expect(loc.content.upgrades[u.id].description).not.toContain("\u2014");
      }
    }
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

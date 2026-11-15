/**
 * The upgrade sweep: does each upgrade change how a map plays?
 *
 * Opt-in (UPGRADE_SWEEP=1), never part of the normal suite: a full sweep is
 * hours of simulated play. For every upgrade on its own, the bot plays a set
 * of maps on fixed seeds with and without it, and the two runs on one seed are
 * compared pair by pair, so the map's own luck cancels out.
 *
 *   UPGRADE_SWEEP=1                 run it
 *   UPGRADE_SWEEP_OUT=<dir>         where each shard writes its JSON (required)
 *   UPGRADE_SWEEP_SHARD=i/n         this process takes upgrades i, i+n, ... (default 0/1)
 *   UPGRADE_SWEEP_SEEDS=<n>         seeds per map (default 16)
 *   UPGRADE_SWEEP_LEVELS=3,6,9      maps to play (default: the sample below)
 *   UPGRADE_SWEEP_ONLY=id,id        only these upgrades (plus the baseline)
 *   UPGRADE_SWEEP_STACK=1           own each card WITH its prerequisites (transitively)
 *   UPGRADE_SWEEP_CATALOG=cards     sweep the draft catalogue (public/cards.yml)
 *
 * Stack mode is how a rung is read fairly. Alone, Feature Freeze Senior is +1s
 * on a freeze the build does not have, and reads as nothing; on top of Junior
 * it is what buying it adds. Compare a card's stack with the stack of its
 * prerequisites, which is always some other card's stack (or the baseline).
 *
 * The "(placebo ...)" builds are the noise floor. The simulation is chaotic:
 * ANY change, even balls 0.1% slower, reshuffles every seed's outcome, and one
 * such placebo moved the mean clear time by 16%. So a card's paired difference
 * means something only when it is larger than every placebo's.
 *
 * Every run plays real lives (3, plus the build's extra lives), with bugs and
 * power-up tokens on, freezes tapped when the build has any (policy.ts
 * planFreeze), as many fences at once as the build allows, and a fence-type
 * card's type drawn for every fence.
 *
 * What the bot still cannot measure, it reports as unchanged: it never holds
 * an object (Control Freak), never pushes its luck, never shops, and plays
 * one map at a time with no purse. An upgrade whose every run is
 * bit-identical to the baseline is therefore "invisible to the bot", which is
 * a finding about the bot as much as the card, and the report keeps the two
 * apart by that flag.
 */
import { describe, it, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { runBot, type BotRunResult } from "@/lib/bot/runBot";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import { mapContextOf, type RunContext } from "@/lib/upgradeConditions";
import { loadScoringConfig } from "@/lib/scoring";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import type { UpgradeConfig } from "@/types/upgrade";
import { DEFAULT_BUG_CONFIG } from "@/types/bugs";
import { DEFAULT_PICKUP_CONFIG } from "@/types/pickups";
import type { LevelConfig } from "@/types/level";
import { LADDER, byLevel } from "./fixtures/maps";

const ENABLED = process.env.UPGRADE_SWEEP === "1";
const STACK = process.env.UPGRADE_SWEEP_STACK === "1";

/** A card and everything it requires, transitively, prerequisites first. */
function stackOf(id: string, lookup: Map<string, UpgradeConfig>): string[] {
  const out: string[] = [];
  const visit = (at: string) => {
    for (const p of lookup.get(at)?.prerequisites ?? []) {
      if (lookup.has(p) && !out.includes(p)) {
        visit(p);
        out.push(p);
      }
    }
  };
  visit(id);
  return [...out, id];
}

/** Early, mid and late maps, bosses included, so a card is seen across the run. */
const DEFAULT_LEVELS = [2, 4, 6, 8, 10, 12, 15, 18, 20, 23, 26, 29, 32, 36, 40];

/** A purse a mid-run player plausibly holds, so bank-gated cards switch on. */
const SWEEP_BANKED = 60;
/** Lives at the start of a map: the bot computes modifiers once, at the start. */
const SWEEP_LIVES = 3;

/** Builds that change nothing a player could feel: balls a hair slower or faster. */
const PLACEBOS: Record<string, number> = {
  "(placebo -0.1%)": 0.999, "(placebo +0.1%)": 1.001,
  "(placebo -0.05%)": 0.9995, "(placebo +0.05%)": 1.0005,
  "(placebo -0.2%)": 0.998, "(placebo +0.2%)": 1.002,
};

interface RunRow {
  level: number;
  seed: number;
  won: boolean;
  seconds: number;
  livesLost: number;
  score: number;
  remaining: number;
}

function row(r: BotRunResult): RunRow {
  return {
    level: r.levelNumber, seed: r.seed, won: r.won,
    seconds: +(r.frames * PHYSICS_STEP).toFixed(2), livesLost: r.livesLost,
    score: r.levelScore, remaining: +r.remainingPercent.toFixed(2),
  };
}

function parseShard(text: string | undefined): { index: number; count: number } {
  if (!text) {
    return { index: 0, count: 1 };
  }
  const [i, n] = text.split("/").map(Number);
  return { index: i, count: n };
}

describe.skipIf(!ENABLED)("upgrade sweep", () => {
  it("plays every upgrade against the baseline", async () => {
    const outDir = process.env.UPGRADE_SWEEP_OUT;
    if (!outDir) {
      throw new Error("UPGRADE_SWEEP_OUT is required");
    }
    mkdirSync(outDir, { recursive: true });

    // The map payout reads the scoring config, which the browser fetches.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const file = resolve(__dirname, "../../public", url.replace(/^\//, ""));
      return new Response(readFileSync(file, "utf8"));
    }) as typeof fetch;
    try {
      await loadScoringConfig();
    } finally {
      globalThis.fetch = realFetch;
    }

    const catalogue = process.env.UPGRADE_SWEEP_CATALOG === "cards" ? "cards.yml" : "upgrades.yml";
    const upgrades = (yaml.load(
      readFileSync(resolve(__dirname, "../../public", catalogue), "utf8"),
    ) as { upgrades: UpgradeConfig[] }).upgrades;
    // A draft card's "+" requires its card, as the loader holds it.
    for (const u of upgrades) {
      if (u.upgradeOf && !(u.prerequisites ?? []).includes(u.upgradeOf)) {
        u.prerequisites = [...(u.prerequisites ?? []), u.upgradeOf];
      }
    }
    const lookup = new Map(upgrades.map(u => [u.id, u]));

    const seedCount = Number(process.env.UPGRADE_SWEEP_SEEDS ?? 16);
    const seeds = Array.from({ length: seedCount }, (_, i) => 101 + i);
    const levelNumbers = process.env.UPGRADE_SWEEP_LEVELS
      ? process.env.UPGRADE_SWEEP_LEVELS.split(",").map(Number)
      : DEFAULT_LEVELS;
    const levels = levelNumbers
      .map(n => ({ n, level: byLevel(LADDER, n) }))
      .filter((x): x is { n: number; level: LevelConfig } => x.level !== undefined);

    const only = process.env.UPGRADE_SWEEP_ONLY?.split(",");
    const shard = parseShard(process.env.UPGRADE_SWEEP_SHARD);
    const ids = ["(baseline)", ...Object.keys(PLACEBOS), ...upgrades.map(u => u.id)]
      .filter(id => !only || id.startsWith("(") || only.includes(id));
    const mine = ids.filter((_, i) => i % shard.count === shard.index);

    // A won map schedules its results screen on a timer, and that timer holds
    // the whole game. Nothing here yields to the event loop, so real timers
    // never fire and every board ever played stayed in memory until the
    // process ran out (the first full sweep died that way). Fake timers, cleared
    // after each run, drop them instead.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

    const outFile = resolve(outDir, `shard-${shard.index}-of-${shard.count}.json`);
    const save = () => writeFileSync(outFile, JSON.stringify({
      seeds, levels: levels.map(l => l.n), banked: SWEEP_BANKED, lives: SWEEP_LIVES, stacked: STACK, results,
    }));
    const results: Record<string, RunRow[]> = {};
    const started = Date.now();
    for (const id of mine) {
      const rows: RunRow[] = [];
      for (const { n, level } of levels) {
        const context: RunContext = {
          level: n, lives: SWEEP_LIVES, banked: SWEEP_BANKED, map: mapContextOf(level),
        };
        const owned = id.startsWith("(") ? [] : (STACK ? stackOf(id, lookup) : [id]);
        const modifiers = computeGameModifiers(owned, lookup, undefined, context);
        const placebo = PLACEBOS[id];
        if (placebo !== undefined) {
          modifiers.ballSpeedMultiplier *= placebo;
        }
        // The map's own clock, plus a little, so a slow clear still counts.
        const maxFrames = Math.ceil(((level.timeLimit ?? 90) + 5) / PHYSICS_STEP);
        const card = lookup.get(id);
        const runOpts = {
          modifiers, maxFrames,
          lives: SWEEP_LIVES + Math.max(0, Math.round(modifiers.extraLives ?? 0)),
          bugs: DEFAULT_BUG_CONFIG,
          pickups: DEFAULT_PICKUP_CONFIG,
          useFreezes: true,
          fenceTypeId: card?.grantsFenceType
            ?? owned.map(o => lookup.get(o)?.grantsFenceType).find(t => t !== undefined),
        };
        for (const seed of seeds) {
          rows.push(row(runBot(level, n, seed, runOpts)));
          vi.clearAllTimers();
        }
      }
      results[id] = rows;
      // After every upgrade, so a crash part-way keeps what was measured.
      save();
      console.log(`[sweep ${shard.index}/${shard.count}] ${id} done, ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }

    vi.useRealTimers();
  }, 24 * 60 * 60 * 1000);
});

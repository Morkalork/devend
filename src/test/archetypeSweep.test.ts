/**
 * The bot players against a ladder: how far each strategy gets (BOT_PLAYERS.md).
 *
 * Opt-in (ARCHETYPE_SWEEP=1), never part of the normal suite. Every archetype
 * plays the same seeds, so a difference between two of them is the strategy
 * and not the luck of the deal.
 *
 *   ARCHETYPE_SWEEP=1             run it
 *   ARCHETYPE_OUT=<dir>           where results.json and report.md go (required)
 *   ARCHETYPE_SEEDS=<n>           runs per archetype (default 20)
 *   ARCHETYPE_LADDER=ladder       public/map.yml (default), or `archive` for
 *                                 the 45 old maps as a long stand-in ladder
 *   ARCHETYPE_MAPS=<n>            stop each run after n maps
 *   ARCHETYPE_ONLY=fleet,fencer   only these players
 *   ARCHETYPE_ENDLESS=1           practice: three tries a map, a lost map
 *                                 skipped, lives never end the run, so every
 *                                 build grows over the whole ladder
 *   ARCHETYPE_PAR=<n>             add n to every map's par, to read what a
 *                                 tidier player than the bot would be paid
 */
import { describe, it, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeData } from "@/types/upgrade";
import { ARCHETYPES } from "@/lib/bot/archetypes";
import { runCampaign, type CampaignCatalogue, type CampaignResult } from "@/lib/bot/runCampaign";
import { mergePricing } from "@/lib/upgradePricing";
import { parseTreeConfig } from "@/lib/tree";
import { loadScoringConfig } from "@/lib/scoring";
import { ARCHIVE, LADDER } from "./fixtures/maps";
import { checkMaps, CASUAL_BAND, BOSS_BAND, BUILD_GAP, ONE_CAUSE_MAX } from "@/lib/bot/mapChecklist";

const ENABLED = process.env.ARCHETYPE_SWEEP === "1";

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(1, of))}%`;

/** The purchases most runs of one archetype made, most common first. */
function typicalBuild(runs: CampaignResult[], top = 6): string {
  const counts = new Map<string, number>();
  for (const r of runs) {
    for (const what of new Set(r.purchases.map(p => p.what.replace(/ \(start\)$/, "")))) {
      counts.set(what, (counts.get(what) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([what, n]) => `${what} (${pct(n, runs.length)})`)
    .join(", ");
}

/** Where runs ended, as "map: count". */
function endings(runs: CampaignResult[]): string {
  const at = new Map<string, number>();
  for (const r of runs.filter(x => !x.finished)) {
    const key = `map ${r.endedOn} ${r.endedBy ?? ""}`.trim();
    at.set(key, (at.get(key) ?? 0) + 1);
  }
  return [...at.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ") || "none";
}

describe.skipIf(!ENABLED)("archetype sweep", () => {
  it("plays every archetype across the seeds", async () => {
    const outDir = process.env.ARCHETYPE_OUT;
    if (!outDir) {
      throw new Error("ARCHETYPE_OUT is required");
    }
    mkdirSync(outDir, { recursive: true });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const file = resolve(__dirname, "../../public", String(input).replace(/^\//, ""));
      return new Response(readFileSync(file, "utf8"));
    }) as typeof fetch;
    try {
      await loadScoringConfig();
    } finally {
      globalThis.fetch = realFetch;
    }

    const raw = yaml.load(readFileSync(resolve(__dirname, "../../public/tree.yml"), "utf8")) as UpgradeData & { tree?: unknown };
    const catalogue: CampaignCatalogue = {
      nodes: raw.upgrades, tree: parseTreeConfig(raw.tree), pricing: mergePricing(raw.pricing),
    };
    const ladderName = process.env.ARCHETYPE_LADDER === "archive" ? "archive" : "ladder";
    const ladder = ladderName === "archive" ? ARCHIVE : LADDER;
    const endless = process.env.ARCHETYPE_ENDLESS === "1";
    const parBonus = Number(process.env.ARCHETYPE_PAR ?? 0);
    const maxMaps = process.env.ARCHETYPE_MAPS ? Number(process.env.ARCHETYPE_MAPS) : undefined;
    const seeds = Array.from({ length: Number(process.env.ARCHETYPE_SEEDS ?? 20) }, (_, i) => 1 + i);
    const only = process.env.ARCHETYPE_ONLY?.split(",");
    const players = ARCHETYPES.filter(a => !only || only.includes(a.id));

    // See upgradeSweep.test.ts: a won map's results timer holds the board.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const results: Record<string, CampaignResult[]> = {};
    const started = Date.now();
    for (const a of players) {
      results[a.id] = [];
      for (const seed of seeds) {
        results[a.id].push(runCampaign(a, ladder, catalogue, seed, {
          maxMaps, endless, extraModifiers: parBonus > 0 ? { parBonus } : undefined,
        }));
        vi.clearAllTimers();
      }
      console.log(`[archetypes] ${a.id} done, ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    vi.useRealTimers();

    const maps = Math.min(ladder.length, maxMaps ?? ladder.length);
    writeFileSync(resolve(outDir, "results.json"), JSON.stringify({ ladder: ladderName, maps, endless, parBonus, seeds, results }, null, 1));

    const rows = players.map(a => {
      const runs = results[a.id];
      const attempts = runs.flatMap(r => r.attempts);
      const balls = mean(runs.map(r => r.roster.length)).toFixed(1);
      const rungs = mean(runs.map(r => r.roster.reduce((n, b) => n + Object.values(b.rungs).reduce((m, k) => m + (k ?? 0), 0), 0))).toFixed(1);
      const nodes = mean(runs.map(r => r.owned.length)).toFixed(1);
      return [
        a.name,
        endless ? `${mean(runs.map(r => r.mapsCleared)).toFixed(1)} of ${maps}` : pct(runs.filter(r => r.finished).length, runs.length),
        endless ? mean(runs.map(r => r.livesSpent)).toFixed(1) : mean(runs.map(r => r.mapsCleared)).toFixed(1),
        mean(runs.map(r => r.hoursEarned)).toFixed(0),
        pct(attempts.filter(x => x.won).length, attempts.length),
        mean(attempts.filter(x => x.won).map(x => x.seconds)).toFixed(1),
        `${balls} / ${rungs} / ${nodes}`,
      ];
    });
    // Per map: the share of runs that won it, per player. Where one strategy
    // clears a map the others cannot, this is where it shows.
    const perMap = Array.from({ length: maps }, (_, i) => i + 1).map(n => [
      `${n}`,
      ...players.map(a => pct(results[a.id].filter(r => r.attempts.some(x => x.level === n && x.won)).length, results[a.id].length)),
    ]);
    const checks = checkMaps(results, maps, ladder.slice(0, maps).flatMap((l, i) => (l.boss ? [i + 1] : [])));
    const lines = [
      `# Bot players on the ${ladderName} (${maps} maps, ${seeds.length} runs each${endless ? ", practice" : ""})`,
      "",
      endless
        ? "| Player | Maps won | Lives spent | Hours earned | Attempts won | Seconds per win | Balls / rungs / nodes at the end |"
        : "| Player | Finished | Maps cleared | Hours earned | Attempts won | Seconds per win | Balls / rungs / nodes at the end |",
      "|---|---|---|---|---|---|---|",
      ...rows.map(r => `| ${r.join(" | ")} |`),
      "",
      "## Maps won, per map",
      "",
      `| Map | ${players.map(a => a.name).join(" | ")} |`,
      `|---|${players.map(() => "---").join("|")}|`,
      ...perMap.map(r => `| ${r.join(" | ")} |`),
      "",
      "## Checklist (MAP_DESIGN_CARD.md section 7)",
      "",
      `Casual in ${CASUAL_BAND[0] * 100}-${CASUAL_BAND[1] * 100}% of attempts (a boss ${BOSS_BAND[0] * 100}-${BOSS_BAND[1] * 100}%); some player ${BUILD_GAP * 100} points over Casual; no loss cause over ${ONE_CAUSE_MAX * 100}%; pay follows difficulty.${parBonus > 0 ? ` Pay read with par +${parBonus}.` : " Pay is the bot's own, usually well over par."}`,
      "",
      "| Map | Casual | Best | Top loss | Pay | Misses |",
      "|---|---|---|---|---|---|",
      ...checks.map(c => `| ${c.level} | ${Math.round(c.casual * 100)}% | ${c.best.id} ${Math.round(c.best.share * 100)}% | ${c.topLoss ? `${c.topLoss.kind} ${Math.round(c.topLoss.share * 100)}%` : "-"} | ${c.pay}h | ${c.flags.join("; ") || "meets all"} |`),
      "",
      "## Builds and endings",
      "",
      ...players.flatMap(a => [
        `**${a.name}** (${a.id}): ${a.plan}`,
        "",
        `- Typical buys: ${typicalBuild(results[a.id])}`,
        `- Runs ended: ${endings(results[a.id])}`,
        "",
      ]),
    ];
    writeFileSync(resolve(outDir, "report.md"), lines.join("\n"));
    console.log(lines.join("\n"));
  }, 24 * 60 * 60 * 1000);
});

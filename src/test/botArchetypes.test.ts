/**
 * The bot players (lib/bot/archetypes.ts, lib/bot/runCampaign.ts; BOT_PLAYERS.md).
 *
 * Two halves. The shop: each player buys what it says it buys, from a known
 * purse, with no physics involved, so a change to a table or to the tree
 * shows here as a plain diff of choices. The run: each player plays the
 * ladder once and the result is a run that can be read (maps, lives, hours,
 * purchases), whatever the outcome; the opt-in sweep (archetypeSweep.test.ts)
 * is where outcomes are compared.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import { ARCHETYPES, archetypeById, pickTrait } from "@/lib/bot/archetypes";
import { runCampaign, shopVisit, type CampaignCatalogue } from "@/lib/bot/runCampaign";
import { seededRandom } from "@/lib/bot/policy";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import { mergePricing } from "@/lib/upgradePricing";
import { parseTreeConfig } from "@/lib/tree";
import { RUNG_IDS, type Roster } from "@/lib/roster";
import { loadScoringConfig } from "@/lib/scoring";
import { getAllFenceTypes } from "@/lib/fences";
import { LADDER } from "./fixtures/maps";

const raw = yaml.load(readFileSync(resolve(__dirname, "../../public/tree.yml"), "utf8")) as UpgradeData & { tree?: unknown };
const catalogue: CampaignCatalogue = {
  nodes: raw.upgrades,
  tree: parseTreeConfig(raw.tree),
  pricing: mergePricing(raw.pricing),
};
const lookup = new Map<string, UpgradeConfig>(catalogue.nodes.map(n => [n.id, n]));
const modifiersFor = (owned: ReadonlySet<string>) => computeGameModifiers([...owned], lookup);

const shop = (id: string, hours: number, roster: Roster = [{ slot: 1, rungs: { weight: 1 } }], owned: string[] = []) =>
  shopVisit(archetypeById(id)!, { hours, roster, owned: new Set(owned) }, catalogue, 1, seededRandom(1), modifiersFor);

describe("the six players", () => {
  it("are six, each with a plan in words", () => {
    expect(ARCHETYPES.map(a => a.id)).toEqual(["fleet", "superball", "fencer", "earner", "guardian", "casual"]);
    for (const a of ARCHETYPES) {
      expect(a.plan.length, a.id).toBeGreaterThan(40);
    }
  });

  it("name only rungs, fence types and tree nodes that exist", () => {
    const fenceIds = new Set(getAllFenceTypes().map(f => f.id));
    for (const a of ARCHETYPES) {
      for (const t of a.traits) {
        expect(RUNG_IDS, `${a.id} trait ${t}`).toContain(t);
      }
      for (const f of a.fences) {
        expect(fenceIds.has(f), `${a.id} fence ${f}`).toBe(true);
      }
    }
    // Every node any player would ever want, found by asking each about every node.
    const view = { hours: 0, roster: [], owned: new Set<string>(), mapsCleared: 1, nodes: lookup, rng: () => 0.5 };
    const named = (src: string) => [...src.matchAll(/\b([a-z]+(?:_[a-z0-9]+)+): \d+/g)].map(m => m[1]);
    const source = readFileSync(resolve(__dirname, "../lib/bot/archetypes.ts"), "utf8");
    for (const id of named(source)) {
      expect(lookup.has(id), `archetypes.ts names ${id}, which tree.yml does not have`).toBe(true);
    }
    // And each player but the casual one wants something from the tree.
    for (const a of ARCHETYPES.filter(x => x.id !== "casual")) {
      const wantsNode = catalogue.nodes.some(n => a.score({ kind: "node", id: n.id, price: 10 }, view) > 0);
      const wantsRung = RUNG_IDS.some(r => a.score({ kind: "rung", slot: 1, rung: r, rank: 2, price: 10 }, view) > 0);
      expect(wantsNode || wantsRung, a.id).toBe(true);
    }
  });

  it("take their trait from the run-start offer", () => {
    expect(pickTrait(archetypeById("guardian")!, ["weight", "grace", "sight"])).toBe("grace");
    expect(pickTrait(archetypeById("earner")!, ["weight", "worth", "sight"])).toBe("worth");
    expect(pickTrait(archetypeById("superball")!, ["weight", "frost", "sight"])).toBe("weight");
  });
});

describe("at the tree stage", () => {
  it("Fleet buys a ball first, and saves for it when short", () => {
    expect(shop("fleet", 30).bought.map(b => b.label)).toEqual(["ball"]);
    expect(shop("fleet", 20).bought).toEqual([]);
    // With a full roster it spreads: the ball with no rungs comes first.
    const full: Roster = [{ slot: 1, rungs: { weight: 1 } }, { slot: 2, rungs: {} }, { slot: 3, rungs: {} }];
    const v = shop("fleet", 15, full);
    expect(v.bought).toHaveLength(1);
    expect(v.bought[0].label).toMatch(/^ball [23]: weight 1$/);
  });

  it("Super Ball never buys a ball and stacks the first one", () => {
    const v = shop("superball", 200);
    expect(v.bought.some(b => b.offer.kind === "ball")).toBe(false);
    expect(v.bought.every(b => b.offer.kind === "rung" && b.offer.slot === 1)).toBe(true);
    expect(v.roster[0].rungs.weight).toBe(3);
  });

  it("Fence Engineer opens the fences branch and walks it", () => {
    const v = shop("fencer", 60);
    expect(v.bought[0].label).toBe("fast_compile");
    expect(v.bought.map(b => b.label)).toContain("multithreading");
    expect(v.bought.every(b => lookup.get(b.label)?.branch === "fences")).toBe(true);
  });

  it("Overtime Earner buys pay first, and mixes once the pay is in", () => {
    expect(shop("earner", 20).bought.map(b => b.label)).toEqual(["performance_bonus"]);
    const rich = shop("earner", 400);
    const labels = rich.bought.map(b => b.label);
    expect(labels.slice(0, 2)).toEqual(["performance_bonus", "performance_bonus_plus"]);
    expect(labels).toContain("compound_interest");
    expect(labels).toContain("expense_account");
    // The mix: something from outside the office branch.
    expect(rich.bought.some(b => b.offer.kind !== "node" || lookup.get(b.offer.id)?.branch !== "office")).toBe(true);
  });

  it("Safe Hands goes for freezes, shields and lives, walking the office path to them", () => {
    const v = shop("guardian", 120);
    const labels = v.bought.map(b => b.label);
    expect(labels[0]).toBe("feature_freeze");
    // Defensive Programming hangs off Performance Bonus, so that is bought on the way.
    expect(labels).toContain("performance_bonus");
    expect(labels).toContain("defensive_programming");
  });

  it("Casual buys something whenever it can", () => {
    expect(shop("casual", 30).bought.length).toBeGreaterThan(0);
    expect(shop("casual", 0).bought).toEqual([]);
  });

  it("never spends hours it does not have", () => {
    for (const a of ARCHETYPES) {
      for (const hours of [0, 14, 31, 77, 250]) {
        const v = shop(a.id, hours);
        expect(v.hours, `${a.id} at ${hours}h`).toBeGreaterThanOrEqual(0);
        expect(hours - v.hours).toBe(v.bought.reduce((s, b) => s + b.offer.price, 0));
      }
    }
  });
});

describe("a run on the ladder", () => {
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const file = resolve(__dirname, "../../public", String(input).replace(/^\//, ""));
      return new Response(readFileSync(file, "utf8"));
    }) as typeof fetch;
    try {
      await loadScoringConfig();
    } finally {
      globalThis.fetch = realFetch;
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it.each(ARCHETYPES.map(a => [a.id]))("%s plays it start to end and reports the run", (id) => {
    const result = runCampaign(archetypeById(id)!, LADDER, catalogue, 1);
    vi.clearAllTimers();
    expect(result.archetype).toBe(id);
    expect(result.purchases[0].afterMap).toBe(0);
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.mapsCleared).toBeLessThanOrEqual(LADDER.length);
    expect(result.finished || result.livesLeft === 0).toBe(true);
    expect(result.hoursEarned).toBe(result.attempts.reduce((s, a) => s + a.pay, 0));
    expect(result.hoursSpent).toBe(result.purchases.reduce((s, p) => s + p.price, 0));
    // Lives: three, plus what the build granted, less what the attempts cost.
    const granted = Math.round(computeGameModifiers(result.owned, lookup).extraLives ?? 0);
    const cost = result.attempts.reduce((s, a) => s + a.livesLost, 0);
    expect(result.livesLeft).toBe(Math.max(0, 3 + granted - cost));
  }, 120000);
});

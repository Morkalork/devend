/**
 * The upgrade catalogue as a graph (admin Upgrade Atlas).
 *
 * Two jobs, tested separately.
 *
 * LAYOUT has to be trustworthy before it is pretty: a drawing that overlaps two
 * nodes, or points an arrow leftwards, quietly tells you the catalogue is
 * shaped differently than it is. Those are the properties asserted here, rather
 * than exact pixel positions, so the layout can be re-tuned without rewriting
 * the tests.
 *
 * FINDINGS are the reason the screen exists. useUpgradeManager already throws
 * on the hard errors (unknown prerequisite id, duplicate id, cycle), so
 * everything checked here is legal YAML that loads fine and is probably still a
 * mistake. Each detector is tested against a synthetic catalogue so the test
 * does not move every time the real content does, and the shipped catalogue is
 * then checked only against invariants that must hold whatever it contains.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeTier } from "@/types/upgrade";
import {
  buildUpgradeGraph, GraphIssueKind, NODE_HEIGHT, NODE_WIDTH,
} from "@/lib/upgradeGraph";

const load = <T>(file: string): T =>
  yaml.load(readFileSync(resolve(__dirname, "../../public", file), "utf8")) as T;

const CATALOGUE = load<{ upgrades: UpgradeConfig[] }>("upgrades.yml").upgrades;
const LAST_LEVEL = Math.max(
  ...load<{ levels: { level: number }[] }>("map.yml").levels.map(l => l.level),
);

/** Minimal upgrade; only the fields the graph reads. */
const up = (
  id: string, tier: UpgradeTier, extra: Partial<UpgradeConfig> = {},
): UpgradeConfig => ({
  id,
  name: extra.name ?? id,
  tier,
  description: id,
  cost: 10,
  unlockLevel: 1,
  modifiers: {},
  ...extra,
});

/** A well-formed family: Junior -> Senior -> Principal -> two Architect forks. */
const family = (name: string, prefix: string): UpgradeConfig[] => [
  up(`${prefix}_j`, "Junior", { name }),
  up(`${prefix}_s`, "Senior", { name, prerequisites: [`${prefix}_j`] }),
  up(`${prefix}_p`, "Principal", { name, prerequisites: [`${prefix}_s`] }),
  up(`${prefix}_a`, "Architect", { name, prerequisites: [`${prefix}_p`], choiceGroup: `${prefix}_a` }),
  up(`${prefix}_b`, "Architect", { name, prerequisites: [`${prefix}_p`], choiceGroup: `${prefix}_a` }),
];

const kinds = (upgrades: UpgradeConfig[], lastLevel?: number): GraphIssueKind[] =>
  buildUpgradeGraph(upgrades, { lastLevel }).issues.map(i => i.kind);

// ── Structure ────────────────────────────────────────────────────────────────

describe("chain shape", () => {
  const graph = buildUpgradeGraph(family("Fast Compile", "fc"));

  it("counts a node's position in its chain, and the chain's length", () => {
    expect(graph.byId.get("fc_j")!.depth).toBe(0);
    expect(graph.byId.get("fc_p")!.depth).toBe(2);
    expect(graph.byId.get("fc_p")!.stepsToLeaf).toBe(1);
    // Junior, Senior, Principal, Architect: four steps, whichever fork you take.
    expect(graph.byId.get("fc_j")!.chainLength).toBe(4);
    expect(graph.clusters[0].steps).toBe(4);
  });

  it("records both directions of every prerequisite edge", () => {
    expect(graph.byId.get("fc_s")!.prerequisites).toEqual(["fc_j"]);
    expect(graph.byId.get("fc_p")!.dependents.sort()).toEqual(["fc_a", "fc_b"]);
  });

  it("groups a whole family into one cluster, however its names read", () => {
    expect(graph.clusters).toHaveLength(1);
    expect(graph.clusters[0].nodeIds).toHaveLength(5);
  });

  /**
   * Families that share no name still belong together when a prerequisite links
   * them: Budget Cycle hangs off Expense Account in the real catalogue, and
   * drawing them apart would hide the only relationship worth seeing.
   */
  it("keeps differently-named upgrades in one cluster when an edge links them", () => {
    const linked = buildUpgradeGraph([
      ...family("Fast Compile", "fc"),
      up("multithreading", "Architect", { name: "Multithreading", prerequisites: ["fc_p"] }),
    ]);
    expect(linked.clusters).toHaveLength(1);
    expect(linked.clusters[0].names).toContain("Multithreading");
  });

  it("splits unrelated families into separate clusters", () => {
    const graph = buildUpgradeGraph([...family("A", "a"), ...family("B", "b")]);
    expect(graph.clusters).toHaveLength(2);
    expect(graph.clusters.flatMap(c => c.nodeIds)).toHaveLength(10);
  });

  it("survives an empty catalogue rather than reducing over nothing", () => {
    const empty = buildUpgradeGraph([]);
    expect(empty.nodes).toEqual([]);
    expect(empty.summary.longestChain).toBe(0);
    expect(empty.bounds).toEqual({ width: 0, height: 0 });
  });
});

// ── Layout ───────────────────────────────────────────────────────────────────

describe("layout", () => {
  const graph = buildUpgradeGraph(CATALOGUE, { lastLevel: LAST_LEVEL });

  it("never draws two upgrades on top of each other", () => {
    const seen = new Set(graph.nodes.map(n => `${n.x},${n.y}`));
    expect(seen.size).toBe(graph.nodes.length);
  });

  /**
   * Column is max(tier, past every prerequisite) rather than tier alone. Tier
   * alone puts same-tier edges (scrum_master_2 -> scrum_master_3, both Senior)
   * in one column, where the arrow is a vertical line indistinguishable from no
   * edge at all. Fifteen such edges exist in the shipped catalogue.
   */
  it("points every arrow strictly rightwards", () => {
    for (const edge of graph.edges) {
      expect(graph.byId.get(edge.to)!.col).toBeGreaterThan(graph.byId.get(edge.from)!.col);
    }
  });

  it("never places an upgrade above the prerequisite it descends from", () => {
    for (const node of graph.nodes) {
      if (node.prerequisites.length !== 1) continue; // several parents cannot all be above
      expect(node.row).toBeGreaterThanOrEqual(graph.byId.get(node.prerequisites[0])!.row);
    }
  });

  it("gives each cluster its own band of rows, so hulls cannot overlap", () => {
    const bands = graph.clusters
      .map(c => ({ top: c.bounds.y, bottom: c.bounds.y + c.bounds.height }))
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].top).toBeGreaterThan(bands[i - 1].bottom);
    }
  });

  it("reports a board big enough to hold every node", () => {
    for (const node of graph.nodes) {
      expect(node.x + NODE_WIDTH).toBeLessThanOrEqual(graph.bounds.width);
      expect(node.y + NODE_HEIGHT).toBeLessThanOrEqual(graph.bounds.height);
    }
  });

  it("lays out identically on every build, so the map is memorable", () => {
    const again = buildUpgradeGraph(CATALOGUE, { lastLevel: LAST_LEVEL });
    expect(again.nodes.map(n => [n.id, n.x, n.y])).toEqual(graph.nodes.map(n => [n.id, n.x, n.y]));
  });
});

// ── Findings ─────────────────────────────────────────────────────────────────

describe("findings the loader cannot make", () => {
  it("catches an upgrade needing two options from one fork, which lock each other", () => {
    const found = kinds([
      ...family("A", "a"),
      up("greedy", "Wizard", { prerequisites: ["a_a", "a_b"] }),
    ]);
    expect(found).toContain("mutually-exclusive-prereqs");
  });

  it("catches a branch gated behind one option of a fork", () => {
    const graph = buildUpgradeGraph([
      ...family("A", "a"),
      up("after", "Wizard", { name: "After", prerequisites: ["a_a"] }),
    ]);
    const issue = graph.issues.find(i => i.kind === "choice-gated-branch");
    expect(issue?.nodeIds).toContain("after");
    expect(issue?.message).toMatch(/locks this branch out/i);
  });

  it("does not call a fork's own option a gated branch", () => {
    // a_a and a_b share a group; neither is "behind" the other.
    expect(kinds(family("A", "a"))).not.toContain("choice-gated-branch");
  });

  it("catches a Junior hidden behind a higher tier, where no build can open on it", () => {
    const graph = buildUpgradeGraph([
      ...family("A", "a"),
      up("late_junior", "Junior", { name: "Budget Cycle", prerequisites: ["a_s"] }),
    ]);
    const issue = graph.issues.find(i => i.kind === "tier-inversion");
    expect(issue?.nodeIds[0]).toBe("late_junior");
  });

  /**
   * Same-tier edges are deliberately NOT reported. Fifteen exist and they are
   * the design (a tier that branches sideways before descending); flagging them
   * would bury the real findings under known-good noise.
   */
  it("stays quiet about a prerequisite in the same tier", () => {
    const found = kinds([
      up("s1", "Senior"),
      up("s2", "Senior", { prerequisites: ["s1"] }),
    ]);
    expect(found).not.toContain("tier-inversion");
    expect(found).not.toContain("tier-skip");
  });

  it("notes a skipped tier", () => {
    const found = kinds([
      up("s", "Senior"),
      up("a", "Architect", { prerequisites: ["s"] }),
    ]);
    expect(found).toContain("tier-skip");
  });

  it("catches an upgrade that unlocks before its own prerequisite does", () => {
    const graph = buildUpgradeGraph([
      up("early", "Junior", { unlockLevel: 12 }),
      up("later", "Senior", { unlockLevel: 4, prerequisites: ["early"] }),
    ]);
    const issue = graph.issues.find(i => i.kind === "level-inversion");
    expect(issue?.nodeIds[0]).toBe("later");
    expect(issue?.message).toContain("12");
  });

  it("catches a normal-run upgrade gated behind an ascension-only one", () => {
    const graph = buildUpgradeGraph([
      up("asc", "Junior", { ascensionOnly: true }),
      up("normal", "Senior", { prerequisites: ["asc"] }),
    ]);
    expect(graph.issues.find(i => i.kind === "ascension-gate")?.severity).toBe("error");
  });

  it("catches an upgrade gated past the last map that exists", () => {
    expect(kinds([up("far", "Junior", { unlockLevel: 99 })], 35)).toContain("unlock-past-last-map");
  });

  it("skips the past-last-map check when no level curve was supplied", () => {
    expect(kinds([up("far", "Junior", { unlockLevel: 99 })])).not.toContain("unlock-past-last-map");
  });

  it("catches a fork with nothing to choose between, still charging the premium", () => {
    const graph = buildUpgradeGraph([
      up("j", "Junior"),
      up("only", "Senior", { prerequisites: ["j"], choiceGroup: "lonely" }),
    ]);
    expect(graph.issues.find(i => i.kind === "lonely-choice")?.message).toMatch(/without offering a choice/i);
  });

  it("catches a family whose last step is a bigger number rather than a decision", () => {
    const flat = [
      up("f_j", "Junior", { name: "Flat" }),
      up("f_s", "Senior", { name: "Flat", prerequisites: ["f_j"] }),
      up("f_p", "Principal", { name: "Flat", prerequisites: ["f_s"] }),
    ];
    expect(kinds(flat)).toContain("terminal-increment");
    // The same family, ending on a fork instead.
    expect(kinds(family("Forked", "fk"))).not.toContain("terminal-increment");
  });

  it("calls out an upgrade with nothing before or after it", () => {
    expect(kinds([up("alone", "Junior")])).toContain("isolated");
    expect(kinds(family("A", "a"))).not.toContain("isolated");
  });

  it("sorts errors above warnings above notes", () => {
    const graph = buildUpgradeGraph([
      up("alone", "Junior"),
      up("asc", "Junior", { ascensionOnly: true }),
      up("normal", "Senior", { prerequisites: ["asc"] }),
    ]);
    const rank = { error: 0, warn: 1, info: 2 };
    const seen = graph.issues.map(i => rank[i.severity]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

/**
 * Tenure hands out a Junior -> Senior -> Principal head start, walked inside one
 * family from a Junior with no prerequisites. A family can look like a valid
 * head start and not be one, which is how Budget Cycle and Procurement ended up
 * unofferable: both have a Junior, and both hang it off something higher.
 */
describe("Tenure reachability", () => {
  it("stays quiet about a family Tenure can walk", () => {
    expect(kinds(family("A", "a"))).not.toContain("tenure-unreachable");
  });

  it("catches a family whose Junior is not actually a starting point", () => {
    const graph = buildUpgradeGraph([
      ...family("Host", "h"),
      up("bc_j", "Junior", { name: "Budget Cycle", prerequisites: ["h_s"] }),
      up("bc_s", "Senior", { name: "Budget Cycle", prerequisites: ["bc_j"] }),
      up("bc_p", "Principal", { name: "Budget Cycle", prerequisites: ["bc_s"] }),
    ]);
    const issue = graph.issues.find(i => i.kind === "tenure-unreachable");
    expect(issue?.message).toContain("Budget Cycle");
    expect(issue?.nodeIds).toContain("bc_j");
  });

  it("catches a family whose chain to Principal is one link too long", () => {
    // Tenure grants exactly three tiers, so an extra Senior between the Junior
    // and the Principal leaves nothing for the third step to land on. This is
    // what makes SCRUM Master unofferable in the real catalogue.
    const found = kinds([
      up("sm_1", "Junior", { name: "SCRUM Master" }),
      up("sm_2", "Senior", { name: "SCRUM Master", prerequisites: ["sm_1"] }),
      up("sm_3", "Senior", { name: "SCRUM Master", prerequisites: ["sm_2"] }),
      up("sm_4", "Principal", { name: "SCRUM Master", prerequisites: ["sm_3"] }),
    ]);
    expect(found).toContain("tenure-unreachable");
  });

  it("does not fault a family that never had a Junior to offer", () => {
    // Technical Debt branches off Risk Appetite at Senior. It was never meant to
    // open a build, so reporting it would be noise.
    const found = kinds([
      up("host_j", "Junior", { name: "Host" }),
      up("td_s", "Senior", { name: "Technical Debt", prerequisites: ["host_j"] }),
      up("td_p", "Principal", { name: "Technical Debt", prerequisites: ["td_s"] }),
      up("td_a", "Architect", { name: "Technical Debt", prerequisites: ["td_p"] }),
    ]);
    expect(found).not.toContain("tenure-unreachable");
  });
});

// ── The shipped catalogue ────────────────────────────────────────────────────

describe("the catalogue as it ships", () => {
  const graph = buildUpgradeGraph(CATALOGUE, { lastLevel: LAST_LEVEL });

  it("draws every upgrade exactly once", () => {
    expect(graph.nodes).toHaveLength(CATALOGUE.length);
    expect(new Set(graph.clusters.flatMap(c => c.nodeIds)).size).toBe(CATALOGUE.length);
  });

  it("has no upgrade that can never be bought", () => {
    expect(graph.issues.filter(i => i.severity === "error")).toEqual([]);
  });

  /**
   * The design rule from the fork work: a family's last step is a choice, not
   * one more percentage point. upgradeForks.test.ts guards it from the content
   * side; this guards that the Atlas agrees, so the screen cannot quietly stop
   * detecting it.
   */
  it("has no family ending on a plain increment", () => {
    expect(graph.issues.filter(i => i.kind === "terminal-increment")).toEqual([]);
  });

  it("points every finding at upgrades that exist", () => {
    for (const issue of graph.issues) {
      expect(issue.nodeIds.length).toBeGreaterThan(0);
      for (const id of issue.nodeIds) expect(graph.byId.has(id)).toBe(true);
    }
  });

  it("counts the tiers the same way the file does", () => {
    for (const [tier, count] of Object.entries(graph.summary.perTier)) {
      expect(count).toBe(CATALOGUE.filter(u => u.tier === tier).length);
    }
  });
});

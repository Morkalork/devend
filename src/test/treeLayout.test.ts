/**
 * The ball tree's map (BALL_TREE_PLAN.md phase 4; ui/screens/treeLayout.ts):
 * every node placed, hanging off what it requires, none on top of another.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeData } from "@/types/upgrade";
import { NODE_W, depthOf, layoutTree, overlaps, type LayoutNode } from "@/ui/screens/treeLayout";

const data = yaml.load(readFileSync(resolve(__dirname, "../../public/tree.yml"), "utf8")) as UpgradeData;
const catalogue: LayoutNode[] = data.upgrades
  .filter(n => n.branch && n.branch !== "balls")
  .map(n => ({ id: n.id, branch: n.branch!, requires: [...(n.prerequisites ?? []), ...(n.upgradeOf ? [n.upgradeOf] : [])] }));
const balls: LayoutNode[] = [
  { id: "ball:1", branch: "balls", requires: [] },
  { id: "ball:2", branch: "balls", requires: ["ball:1"] },
  { id: "ball:add", branch: "balls", requires: ["ball:2"] },
];

describe("the tree's map", () => {
  const layout = layoutTree([...balls, ...catalogue]);

  it("places every node once, each branch leaving the root its own way", () => {
    expect(layout.nodes.length).toBe(balls.length + catalogue.length);
    expect(new Set(layout.nodes.map(n => n.id)).size).toBe(layout.nodes.length);
    const centre = (branch: string) => {
      const mine = layout.nodes.filter(n => n.branch === branch);
      return { x: mine.reduce((s, n) => s + n.x, 0) / mine.length, y: mine.reduce((s, n) => s + n.y, 0) / mine.length };
    };
    expect(centre("balls").y).toBeLessThan(0);
    expect(centre("office").y).toBeGreaterThan(0);
    expect(centre("fences").x).toBeLessThan(0);
    expect(centre("hands").x).toBeGreaterThan(0);
  });

  it("never stands one node on another", () => {
    const hits: string[] = [];
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        if (overlaps(layout.nodes[i], layout.nodes[j])) hits.push(`${layout.nodes[i].id} / ${layout.nodes[j].id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("hangs a node one ring further out than what it requires, with an edge between", () => {
    const byId = new Map(layout.nodes.map(n => [n.id, n]));
    for (const e of layout.edges) {
      const from = byId.get(e.from)!, to = byId.get(e.to)!;
      expect(to.depth).toBeGreaterThan(from.depth);
      expect(Math.hypot(to.x, to.y)).toBeGreaterThan(Math.hypot(from.x, from.y) + NODE_W / 4);
    }
    // A family chains: the Ice fence hangs off Fast Compile+, a payoff off its fence.
    expect(layout.edges).toContainEqual({ from: "fast_compile", to: "fast_compile_plus" });
    expect(layout.edges).toContainEqual({ from: "fast_compile_plus", to: "cold_storage_ice" });
    expect(layout.edges).toContainEqual({ from: "add_guardrails", to: "crash_barrier" });
    expect(layout.edges).toContainEqual({ from: "ball:2", to: "ball:add" });
  });

  it("reads depth through the chain and survives a cycle", () => {
    const byId = new Map(catalogue.map(n => [n.id, n]));
    expect(depthOf("fast_compile", byId)).toBe(0);
    expect(depthOf("fast_compile_plus", byId)).toBe(1);
    expect(depthOf("cold_storage_ice", byId)).toBe(2);
    expect(depthOf("crash_barrier", byId)).toBe(2);
    // Two parents: the deeper one decides the ring.
    expect(depthOf("afterburner", byId)).toBe(4);
    const loop = new Map<string, LayoutNode>([["a", { id: "a", branch: "hands", requires: ["b"] }], ["b", { id: "b", branch: "hands", requires: ["a"] }]]);
    expect(depthOf("a", loop)).toBeLessThanOrEqual(2);
  });

  it("bounds the content around every node with its own size", () => {
    for (const n of layout.nodes) {
      expect(n.x - NODE_W / 2).toBeGreaterThanOrEqual(layout.minX);
      expect(n.x + NODE_W / 2).toBeLessThanOrEqual(layout.maxX);
    }
  });
});

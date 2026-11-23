/**
 * Where the ball tree's nodes stand (BALL_TREE_PLAN.md phase 4): a map the
 * player pans about, not a list.
 *
 * The root is the run. Four branches leave it in four directions: the balls
 * up, the fences left, the hands right, the office down. Within a branch a
 * node stands one ring further out per prerequisite it has to pass through,
 * fanned about the branch's direction, and a ring widens when its nodes
 * would otherwise touch. Every edge is a prerequisite (or the node a "+"
 * rides on), so a locked node hangs visibly off the node that unlocks it.
 *
 * Pure: positions in content px, the root at (0, 0), nothing drawn here.
 */
import type { TreeBranch } from "@/lib/tree";

export interface LayoutNode {
  id: string;
  branch: TreeBranch;
  /** What this node hangs off: its prerequisites, and the node a "+" rides on. */
  requires: readonly string[];
}

export interface PlacedNode {
  id: string;
  branch: TreeBranch;
  depth: number;
  /** Centre, in content px, the root at the origin. */
  x: number;
  y: number;
}

export interface TreeEdge {
  from: string;
  to: string;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  edges: TreeEdge[];
  /** The content box around every node, with room for a node's own size. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A node's box, in px: a row for the name and the price, and under it the
 * node's description, three lines at most (BRIEF_MAX in tree.test.ts is what
 * keeps a description that short).
 */
export const NODE_W = 176;
export const NODE_H = 72;
/** The first ring's radius. */
export const RING_0 = 170;
/**
 * The step between rings: along a sideways branch a node's WIDTH lies on the
 * radius, so the step clears that; up and down it is the height that does.
 */
export const RING_STEP_ACROSS = NODE_W + 20;
export const RING_STEP_ALONG = NODE_H + 28;
/** Half the fan a branch opens across, in radians: inside its own quarter, clear of the next branch. */
export const FAN = Math.PI * 0.18;
/** The arc two neighbours on a ring keep between their centres. */
const ARC = NODE_W + 10;
/** Nodes a ring holds before the next ones go a ring further out. */
export const PER_RING = 3;

const BRANCH_ANGLE: Record<TreeBranch, number> = {
  balls: -Math.PI / 2,
  fences: Math.PI,
  hands: 0,
  office: Math.PI / 2,
};

/** How many prerequisites deep a node stands, within its branch's catalogue. */
export function depthOf(id: string, byId: Map<string, LayoutNode>, seen: Set<string> = new Set()): number {
  const node = byId.get(id);
  if (!node || seen.has(id)) {
    return 0;
  }
  seen.add(id);
  let depth = 0;
  for (const r of node.requires) {
    if (byId.has(r)) {
      depth = Math.max(depth, depthOf(r, byId, seen) + 1);
    }
  }
  seen.delete(id);
  return depth;
}

export function layoutTree(input: readonly LayoutNode[]): TreeLayout {
  const byId = new Map(input.map(n => [n.id, n]));
  const placed: PlacedNode[] = [];
  const angles = new Map<string, number>();

  for (const branch of Object.keys(BRANCH_ANGLE) as TreeBranch[]) {
    const mine = input.filter(n => n.branch === branch);
    if (mine.length === 0) {
      continue;
    }
    const base = BRANCH_ANGLE[branch];
    const step = branch === "fences" || branch === "hands" ? RING_STEP_ACROSS : RING_STEP_ALONG;
    const depths = new Map(mine.map(n => [n.id, depthOf(n.id, byId)]));
    const maxDepth = Math.max(...depths.values());
    let radius = RING_0;
    for (let d = 0; d <= maxDepth; d++) {
      // Children stand near their parents: a ring is ordered by the angle of
      // the first prerequisite that was placed, then by catalogue order.
      const ring = mine
        .filter(n => depths.get(n.id) === d)
        .map((n, i) => {
          const parent = n.requires.map(r => angles.get(r)).find(a => a !== undefined);
          return { n, i, key: parent ?? base };
        })
        .sort((a, b) => (a.key - b.key) || (a.i - b.i));
      if (ring.length === 0) {
        continue;
      }
      // A depth with many nodes is several rings, PER_RING each, so a branch
      // grows outward rather than fanning into its neighbours. Neighbours on
      // a ring keep ARC between them; a ring widens until they can, and the
      // fan never opens past FAN either side.
      for (let start = 0; start < ring.length; start += PER_RING) {
        const chunk = ring.slice(start, start + PER_RING);
        const count = chunk.length;
        if (count > 1) {
          radius = Math.max(radius, (ARC * (count - 1)) / (2 * FAN));
        }
        const span = count > 1 ? Math.min(2 * FAN, (ARC * (count - 1)) / radius) : 0;
        chunk.forEach(({ n }, k) => {
          const angle = count > 1 ? base - span / 2 + (span * k) / (count - 1) : base;
          angles.set(n.id, angle);
          placed.push({ id: n.id, branch, depth: d, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        });
        radius += step;
      }
    }
  }

  const edges: TreeEdge[] = [];
  for (const n of input) {
    for (const r of n.requires) {
      if (byId.has(r)) {
        edges.push({ from: r, to: n.id });
      }
    }
  }

  let minX = -NODE_W, minY = -NODE_H, maxX = NODE_W, maxY = NODE_H;
  for (const p of placed) {
    minX = Math.min(minX, p.x - NODE_W / 2);
    maxX = Math.max(maxX, p.x + NODE_W / 2);
    minY = Math.min(minY, p.y - NODE_H / 2);
    maxY = Math.max(maxY, p.y + NODE_H / 2);
  }
  return { nodes: placed, edges, minX, minY, maxX, maxY };
}

/** Two placed nodes' boxes overlap. The layout test holds this at zero. */
export function overlaps(a: PlacedNode, b: PlacedNode): boolean {
  return Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;
}

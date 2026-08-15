/**
 * The upgrade catalogue as a graph, for the admin Upgrade Atlas.
 *
 * public/upgrades.yml is 106 entries whose real shape lives entirely in
 * `prerequisites`, and that shape is not the tidy set of parallel J-S-P-A
 * ladders the file's section comments suggest. Families merge (Fast Compile
 * feeds Hot Start, Multithreading and Clean Release into one 12-node web),
 * branch inside a tier (scrum_master_2 -> scrum_master_3, both Senior), and
 * occasionally hang a Junior off a Principal. None of that is visible while
 * reading the YAML top to bottom, which is what this exists to fix.
 *
 * Everything here is pure and read-only: it derives layout and findings from a
 * loaded catalogue and writes nothing back. The hard validation (unknown
 * prerequisite ids, duplicate ids, cycles) already happens at load time in
 * useUpgradeManager and throws, so by the time a graph is built the input is
 * known to be a well-formed DAG. What is left for this module is the class of
 * problem that is legal but probably unintended, which no loader can reject.
 */
import { UpgradeConfig, UpgradeTier } from '@/types/upgrade';
import { eligibleTenureChains } from '@/lib/tenure';

export const TIER_ORDER: UpgradeTier[] = ['Junior', 'Senior', 'Principal', 'Architect', 'Wizard'];

const TIER_INDEX: Record<UpgradeTier, number> = {
  Junior: 0, Senior: 1, Principal: 2, Architect: 3, Wizard: 4,
};

/** Deepest tenure reward step, so the reachability check tests the best case. */
const TENURE_CHECK_DEPTH = 30;

// ── Layout geometry ──────────────────────────────────────────────────────────
// Board coordinates, in px at zoom 1. The screen applies its own pan/zoom
// transform on top, so these are chosen for legibility rather than to fit any
// particular viewport.
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 54;
export const COLUMN_GAP = 72;
export const ROW_GAP = 16;
/** Blank rows inserted between two clusters. */
export const CLUSTER_ROW_GAP = 1;

const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP;
const ROW_PITCH = NODE_HEIGHT + ROW_GAP;

export interface GraphNode {
  id: string;
  upgrade: UpgradeConfig;
  tier: UpgradeTier;
  tierIndex: number;
  /** Ids this upgrade requires (all of them: prerequisites are AND). */
  prerequisites: string[];
  /** Ids that require this upgrade. */
  dependents: string[];
  /** Index into UpgradeGraph.clusters. */
  cluster: number;
  /** Longest prerequisite path ending here, in edges. 0 for a root. */
  depth: number;
  /** Longest path from here to a leaf, in edges. 0 for a leaf. */
  stepsToLeaf: number;
  /** Nodes on the longest chain running through this one. */
  chainLength: number;
  col: number;
  row: number;
  x: number;
  y: number;
}

export interface GraphCluster {
  index: number;
  /** Distinct upgrade names in the cluster, in layout order. */
  names: string[];
  /** Display label: up to three names, then a count. */
  label: string;
  nodeIds: string[];
  /** Nodes on the longest root-to-leaf path. This is the "steps" count. */
  steps: number;
  tiers: UpgradeTier[];
  rootIds: string[];
  leafIds: string[];
  /** Bounding box in board coordinates, for focusing the view on it. */
  bounds: { x: number; y: number; width: number; height: number };
}

export type IssueSeverity = 'error' | 'warn' | 'info';

export type GraphIssueKind =
  /** Requires two members of one choiceGroup: unbuyable, they lock each other. */
  | 'mutually-exclusive-prereqs'
  /** A normal-run upgrade sitting behind an ascension-only prerequisite. */
  | 'ascension-gate'
  /** Requires a choiceGroup member, so taking the sibling locks this branch out. */
  | 'choice-gated-branch'
  /** Sits behind a HIGHER tier, so it is mid-graph rather than a chain head. */
  | 'tier-inversion'
  /** Skips a tier: Senior straight to Architect. */
  | 'tier-skip'
  /** Unlocks before its own prerequisite does. */
  | 'level-inversion'
  /** unlockLevel past the last level defined in map.yml. */
  | 'unlock-past-last-map'
  /** A choiceGroup with nothing to choose between, still charged +50%. */
  | 'lonely-choice'
  /** The family's last tier is a plain increment rather than a fork. */
  | 'terminal-increment'
  /** A family Tenure can never offer as a head start. */
  | 'tenure-unreachable'
  /** No prerequisites and no dependents: a one-off, not a chain. */
  | 'isolated';

export interface GraphIssue {
  kind: GraphIssueKind;
  severity: IssueSeverity;
  /** Nodes the finding is about; the first is what the view focuses on. */
  nodeIds: string[];
  message: string;
}

export interface GraphSummary {
  upgrades: number;
  clusters: number;
  /** Nodes on the longest chain anywhere in the catalogue. */
  longestChain: number;
  perTier: Record<UpgradeTier, number>;
  choiceGroups: number;
  /** Widest column, in nodes, and tallest stack of rows. */
  columns: number;
  rows: number;
}

export interface UpgradeGraph {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  clusters: GraphCluster[];
  edges: { from: string; to: string }[];
  issues: GraphIssue[];
  summary: GraphSummary;
  /** Board extent, so the view can fit the whole thing on open. */
  bounds: { width: number; height: number };
}

export interface UpgradeGraphOptions {
  /**
   * Highest level defined in map.yml. Enables the unlock-past-last-map check;
   * omitted, that check is skipped rather than guessed at.
   */
  lastLevel?: number;
}

const byIdThen = <T extends { id: string }>(key: (t: T) => number) =>
  (a: T, b: T) => key(a) - key(b) || a.id.localeCompare(b.id);

/**
 * Which families Tenure can hand out as a head start.
 *
 * Delegated to tenure.ts rather than reimplemented, so this can never disagree
 * with what the draft screen actually offers. The fixed rng is safe here: the
 * walk only branches where a family has several same-tier options, and it can
 * only fail at the Senior step (the Principal step is the last, so it needs no
 * continuation), where every family has exactly one candidate. The choice the
 * rng makes therefore never decides whether a chain resolves.
 */
function tenureHeadIds(upgrades: UpgradeConfig[]): Set<string> {
  const chains = eligibleTenureChains(upgrades, TENURE_CHECK_DEPTH, () => 0);
  return new Set(chains.map(c => c.headId));
}

export function buildUpgradeGraph(
  upgrades: UpgradeConfig[],
  options: UpgradeGraphOptions = {},
): UpgradeGraph {
  const known = new Set(upgrades.map(u => u.id));

  const nodes: GraphNode[] = upgrades.map(u => ({
    id: u.id,
    upgrade: u,
    tier: u.tier,
    tierIndex: TIER_INDEX[u.tier] ?? 0,
    // Defensive: a dangling prerequisite is a load-time error, but this module
    // is also handed hand-written catalogues by tests.
    prerequisites: (u.prerequisites ?? []).filter(id => known.has(id)),
    dependents: [],
    cluster: -1,
    depth: 0,
    stepsToLeaf: 0,
    chainLength: 1,
    col: 0,
    row: 0,
    x: 0,
    y: 0,
  }));

  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    for (const prereqId of node.prerequisites) byId.get(prereqId)!.dependents.push(node.id);
  }

  const edges = nodes.flatMap(n => n.prerequisites.map(from => ({ from, to: n.id })));

  const order = topologicalOrder(nodes, byId);
  assignColumns(order, byId);
  assignDepths(order, byId);

  const clusters = buildClusters(nodes, byId);
  layOutRows(clusters, byId);
  measureClusters(clusters, byId);

  return {
    nodes,
    byId,
    clusters,
    edges,
    issues: findIssues(upgrades, nodes, byId, options),
    summary: summarise(upgrades, nodes, clusters),
    bounds: boardBounds(nodes),
  };
}

/** Kahn's algorithm. The catalogue is validated acyclic at load time. */
function topologicalOrder(nodes: GraphNode[], byId: Map<string, GraphNode>): GraphNode[] {
  const remaining = new Map(nodes.map(n => [n.id, n.prerequisites.length]));
  const ready = nodes.filter(n => n.prerequisites.length === 0).sort(byIdThen(n => n.tierIndex));
  const out: GraphNode[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    out.push(node);
    for (const depId of node.dependents) {
      const left = remaining.get(depId)! - 1;
      remaining.set(depId, left);
      if (left === 0) ready.push(byId.get(depId)!);
    }
  }

  // A cycle would leave nodes unvisited. Append them so nothing silently
  // vanishes from the view; the loader would have thrown long before this.
  for (const node of nodes) if (!out.includes(node)) out.push(node);
  return out;
}

/**
 * Column per node: its tier, but never left of one past its prerequisites.
 *
 * Tier alone would put same-tier edges (scrum_master_2 -> scrum_master_3) in
 * one column, drawing them as a vertical line indistinguishable from no edge
 * at all. Taking the max keeps every arrow pointing strictly rightwards while
 * still lining tiers up across the whole board wherever the chain is regular.
 */
function assignColumns(order: GraphNode[], byId: Map<string, GraphNode>): void {
  for (const node of order) {
    let col = node.tierIndex;
    for (const prereqId of node.prerequisites) {
      col = Math.max(col, byId.get(prereqId)!.col + 1);
    }
    node.col = col;
    node.x = col * COLUMN_PITCH;
  }
}

function assignDepths(order: GraphNode[], byId: Map<string, GraphNode>): void {
  for (const node of order) {
    node.depth = node.prerequisites.reduce(
      (max, id) => Math.max(max, byId.get(id)!.depth + 1), 0,
    );
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    node.stepsToLeaf = node.dependents.reduce(
      (max, id) => Math.max(max, byId.get(id)!.stepsToLeaf + 1), 0,
    );
  }
  for (const node of order) node.chainLength = node.depth + node.stepsToLeaf + 1;
}

/**
 * Connected components of the UNDIRECTED prerequisite graph.
 *
 * A component is the honest unit of "related", not the shared `name` Tenure
 * uses for a family: Budget Cycle carries its own name but hangs off Expense
 * Account, and drawing it apart would hide exactly the relationship worth
 * seeing.
 */
function buildClusters(nodes: GraphNode[], byId: Map<string, GraphNode>): GraphCluster[] {
  const parent = new Map(nodes.map(n => [n.id, n.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(id) !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const node of nodes) for (const prereqId of node.prerequisites) union(node.id, prereqId);

  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // Big webs first, so the eye lands on the structural ones; ties broken by id
  // so the layout is stable across reloads.
  const ordered = [...groups.values()].sort(
    (a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id),
  );

  return ordered.map((members, index) => {
    for (const node of members) node.cluster = index;
    return {
      index,
      names: [],
      label: '',
      nodeIds: members.map(n => n.id),
      steps: Math.max(...members.map(n => n.chainLength)),
      tiers: TIER_ORDER.filter(t => members.some(n => n.tier === t)),
      rootIds: members.filter(n => n.prerequisites.length === 0).map(n => n.id),
      leafIds: members.filter(n => n.dependents.length === 0).map(n => n.id),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  });
}

/**
 * Rows, cluster by cluster, depth-first from each root.
 *
 * Depth-first rather than tier-by-tier so a chain reads as one horizontal run
 * instead of being interleaved with its siblings, and a child never sits above
 * the parent it descends from.
 */
function layOutRows(clusters: GraphCluster[], byId: Map<string, GraphNode>): void {
  let nextRow = 0;

  for (const cluster of clusters) {
    const start = nextRow;
    const cursor = new Map<number, number>();
    const placed = new Set<string>();
    let lastRow = start;

    const nextFree = (col: number) => Math.max(cursor.get(col) ?? start, start);

    const place = (node: GraphNode, parentRow: number): void => {
      if (placed.has(node.id)) return;
      placed.add(node.id);

      const row = Math.max(nextFree(node.col), parentRow);
      node.row = row;
      node.y = row * ROW_PITCH;
      cursor.set(node.col, row + 1);
      lastRow = Math.max(lastRow, row);

      const children = node.dependents
        .map(id => byId.get(id)!)
        .sort(byIdThen(n => n.col));
      for (const child of children) place(child, row);
    };

    const roots = cluster.rootIds.map(id => byId.get(id)!).sort(byIdThen(n => n.col));
    for (const root of roots) place(root, start);
    // A cycle (impossible post-load) would leave members unplaced; park them
    // below rather than stacking them all at row 0.
    for (const id of cluster.nodeIds) if (!placed.has(id)) place(byId.get(id)!, ++lastRow);

    nextRow = lastRow + 1 + CLUSTER_ROW_GAP;
  }
}

function measureClusters(clusters: GraphCluster[], byId: Map<string, GraphNode>): void {
  for (const cluster of clusters) {
    const members = cluster.nodeIds
      .map(id => byId.get(id)!)
      .sort((a, b) => a.row - b.row || a.col - b.col);

    const names: string[] = [];
    for (const node of members) {
      if (!names.includes(node.upgrade.name)) names.push(node.upgrade.name);
    }
    cluster.names = names;
    cluster.label = names.length <= 3
      ? names.join(' + ')
      : `${names.slice(0, 3).join(' + ')} +${names.length - 3} more`;

    const x = Math.min(...members.map(n => n.x));
    const y = Math.min(...members.map(n => n.y));
    cluster.bounds = {
      x,
      y,
      width: Math.max(...members.map(n => n.x + NODE_WIDTH)) - x,
      height: Math.max(...members.map(n => n.y + NODE_HEIGHT)) - y,
    };
  }
}

function boardBounds(nodes: GraphNode[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 0, height: 0 };
  return {
    width: Math.max(...nodes.map(n => n.x + NODE_WIDTH)),
    height: Math.max(...nodes.map(n => n.y + NODE_HEIGHT)),
  };
}

function summarise(
  upgrades: UpgradeConfig[], nodes: GraphNode[], clusters: GraphCluster[],
): GraphSummary {
  const perTier = {} as Record<UpgradeTier, number>;
  for (const tier of TIER_ORDER) perTier[tier] = nodes.filter(n => n.tier === tier).length;

  return {
    upgrades: upgrades.length,
    clusters: clusters.length,
    longestChain: nodes.length === 0 ? 0 : Math.max(...nodes.map(n => n.chainLength)),
    perTier,
    choiceGroups: new Set(upgrades.filter(u => u.choiceGroup).map(u => u.choiceGroup)).size,
    columns: nodes.length === 0 ? 0 : Math.max(...nodes.map(n => n.col)) + 1,
    rows: nodes.length === 0 ? 0 : Math.max(...nodes.map(n => n.row)) + 1,
  };
}

// ── Findings ─────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warn: 1, info: 2 };

/**
 * Everything the graph can say about itself that the loader will not.
 *
 * Deliberately excludes same-tier prerequisite edges. Fifteen of them exist and
 * they are the design (a tier that branches sideways before descending), so
 * reporting them would bury the findings that matter under known-good noise.
 */
function findIssues(
  upgrades: UpgradeConfig[],
  nodes: GraphNode[],
  byId: Map<string, GraphNode>,
  options: UpgradeGraphOptions,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (
    kind: GraphIssueKind, severity: IssueSeverity, nodeIds: string[], message: string,
  ) => issues.push({ kind, severity, nodeIds, message });

  const groupMembers = new Map<string, string[]>();
  for (const u of upgrades) {
    if (!u.choiceGroup) continue;
    if (!groupMembers.has(u.choiceGroup)) groupMembers.set(u.choiceGroup, []);
    groupMembers.get(u.choiceGroup)!.push(u.id);
  }

  for (const [group, members] of groupMembers) {
    if (members.length < 2) {
      add('lonely-choice', 'warn', members,
        `Choice group "${group}" has one member, so it charges the +50% choice premium without offering a choice.`);
    }
  }

  for (const node of nodes) {
    const u = node.upgrade;

    // Prerequisites are AND, and choice-group siblings lock each other out, so
    // needing two of them is a dead node. None exist today; this guards edits.
    const groupsNeeded = new Map<string, string[]>();
    for (const prereqId of node.prerequisites) {
      const group = byId.get(prereqId)!.upgrade.choiceGroup;
      if (!group) continue;
      if (!groupsNeeded.has(group)) groupsNeeded.set(group, []);
      groupsNeeded.get(group)!.push(prereqId);
    }
    for (const [group, ids] of groupsNeeded) {
      if (ids.length > 1) {
        add('mutually-exclusive-prereqs', 'error', [node.id, ...ids],
          `Requires ${ids.length} members of choice group "${group}", which lock each other out, so it can never be bought.`);
      } else if (u.choiceGroup !== group) {
        add('choice-gated-branch', 'warn', [node.id, ids[0]],
          `Sits behind "${ids[0]}", one option in choice group "${group}". Taking the other option locks this branch out for the rest of the run.`);
      }
    }

    for (const prereqId of node.prerequisites) {
      const prereq = byId.get(prereqId)!;
      const gap = node.tierIndex - prereq.tierIndex;

      if (gap < 0) {
        add('tier-inversion', 'warn', [node.id, prereqId],
          `${u.tier} sitting behind ${prereq.tier} "${prereqId}". It is mid-graph rather than a chain head, so it cannot open a build.`);
      } else if (gap >= 2) {
        add('tier-skip', 'info', [node.id, prereqId],
          `Jumps ${prereq.tier} straight to ${u.tier}, skipping ${TIER_ORDER.slice(prereq.tierIndex + 1, node.tierIndex).join(', ')}.`);
      }

      if (!u.ascensionOnly && prereq.upgrade.ascensionOnly) {
        add('ascension-gate', 'error', [node.id, prereqId],
          `A normal-run upgrade behind ascension-only "${prereqId}", so it is unreachable outside Ascension.`);
      }

      const level = u.unlockLevel ?? 1;
      const prereqLevel = prereq.upgrade.unlockLevel ?? 1;
      if (level < prereqLevel) {
        add('level-inversion', 'warn', [node.id, prereqId],
          `Unlocks at level ${level} but its prerequisite "${prereqId}" only appears at ${prereqLevel}, so the earlier unlock is dead until then.`);
      }
    }

    if (typeof options.lastLevel === 'number' && (u.unlockLevel ?? 1) > options.lastLevel) {
      add('unlock-past-last-map', 'warn', [node.id],
        `Unlocks at level ${u.unlockLevel}, past the last level in map.yml (${options.lastLevel}), so it is never offered.`);
    }

    if (node.prerequisites.length === 0 && node.dependents.length === 0) {
      add('isolated', 'info', [node.id],
        'Stands alone: nothing leads to it and nothing follows, so it is a one-off rather than a chain.');
    }
  }

  issues.push(...terminalIncrementIssues(nodes, byId));
  issues.push(...tenureIssues(upgrades, nodes));

  return issues.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || a.kind.localeCompare(b.kind)
      || a.nodeIds[0].localeCompare(b.nodeIds[0]),
  );
}

/**
 * Families whose last tier is a plain increment rather than a fork.
 *
 * The agreed design is that a family's final step is a decision, not one more
 * percentage point. Checked per family (shared `name`) rather than per cluster,
 * because a cluster can hold several families and only one of them may end flat.
 */
function terminalIncrementIssues(
  nodes: GraphNode[], byId: Map<string, GraphNode>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];

  for (const [name, members] of familiesByName(nodes)) {
    if (members.length < 3) continue; // too short to have a shape worth judging

    const deepest = Math.max(...members.map(n => n.tierIndex));
    const finals = members.filter(
      n => n.tierIndex === deepest
        && n.dependents.every(id => byId.get(id)!.upgrade.name !== name),
    );
    if (finals.length === 0 || finals.some(n => n.upgrade.choiceGroup)) continue;

    issues.push({
      kind: 'terminal-increment',
      severity: 'info',
      nodeIds: finals.map(n => n.id),
      message: `"${name}" ends on a plain increment at ${finals[0].tier}. Its last step is a number, not a choice.`,
    });
  }

  return issues;
}

/**
 * Families that LOOK like a Tenure head start but are not one.
 *
 * Tenure walks Junior -> Senior -> Principal inside a single family, starting
 * from a Junior with no prerequisites. Families that simply have no Junior
 * (Technical Debt branches off Risk Appetite at Senior) are excluded: they were
 * never meant to open a build, and reporting them buries the cases that are
 * genuine accidents, where a Junior exists and still cannot be offered.
 */
function tenureIssues(upgrades: UpgradeConfig[], nodes: GraphNode[]): GraphIssue[] {
  const heads = tenureHeadIds(upgrades);
  const issues: GraphIssue[] = [];

  for (const [name, members] of familiesByName(nodes)) {
    const normal = members.filter(n => !n.upgrade.ascensionOnly);
    if (!normal.some(n => n.tierIndex === TIER_INDEX.Junior)) continue;
    if (!normal.some(n => n.tierIndex >= TIER_INDEX.Principal)) continue;
    if (normal.some(n => heads.has(n.id))) continue;

    issues.push({
      kind: 'tenure-unreachable',
      severity: 'warn',
      nodeIds: normal.sort(byIdThen(n => n.tierIndex)).map(n => n.id),
      message: `Has a Junior and reaches Principal, but Tenure cannot offer "${name}" as a head start: no Junior of this family opens a clean run of prerequisites down to Principal.`,
    });
  }

  return issues;
}

/** Nodes grouped by display name, which is what a "family" means to Tenure. */
function familiesByName(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const families = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const name = node.upgrade.name;
    if (!families.has(name)) families.set(name, []);
    families.get(name)!.push(node);
  }
  return families;
}

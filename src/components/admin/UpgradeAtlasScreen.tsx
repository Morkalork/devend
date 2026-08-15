/**
 * Upgrade Atlas — the whole catalogue as a graph, for the admin panel.
 *
 * public/upgrades.yml is 106 entries in a file you read top to bottom, so the
 * only shape it shows you is the order the sections happen to be written in.
 * The real shape is in `prerequisites`, and it does not match: families merge,
 * chains branch inside a tier, and a Junior occasionally hangs off a Principal.
 * This draws that graph, and reports the class of problem the loader cannot
 * (see upgradeGraph.ts, which owns all of the logic; this file is view only).
 *
 * Read-only by design. Nothing here writes to the YAML or to game state, so it
 * can never be the reason a run behaves oddly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Crosshair, Maximize2, Search, ShieldAlert, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import yaml from 'js-yaml';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { UpgradeTag, UpgradeTier, TIER_COLORS } from '@/types/upgrade';
import { LevelData } from '@/types/level';
import {
  buildUpgradeGraph, GraphIssue, GraphNode, IssueSeverity,
  NODE_HEIGHT, NODE_WIDTH, TIER_ORDER,
} from '@/lib/upgradeGraph';

interface UpgradeAtlasScreenProps {
  onBack: () => void;
}

/** SVG needs literal colours; these mirror TIER_COLORS in src/types/upgrade.ts. */
const TIER_HEX: Record<UpgradeTier, string> = {
  Junior: '#cbd5e1',
  Senior: '#60a5fa',
  Principal: '#c084fc',
  Architect: '#fbbf24',
  Wizard: '#6ee7b7',
};

/** Mirrors TAG_COLORS, same reason. */
const TAG_HEX: Record<UpgradeTag, string> = {
  lock: '#6ee7b7',
  freeze: '#67e8f9',
  bank: '#fde047',
  tempo: '#fdba74',
  risk: '#fca5a5',
  safety: '#93c5fd',
};

const SEVERITY_STYLE: Record<IssueSeverity, { dot: string; text: string; label: string }> = {
  error: { dot: 'bg-destructive', text: 'text-destructive', label: 'Error' },
  warn: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Warning' },
  info: { dot: 'bg-sky-400', text: 'text-sky-400', label: 'Note' },
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const CLUSTER_PAD = 18;

interface Viewport { x: number; y: number; k: number }

/** Rough character budget for a label at the given box width. */
const truncate = (text: string, chars: number) =>
  text.length <= chars ? text : `${text.slice(0, chars - 1)}…`;

export function UpgradeAtlasScreen({ onBack }: UpgradeAtlasScreenProps) {
  const { upgrades, loadUpgrades, isLoading, error } = useUpgradeManager();
  const [lastLevel, setLastLevel] = useState<number | undefined>(undefined);

  useEffect(() => {
    void loadUpgrades();
    // The unlock-past-last-map check needs the level curve. Fetched here rather
    // than guessed, so the check is simply skipped if map.yml cannot be read.
    void fetch('/map.yml', { cache: 'no-store' })
      .then(res => (res.ok ? res.text() : null))
      .then(text => {
        if (!text) return;
        const levels = (yaml.load(text) as LevelData)?.levels ?? [];
        const highest = levels.reduce((max, l) => Math.max(max, l?.level ?? 0), 0);
        if (highest > 0) setLastLevel(highest);
      })
      .catch(() => undefined);
  }, [loadUpgrades]);

  const graph = useMemo(
    () => buildUpgradeGraph(upgrades, { lastLevel }),
    [upgrades, lastLevel],
  );

  // ── View state ─────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  /** Positions the user has dragged a node to, keyed by id. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showIssues, setShowIssues] = useState(false);

  const positionOf = useCallback(
    (node: GraphNode) => moved[node.id] ?? { x: node.x, y: node.y },
    [moved],
  );

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || graph.nodes.length === 0) return;
    const { width, height } = svg.getBoundingClientRect();
    const k = Math.min(
      Math.max(MIN_ZOOM, Math.min(width / (graph.bounds.width + 80), height / (graph.bounds.height + 80))),
      MAX_ZOOM,
    );
    setView({ x: (width - graph.bounds.width * k) / 2, y: 24, k });
  }, [graph]);

  // Fit once the catalogue has loaded and the board has a real size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || graph.nodes.length === 0) return;
    fitted.current = true;
    fit();
  }, [graph, fit]);

  /** Centre the view on a node and select it. */
  const focusNode = useCallback((id: string) => {
    const node = graph.byId.get(id);
    const svg = svgRef.current;
    if (!node || !svg) return;
    const { width, height } = svg.getBoundingClientRect();
    const k = Math.max(view.k, 0.75);
    const pos = moved[id] ?? { x: node.x, y: node.y };
    setView({
      x: width / 2 - (pos.x + NODE_WIDTH / 2) * k,
      y: height / 2 - (pos.y + NODE_HEIGHT / 2) * k,
      k,
    });
    setSelectedId(id);
  }, [graph, view.k, moved]);

  // ── Pointer handling: pan, pinch-zoom, node drag ───────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragging = useRef<
    | { kind: 'pan'; startView: Viewport; startX: number; startY: number }
    | { kind: 'node'; id: string; offsetX: number; offsetY: number }
    | { kind: 'pinch'; startDist: number; startView: Viewport; midX: number; midY: number }
    | null
  >(null);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setView(prev => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor));
      const ratio = k / prev.k;
      return { k, x: sx - (sx - prev.x) * ratio, y: sy - (sy - prev.y) * ratio };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      dragging.current = {
        kind: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startView: view,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      return;
    }

    const nodeId = (e.target as Element).closest?.('[data-node-id]')?.getAttribute('data-node-id');
    if (nodeId) {
      const node = graph.byId.get(nodeId);
      if (node) {
        const pos = positionOf(node);
        dragging.current = {
          kind: 'node',
          id: nodeId,
          offsetX: (p.x - view.x) / view.k - pos.x,
          offsetY: (p.y - view.y) / view.k - pos.y,
        };
        setSelectedId(nodeId);
        return;
      }
    }

    dragging.current = { kind: 'pan', startView: view, startX: p.x, startY: p.y };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const drag = dragging.current;
    if (!drag) return;

    if (drag.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, drag.startView.k * (dist / drag.startDist)));
      const ratio = k / drag.startView.k;
      setView({
        k,
        x: drag.midX - (drag.midX - drag.startView.x) * ratio,
        y: drag.midY - (drag.midY - drag.startView.y) * ratio,
      });
      return;
    }

    if (drag.kind === 'pan') {
      setView({
        k: drag.startView.k,
        x: drag.startView.x + (p.x - drag.startX),
        y: drag.startView.y + (p.y - drag.startY),
      });
      return;
    }

    setMoved(prev => ({
      ...prev,
      [drag.id]: {
        x: (p.x - view.x) / view.k - drag.offsetX,
        y: (p.y - view.y) / view.k - drag.offsetY,
      },
    }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) dragging.current = null;
  };

  // Wheel zoom. Registered natively because React's onWheel is passive, and a
  // passive listener cannot preventDefault the page scroll behind the board.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [zoomAt]);

  // ── Derived highlighting ───────────────────────────────────────────────────
  /** The selected node plus everything up- and downstream of it. */
  const related = useMemo(() => {
    if (!selectedId) return null;
    const out = new Set<string>([selectedId]);
    const walk = (id: string, next: (n: GraphNode) => string[]) => {
      for (const other of next(graph.byId.get(id)!)) {
        if (out.has(other)) continue;
        out.add(other);
        walk(other, next);
      }
    };
    walk(selectedId, n => n.prerequisites);
    walk(selectedId, n => n.dependents);
    return out;
  }, [selectedId, graph]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      graph.nodes
        .filter(n =>
          n.upgrade.name.toLowerCase().includes(q)
          || n.id.toLowerCase().includes(q)
          || (n.upgrade.tags ?? []).some(t => t.includes(q))
          || n.tier.toLowerCase().includes(q))
        .map(n => n.id),
    );
  }, [query, graph]);

  const issuesByNode = useMemo(() => {
    const map = new Map<string, GraphIssue[]>();
    for (const issue of graph.issues) {
      for (const id of issue.nodeIds) {
        if (!map.has(id)) map.set(id, []);
        map.get(id)!.push(issue);
      }
    }
    return map;
  }, [graph]);

  /** Cluster hulls, recomputed from live positions so drags stay wrapped. */
  const hulls = useMemo(() => graph.clusters.map(cluster => {
    const members = cluster.nodeIds.map(id => positionOf(graph.byId.get(id)!));
    const x = Math.min(...members.map(m => m.x)) - CLUSTER_PAD;
    const y = Math.min(...members.map(m => m.y)) - CLUSTER_PAD;
    return {
      cluster,
      x,
      y,
      width: Math.max(...members.map(m => m.x + NODE_WIDTH)) + CLUSTER_PAD - x,
      height: Math.max(...members.map(m => m.y + NODE_HEIGHT)) + CLUSTER_PAD - y,
    };
  }), [graph, positionOf]);

  const selected = selectedId ? graph.byId.get(selectedId) : null;
  const errorCount = graph.issues.filter(i => i.severity === 'error').length;
  const warnCount = graph.issues.filter(i => i.severity === 'warn').length;

  return (
    <div className="min-h-screen h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0 flex-wrap">
        <button onClick={onBack} className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-primary">Upgrade Atlas</h1>

        {!isLoading && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{graph.summary.upgrades} upgrades</span>
            <span className="opacity-40">/</span>
            <span>{graph.summary.clusters} chains</span>
            <span className="opacity-40">/</span>
            <span>longest {graph.summary.longestChain} steps</span>
            <span className="opacity-40">/</span>
            <span>{graph.summary.choiceGroups} forks</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by name, id, tag"
              className="pl-7 pr-2 py-1.5 w-48 rounded bg-muted text-xs outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={() => setShowIssues(v => !v)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
              showIssues ? 'bg-primary/20 text-primary' : 'bg-muted hover:bg-muted/70'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Health
            {errorCount > 0 && <span className="text-destructive font-semibold">{errorCount}</span>}
            {errorCount === 0 && warnCount > 0 && <span className="text-amber-400 font-semibold">{warnCount}</span>}
          </button>
          <button onClick={() => zoomAt(1 / 1.2, 0, 0)} className="p-1.5 rounded bg-muted hover:bg-muted/70">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => zoomAt(1.2, 0, 0)} className="p-1.5 rounded bg-muted hover:bg-muted/70">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={fit} className="p-1.5 rounded bg-muted hover:bg-muted/70" title="Fit to screen">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {Object.keys(moved).length > 0 && (
            <button
              onClick={() => setMoved({})}
              className="p-1.5 rounded bg-muted hover:bg-muted/70"
              title="Reset dragged nodes to the computed layout"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            Loading upgrades.yml…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md text-sm text-destructive">
              <div className="font-semibold mb-1">upgrades.yml did not load</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <marker id="atlas-arrow" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>

          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* Cluster hulls, so a chain reads as one thing before you zoom in */}
            {hulls.map(hull => (
              <g key={hull.cluster.index}>
                <rect
                  x={hull.x} y={hull.y} width={hull.width} height={hull.height}
                  rx={14}
                  className="fill-muted/20 stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={hull.x + 10} y={hull.y + 14}
                  className="fill-muted-foreground pointer-events-none"
                  fontSize={11}
                >
                  {hull.cluster.label} · {hull.cluster.nodeIds.length} upgrades · {hull.cluster.steps} steps
                </text>
              </g>
            ))}

            {/* Edges */}
            {graph.edges.map(edge => {
              const from = positionOf(graph.byId.get(edge.from)!);
              const to = positionOf(graph.byId.get(edge.to)!);
              const x1 = from.x + NODE_WIDTH, y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x, y2 = to.y + NODE_HEIGHT / 2;
              const bend = Math.max(28, Math.abs(x2 - x1) * 0.45);
              const lit = related?.has(edge.from) && related?.has(edge.to);
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={lit ? '#e2e8f0' : '#64748b'}
                  strokeWidth={lit ? 2 : 1.2}
                  strokeOpacity={related && !lit ? 0.15 : 0.65}
                  markerEnd="url(#atlas-arrow)"
                  color={lit ? '#e2e8f0' : '#64748b'}
                />
              );
            })}

            {/* Nodes */}
            {graph.nodes.map(node => {
              const pos = positionOf(node);
              const tier = TIER_HEX[node.tier];
              const dimmed = (related && !related.has(node.id)) || (matches && !matches.has(node.id));
              const nodeIssues = issuesByNode.get(node.id) ?? [];
              const worst = nodeIssues.some(i => i.severity === 'error')
                ? 'error'
                : nodeIssues.some(i => i.severity === 'warn') ? 'warn' : null;

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  transform={`translate(${pos.x} ${pos.y})`}
                  opacity={dimmed ? 0.22 : 1}
                  className="cursor-pointer"
                >
                  <rect
                    width={NODE_WIDTH} height={NODE_HEIGHT} rx={8}
                    fill="#111827"
                    stroke={tier}
                    strokeWidth={node.id === selectedId ? 2.5 : 1.25}
                    strokeDasharray={node.upgrade.choiceGroup ? '5 3' : undefined}
                  />
                  <text x={10} y={20} fontSize={12} fill="#e2e8f0" className="pointer-events-none">
                    {truncate(node.upgrade.name, 24)}
                  </text>
                  <text x={10} y={37} fontSize={10} fill={tier} className="pointer-events-none">
                    {node.tier}
                  </text>
                  <text x={10} y={49} fontSize={9} fill="#94a3b8" className="pointer-events-none">
                    {node.upgrade.cost}h · L{node.upgrade.unlockLevel ?? 1}
                    {node.upgrade.ascensionOnly ? ' · ascension' : ''}
                  </text>

                  {/* Tag dots */}
                  {(node.upgrade.tags ?? []).map((tag, i) => (
                    <circle
                      key={tag}
                      cx={NODE_WIDTH - 12 - i * 11} cy={14} r={4}
                      fill={TAG_HEX[tag] ?? '#94a3b8'}
                      className="pointer-events-none"
                    />
                  ))}

                  {worst && (
                    <circle
                      cx={NODE_WIDTH - 12} cy={NODE_HEIGHT - 12} r={4.5}
                      fill={worst === 'error' ? '#f87171' : '#fbbf24'}
                      className="pointer-events-none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 p-2 rounded-lg bg-card/90 border border-border text-[10px] pointer-events-none">
          <div className="flex items-center gap-2">
            {TIER_ORDER.map(tier => (
              <span key={tier} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: TIER_HEX[tier] }} />
                <span className={TIER_COLORS[tier].text}>{tier}</span>
              </span>
            ))}
          </div>
          <div className="text-muted-foreground">
            Dashed border = one option in a fork. Drag to move, scroll or pinch to zoom.
          </div>
        </div>

        {/* Health panel */}
        {showIssues && (
          <div className="absolute top-3 left-3 bottom-3 w-80 max-w-[calc(100%-1.5rem)] rounded-lg bg-card/95 border border-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Health</span>
              <span className="text-xs text-muted-foreground">{graph.issues.length} findings</span>
              <button
                onClick={() => setShowIssues(false)}
                aria-label="Close health panel"
                className="ml-auto p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {graph.issues.length === 0 && (
                <p className="text-xs text-muted-foreground p-2">
                  Nothing to report: every chain reaches its last tier on a fork, no
                  upgrade is gated behind something it can never own.
                </p>
              )}
              {graph.issues.map((issue, i) => {
                const subject = graph.byId.get(issue.nodeIds[0]);
                const style = SEVERITY_STYLE[issue.severity];
                return (
                  <button
                    key={`${issue.kind}-${issue.nodeIds[0]}-${i}`}
                    onClick={() => focusNode(issue.nodeIds[0])}
                    className="w-full text-left p-2 rounded bg-muted/40 hover:bg-muted/70 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      <span className={`text-[10px] uppercase tracking-wide ${style.text}`}>{issue.kind}</span>
                    </div>
                    <div className="text-xs font-medium">{subject?.upgrade.name ?? issue.nodeIds[0]}</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">{issue.message}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Detail panel */}
        {selected && (
          <div className="absolute top-3 right-3 bottom-3 w-80 max-w-[calc(100%-1.5rem)] rounded-lg bg-card/95 border border-border flex flex-col overflow-hidden">
            <div className="flex items-start gap-2 p-3 border-b border-border">
              <div className="flex-1">
                <div className="font-semibold text-sm">{selected.upgrade.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{selected.id}</div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close details"
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              <div className="flex flex-wrap gap-1.5">
                <span className={`px-1.5 py-0.5 rounded ${TIER_COLORS[selected.tier].bg} ${TIER_COLORS[selected.tier].text}`}>
                  {selected.tier}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-muted">{selected.upgrade.cost}h</span>
                <span className="px-1.5 py-0.5 rounded bg-muted">Level {selected.upgrade.unlockLevel ?? 1}</span>
                {(selected.upgrade.tags ?? []).map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-muted" style={{ color: TAG_HEX[tag] }}>
                    {tag}
                  </span>
                ))}
                {selected.upgrade.ascensionOnly && (
                  <span className="px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">ascension only</span>
                )}
              </div>

              <p className="text-muted-foreground leading-snug">{selected.upgrade.description}</p>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="step" value={`${selected.depth + 1}`} />
                <Stat label="of chain" value={`${selected.chainLength}`} />
                <Stat label="to end" value={`${selected.stepsToLeaf}`} />
              </div>

              {selected.upgrade.choiceGroup && (
                <Section title="Fork">
                  <p className="text-muted-foreground leading-snug">
                    One option in <span className="font-mono">{selected.upgrade.choiceGroup}</span>. Buying it
                    locks out the others, and every option costs 50% more for the privilege.
                  </p>
                  {graph.nodes
                    .filter(n => n.upgrade.choiceGroup === selected.upgrade.choiceGroup && n.id !== selected.id)
                    .map(n => <NodeLink key={n.id} node={n} onClick={focusNode} />)}
                </Section>
              )}

              <Section title="Modifiers">
                {Object.entries(selected.upgrade.modifiers ?? {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground truncate">{key}</span>
                    <span className="font-mono text-[11px]">{value}</span>
                  </div>
                ))}
              </Section>

              <Section title={`Requires (${selected.prerequisites.length})`}>
                {selected.prerequisites.length === 0 && (
                  <p className="text-muted-foreground">Nothing. This is a chain head.</p>
                )}
                {selected.prerequisites.map(id => (
                  <NodeLink key={id} node={graph.byId.get(id)!} onClick={focusNode} />
                ))}
              </Section>

              <Section title={`Leads to (${selected.dependents.length})`}>
                {selected.dependents.length === 0 && (
                  <p className="text-muted-foreground">Nothing. This is the end of its line.</p>
                )}
                {selected.dependents.map(id => (
                  <NodeLink key={id} node={graph.byId.get(id)!} onClick={focusNode} />
                ))}
              </Section>

              {(issuesByNode.get(selected.id) ?? []).length > 0 && (
                <Section title="Findings">
                  {(issuesByNode.get(selected.id) ?? []).map((issue, i) => (
                    <div key={i} className="mb-1.5">
                      <span className={`text-[10px] uppercase tracking-wide ${SEVERITY_STYLE[issue.severity].text}`}>
                        {issue.kind}
                      </span>
                      <p className="text-muted-foreground leading-snug">{issue.message}</p>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 py-1.5">
      <div className="font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function NodeLink({ node, onClick }: { node: GraphNode; onClick: (id: string) => void }) {
  return (
    <button
      onClick={() => onClick(node.id)}
      className="w-full text-left flex items-center gap-1.5 py-0.5 hover:text-primary transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TIER_HEX[node.tier] }} />
      <span className="truncate">{node.upgrade.name}</span>
      <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">{node.tier}</span>
    </button>
  );
}

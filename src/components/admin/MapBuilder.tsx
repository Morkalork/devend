import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Save, Trash2, Download, Copy, Check, AlertCircle, Undo2, Redo2 } from 'lucide-react';
import { AreaKind, ColoredArea, LevelConfig, BallConfig, LevelEntity, WallRectEntity, WallCircleEntity, WallPolygonEntity, GravityWell } from '@/types/level';
import { makeColoredArea } from '@/lib/coloredAreas';
import { DEFAULT_MOVER_RANGE, DEFAULT_MOVER_SPEED } from '@/lib/moverPath';
import { MapCanvas } from './MapCanvas';
import type { AddEntityType } from './EntityPanel';
import { EntityPanel } from './EntityPanel';
import { LevelPanel } from './LevelPanel';
import yaml from 'js-yaml';
import { spliceYamlEntries } from '@/lib/yamlSplice';
import {
  createHistory, pushHistory, undo as undoHistory, redo as redoHistory,
  canUndo, canRedo, historyGesture, HISTORY_LIMIT, type History,
} from '@/lib/editHistory';
import type { FenceZone } from '@/lib/physics/fenceZones';
import { PlaytestPanel } from './PlaytestPanel';
import { RotationStrip } from './RotationStrip';
import { MechanicSpreadPanel } from './MechanicSpreadPanel';

interface MapBuilderProps {
  onBack: () => void;
}

export function MapBuilder({ onBack }: MapBuilderProps) {
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  /**
   * Undo history for the ladder. Held beside `levels` rather than replacing it,
   * because every read in this component and both panels goes through `levels`
   * and routing all of them via `history.present` would be a large rewrite for
   * no behavioural gain. The two are kept in step by funnelling every write
   * through commitLevels, which is the only thing allowed to call setLevels
   * after the initial load.
   */
  const [history, setHistory] = useState<History<LevelConfig[]>>(() => createHistory([]));
  const [selectedLevelIndex, setSelectedLevelIndex] = useState<number>(0);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedBallId, setSelectedBallId] = useState<string | null>(null);
  // Colored Areas have no id in the schema, so selection is by index.
  const [selectedAreaIndex, setSelectedAreaIndex] = useState<number | null>(null);
  const [selectedWellIndex, setSelectedWellIndex] = useState<number | null>(null);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /**
   * Does the ladder in memory differ from the one on disk?
   *
   * There was no indication at all, and undo made that actively misleading: it
   * steps the in-memory ladder back but cannot step the FILE back, so after a
   * save-then-undo the two disagreed and the builder said nothing. The Saved
   * tick from a minute ago was still the last thing it had told you.
   *
   * A flag rather than comparing against originalLevels every render: the
   * comparison is 40 levels of geometry, and every edit already funnels through
   * one place that can just say so.
   */
  const [dirty, setDirty] = useState(false);
  // Copy/paste clipboard for objects (walls or balls). Ctrl+C fills it from the
  // current selection, Ctrl+V pastes an offset copy into the current level, so a
  // copy can also be pasted onto a different level.
  const clipboardRef = useRef<
    | { kind: 'entity'; data: LevelEntity }
    | { kind: 'ball'; data: BallConfig }
    | null
  >(null);

  /** The latest ladder, so a commit never resolves against a stale render. */
  const levelsRef = useRef<LevelConfig[]>([]);
  /** map.yml exactly as it is on disk, so a save can be a splice not a rewrite. */
  const rawMapYaml = useRef<string | null>(null);
  /** The levels as parsed from that file, to tell which ones actually changed. */
  const originalLevels = useRef<LevelConfig[]>([]);

  /**
   * Refuse to leave with unsaved geometry.
   *
   * The builder has no autosave and its state is entirely in memory, so a
   * stray refresh costs however long you have been placing walls. Gated on the
   * flag so a clean builder never nags.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Load levels from map.yml
  useEffect(() => {
    const loadLevels = async () => {
      try {
        const response = await fetch('/map.yml', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load map.yml');
        const text = await response.text();
        // Keep the file verbatim: saving splices over the entries that changed
        // rather than re-dumping the document, so the 269 comment lines that
        // carry the whole ladder's design notes survive an edit.
        rawMapYaml.current = text;
        const data = yaml.load(text) as { levels: LevelConfig[] };
        if (!data?.levels || !Array.isArray(data.levels)) {
          throw new Error('Invalid map.yml structure');
        }
        // Issue #37: gameplay no longer stores per-ball configs in map.yml (the
        // game picks ball types from maxBalls). Normalise legacy/missing `balls`
        // to an empty array so the (dev-only) builder UI keeps working.
        const loaded = data.levels.map(l => ({ ...l, balls: l.balls ?? [] }));
        originalLevels.current = JSON.parse(JSON.stringify(loaded)) as LevelConfig[];
        levelsRef.current = loaded;
        setLevels(loaded);
        // Seeded, not pushed: the empty state before a load is not something
        // anyone wants one Ctrl+Z to take them back to.
        setHistory(createHistory(loaded));
        setDirty(false);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load levels');
        setIsLoading(false);
      }
    };
    loadLevels();
  }, []);

  const currentLevel = levels[selectedLevelIndex] || null;

  /**
   * The only way to change the ladder, so nothing can edit it without the
   * history seeing it.
   *
   * `key` names what is being edited ("entity:wall-3"). Consecutive commits
   * with the same key inside the coalesce window are ONE undo step, which is
   * what makes this usable at ten slots: dragging a wall fires an update every
   * pointer move, and without coalescing a single one-second drag would push
   * the whole history out and leave undo stepping backwards a pixel at a time.
   * Structural edits (add, delete, duplicate) pass no key, so each is its own
   * step even in quick succession.
   */
  const commitLevels = useCallback((
    next: LevelConfig[] | ((prev: LevelConfig[]) => LevelConfig[]),
    key?: string,
  ) => {
    // Resolved against a ref rather than inside the setState updater: an
    // updater must stay pure, and two commits in the same tick still need to
    // compose rather than both building on the pre-tick value.
    const resolved = typeof next === 'function' ? next(levelsRef.current) : next;
    levelsRef.current = resolved;
    setLevels(resolved);
    setDirty(true);
    setHistory(h => pushHistory(h, resolved, { key }));
  }, []);

  /** Step the ladder back or forward, and drop selections that no longer
   *  point at anything: undoing an add leaves the added thing selected, and a
   *  panel bound to a missing entity renders nothing with no explanation. */
  const applyHistory = useCallback((step: 'undo' | 'redo') => {
    setHistory(h => {
      const nextHistory = step === 'undo' ? undoHistory(h) : redoHistory(h);
      if (nextHistory === h) return h;
      const restored = nextHistory.present;
      levelsRef.current = restored;
      setLevels(restored);
      // Stepping back in memory cannot step the file back, so an undo after a
      // save leaves the two out of step. That is the case this flag exists for.
      setDirty(true);
      setSelectedLevelIndex(i => Math.min(i, Math.max(0, restored.length - 1)));
      const level = restored[Math.min(selectedLevelIndex, restored.length - 1)];
      setSelectedEntityId(id => (level?.entities || []).some(e => e.id === id) ? id : null);
      setSelectedBallId(id => (level?.balls || []).some(b => b.id === id) ? id : null);
      setSelectedAreaIndex(i => (i !== null && i < (level?.coloredAreas?.length ?? 0)) ? i : null);
      setSelectedWellIndex(i => (i !== null && i < (level?.gravityWells?.length ?? 0)) ? i : null);
      return nextHistory;
    });
  }, [selectedLevelIndex]);

  // Update level in state
  const updateLevel = useCallback((updatedLevel: LevelConfig, key?: string) => {
    commitLevels(prev => prev.map((l, i) =>
      i === selectedLevelIndex ? updatedLevel : l
    ), key);
  }, [selectedLevelIndex, commitLevels]);

  // Create new level
  const createNewLevel = useCallback(() => {
    const newLevel: LevelConfig = {
      id: `level-${levels.length + 1}`,
      level: levels.length + 1,
      sizeThreshold: 40,
      expectedCuts: 5,
      points: 100,
      balls: [{
        id: 'ball-1',
        initialSpeed: 300,
        topSpeed: 600,
        color: '00ff88',
      }],
      entities: [],
    };
    commitLevels(prev => [...prev, newLevel]);
    setSelectedLevelIndex(levels.length);
  }, [levels.length, commitLevels]);

  // Delete current level
  const deleteLevel = useCallback(() => {
    if (levels.length <= 1) return;
    commitLevels(prev => prev.filter((_, i) => i !== selectedLevelIndex));
    setSelectedLevelIndex(Math.max(0, selectedLevelIndex - 1));
  }, [levels.length, selectedLevelIndex, commitLevels]);

  // Duplicate level with suffix (4 → 4b, 4b → 4c, etc.)
  const duplicateLevel = useCallback((index: number) => {
    const source = levels[index];
    if (!source) return;

    // Parse base id and find next available suffix
    const baseMatch = source.id.match(/^(level-\d+)([a-z]?)$/);
    const baseId = baseMatch ? baseMatch[1] : source.id;

    // Collect existing suffixes for this base
    const existingSuffixes = new Set(
      levels
        .map(l => {
          const m = l.id.match(new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-z]?)$`));
          return m ? (m[1] || '') : null;
        })
        .filter((s): s is string => s !== null)
    );

    // Find next suffix: '' → 'b', 'b' → 'c', etc.
    let nextSuffix = 'b';
    while (existingSuffixes.has(nextSuffix)) {
      nextSuffix = String.fromCharCode(nextSuffix.charCodeAt(0) + 1);
    }

    const newLevel: LevelConfig = JSON.parse(JSON.stringify(source));
    newLevel.id = `${baseId}${nextSuffix}`;

    // Insert right after the source level
    commitLevels(prev => [
      ...prev.slice(0, index + 1),
      newLevel,
      ...prev.slice(index + 1),
    ]);
    setSelectedLevelIndex(index + 1);
    setSelectedEntityId(null);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [levels, commitLevels]);

  // Add entity (obstacle)
  const addEntity = useCallback((type: AddEntityType) => {
    if (!currentLevel) return;

    let newEntity: LevelEntity;

    // Movers are placed at their HOME, and patrol home +/- range/2 along the
    // axis. Travel and speed seed from the median of the movers already on the
    // ladder rather than any one map's, and the starting phase is 0 (the
    // left/top extreme) so the start marker sits at one end of the drawn path
    // rather than hidden under the object itself.
    if (type === 'mover-rect' || type === 'mover-circle') {
      const id = `mover-${Date.now()}`;
      const common = {
        kind: 'mover' as const,
        axis: 'horizontal' as const,
        range: DEFAULT_MOVER_RANGE,
        speed: DEFAULT_MOVER_SPEED,
        phase: 0,
      };
      newEntity = type === 'mover-circle'
        ? { id, ...common, shape: 'circle', cx: 450, cy: 450, radius: 40 }
        : { id, ...common, shape: 'rect', x: 400, y: 437, width: 100, height: 26 };
    } else if (type === 'bouncer' || type === 'kicker') {
      // A bumper is a wall with a flag, but it gets its own button: nobody
      // finds a mechanic by placing a circle and then hunting for a checkbox,
      // which is exactly the report this exists to answer. Sized and banked to
      // the shipped defaults so a placed one is immediately a working bumper.
      newEntity = {
        id: `bumper-${Date.now()}`,
        kind: 'wall',
        shape: 'circle',
        cx: 450,
        cy: 450,
        radius: 42,
        bouncer: true,
        ...(type === 'kicker' ? { bounceBearing: 'right' as const } : {}),
      };
    } else if (type === 'launcher') {
      newEntity = {
        id: `launcher-${Date.now()}`,
        kind: 'launcher',
        shape: 'rect',
        x: 330,
        y: 400,
        width: 240,
        // 110, not less: a narrower bore rasterises to a staircase that erodes
        // into disconnected cells and seals its own balls off from the board.
        // See launcherBarrel.test.ts, which pins it.
        height: 110,
        facing: 'right',
      };
    } else if (type === 'cage') {
      newEntity = {
        id: `cage-${Date.now()}`,
        kind: 'cage',
        shape: 'rect',
        x: 360,
        y: 390,
        width: 180,
        height: 180,
        facing: 'up',
        holdSeconds: 12,
      };
    } else if (type === 'box') {
      newEntity = {
        id: `box-${Date.now()}`,
        kind: 'box',
        shape: 'rect',
        x: 360,
        y: 390,
        width: 180,
        height: 180,
        mouth: 'up',
        capacity: 1,
      };
    } else if (type === 'circle') {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'circle',
        cx: 450,
        cy: 800,
        radius: 100,
      };
    } else if (type === 'rect') {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'rect',
        x: 350,
        y: 700,
        width: 200,
        height: 200,
      };
    } else {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'polygon',
        points: [[350, 700], [550, 700], [550, 900], [350, 900]],
      };
    }
    
    // A portal is the one object that is meaningless alone: a lone link is
    // inert by design, so the button places BOTH ends already linked rather
    // than leaving the second one as a step you can forget.
    if (type === 'portal') {
      const link = `p${Date.now().toString(36).slice(-4)}`;
      const mk = (n: number, cx: number, cy: number): LevelEntity => ({
        id: `portal-${Date.now()}-${n}`,
        kind: 'wall', shape: 'circle', cx, cy, radius: 45, portal: link,
      });
      const pair = [mk(1, 250, 250), mk(2, 650, 650)];
      updateLevel({
        ...currentLevel,
        entities: [...(currentLevel.entities || []), ...pair],
      });
      setSelectedEntityId(pair[0].id);
      setSelectedBallId(null);
      setSelectedAreaIndex(null);
      return;
    }

    updateLevel({
      ...currentLevel,
      entities: [...(currentLevel.entities || []), newEntity],
    });
    setSelectedEntityId(newEntity.id);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Add ball
  const addBall = useCallback(() => {
    if (!currentLevel) return;
    
    const newBall: BallConfig = {
      id: `ball-${Date.now()}`,
      initialSpeed: 300,
      topSpeed: 600,
      color: getRandomColor(),
    };
    
    updateLevel({
      ...currentLevel,
      balls: [...currentLevel.balls, newBall],
    });
    setSelectedBallId(newBall.id);
    setSelectedEntityId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Add a Colored Area (win-gate zone). Sized by kind, per the LEVELDESIGN
  // convention: var is easiest so it's drawn biggest, const hardest/smallest.
  const addArea = useCallback((kind: AreaKind) => {
    if (!currentLevel) return;

    const existing = currentLevel.coloredAreas || [];
    updateLevel({ ...currentLevel, coloredAreas: [...existing, makeColoredArea(kind, existing.length)] });
    setSelectedAreaIndex(existing.length);
    setSelectedEntityId(null);
    setSelectedBallId(null);
  }, [currentLevel, updateLevel]);

  // Update a Colored Area by index
  const updateArea = useCallback((index: number, updates: Partial<ColoredArea>) => {
    if (!currentLevel) return;

    updateLevel({
      ...currentLevel,
      coloredAreas: (currentLevel.coloredAreas || []).map((a, i) =>
        i === index ? { ...a, ...updates } : a
      ),
    }, `area:${index}`);
  }, [currentLevel, updateLevel]);

  // Delete a Colored Area by index (drop the key entirely when it was the last)
  const deleteArea = useCallback((index: number) => {
    if (!currentLevel) return;

    const remaining = (currentLevel.coloredAreas || []).filter((_, i) => i !== index);
    const next = { ...currentLevel, coloredAreas: remaining };
    if (remaining.length === 0) delete next.coloredAreas;
    updateLevel(next);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  /**
   * Gravity wells (issue #77). Defaults follow the authoring rule the game
   * enforces: narrow and fierce beats wide and gentle, and a new well starts
   * mid-board rather than near an edge, since a well that pulls into a wall it
   * is sitting against pins balls against it (see pullsIntoWall).
   */
  // ── Fence-speed ground ───────────────────────────────────────────────────
  const addZone = useCallback(() => {
    if (!currentLevel) return;
    const existing = currentLevel.fenceZones || [];
    const offset = existing.length * 30;
    updateLevel({
      ...currentLevel,
      // Starts slow, because that is the interesting direction: fast ground
      // makes a cut safer and slow ground makes it a decision.
      fenceZones: [...existing, {
        x: 300 + offset, y: 300 + offset, width: 240, height: 200, speed: 0.5,
      }],
    });
    setSelectedZoneIndex(existing.length);
    setSelectedWellIndex(null);
    setSelectedAreaIndex(null);
    setSelectedEntityId(null);
    setSelectedBallId(null);
  }, [currentLevel, updateLevel]);

  const updateZone = useCallback((index: number, updates: Partial<FenceZone>) => {
    if (!currentLevel) return;
    updateLevel({
      ...currentLevel,
      fenceZones: (currentLevel.fenceZones || []).map((z, i) =>
        i === index ? { ...z, ...updates } : z),
    });
  }, [currentLevel, updateLevel]);

  const deleteZone = useCallback((index: number) => {
    if (!currentLevel) return;
    updateLevel({
      ...currentLevel,
      fenceZones: (currentLevel.fenceZones || []).filter((_, i) => i !== index),
    });
    setSelectedZoneIndex(null);
  }, [currentLevel, updateLevel]);

  const addWell = useCallback(() => {
    if (!currentLevel) return;
    const existing = currentLevel.gravityWells || [];
    const offset = existing.length * 30;
    updateLevel({
      ...currentLevel,
      gravityWells: [...existing, {
        x: 330 + offset, y: 300 + offset, width: 240, height: 170, turnRate: 2.8,
      }],
    });
    setSelectedWellIndex(existing.length);
    setSelectedAreaIndex(null);
    setSelectedEntityId(null);
    setSelectedBallId(null);
  }, [currentLevel, updateLevel]);

  const updateWell = useCallback((index: number, updates: Partial<GravityWell>) => {
    if (!currentLevel) return;
    updateLevel({
      ...currentLevel,
      gravityWells: (currentLevel.gravityWells || []).map((w, i) => {
        if (i !== index) return w;
        const next = { ...w, ...updates };
        // An `undefined` in `updates` means CLEAR, not "set to undefined": a
        // spread would leave the key present, and the YAML dump turns that into
        // an explicit `activeFrom: null` that reads back as a real value.
        for (const k of Object.keys(updates) as (keyof GravityWell)[]) {
          if (updates[k] === undefined) delete next[k];
        }
        return next;
      }),
    }, `well:${index}`);
  }, [currentLevel, updateLevel]);

  const deleteWell = useCallback((index: number) => {
    if (!currentLevel) return;
    const remaining = (currentLevel.gravityWells || []).filter((_, i) => i !== index);
    const next = { ...currentLevel, gravityWells: remaining };
    if (remaining.length === 0) delete next.gravityWells;
    updateLevel(next);
    setSelectedWellIndex(null);
  }, [currentLevel, updateLevel]);

  // Delete selected entity
  const deleteEntity = useCallback((entityId: string) => {
    if (!currentLevel) return;
    
    updateLevel({
      ...currentLevel,
      entities: (currentLevel.entities || []).filter(e => e.id !== entityId),
    });
    if (selectedEntityId === entityId) {
      setSelectedEntityId(null);
    }
  }, [currentLevel, updateLevel, selectedEntityId]);

  // Duplicate entity (offset copy by 30px)
  const duplicateEntity = useCallback((entityId: string) => {
    if (!currentLevel) return;
    const entity = (currentLevel.entities || []).find(e => e.id === entityId);
    if (!entity) return;

    const newEntity: LevelEntity = JSON.parse(JSON.stringify(entity));
    newEntity.id = `wall-${Date.now()}`;
    // Offset the copy so it's visually distinct
    if (newEntity.shape === 'rect') {
      (newEntity as WallRectEntity).x += 30;
      (newEntity as WallRectEntity).y += 30;
    } else if (newEntity.shape === 'circle') {
      (newEntity as WallCircleEntity).cx += 30;
      (newEntity as WallCircleEntity).cy += 30;
    } else if (newEntity.shape === 'polygon') {
      (newEntity as WallPolygonEntity).points = (newEntity as WallPolygonEntity).points.map(
        ([x, y]) => [x + 30, y + 30],
      );
    }

    updateLevel({
      ...currentLevel,
      entities: [...(currentLevel.entities || []), newEntity],
    });
    setSelectedEntityId(newEntity.id);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Copy the selected object (entity or ball) into the clipboard.
  const copySelection = useCallback(() => {
    if (!currentLevel) return;
    if (selectedEntityId) {
      const entity = (currentLevel.entities || []).find(e => e.id === selectedEntityId);
      if (entity) clipboardRef.current = { kind: 'entity', data: JSON.parse(JSON.stringify(entity)) };
    } else if (selectedBallId) {
      const ball = currentLevel.balls.find(b => b.id === selectedBallId);
      if (ball) clipboardRef.current = { kind: 'ball', data: JSON.parse(JSON.stringify(ball)) };
    }
  }, [currentLevel, selectedEntityId, selectedBallId]);

  // Paste the clipboard object into the current level as a new, offset copy.
  // Repeated pastes cascade (each advances the clipboard position) so they
  // don't stack perfectly on top of one another.
  const pasteClipboard = useCallback(() => {
    if (!currentLevel) return;
    const clip = clipboardRef.current;
    if (!clip) return;

    if (clip.kind === 'entity') {
      const newEntity: LevelEntity = JSON.parse(JSON.stringify(clip.data));
      newEntity.id = `wall-${Date.now()}`;
      // Offset the copy so it's visually distinct from the source.
      if (newEntity.shape === 'rect') {
        (newEntity as WallRectEntity).x += 30;
        (newEntity as WallRectEntity).y += 30;
      } else if (newEntity.shape === 'circle') {
        (newEntity as WallCircleEntity).cx += 30;
        (newEntity as WallCircleEntity).cy += 30;
      } else if (newEntity.shape === 'polygon') {
        (newEntity as WallPolygonEntity).points = (newEntity as WallPolygonEntity).points.map(
          ([x, y]) => [x + 30, y + 30],
        );
      }
      updateLevel({
        ...currentLevel,
        entities: [...(currentLevel.entities || []), newEntity],
      });
      setSelectedEntityId(newEntity.id);
      setSelectedBallId(null);
      // Cascade the next paste from this copy's position.
      clipboardRef.current = { kind: 'entity', data: JSON.parse(JSON.stringify(newEntity)) };
    } else {
      const newBall: BallConfig = JSON.parse(JSON.stringify(clip.data));
      newBall.id = `ball-${Date.now()}`;
      updateLevel({
        ...currentLevel,
        balls: [...currentLevel.balls, newBall],
      });
      setSelectedBallId(newBall.id);
      setSelectedEntityId(null);
    }
  }, [currentLevel, updateLevel]);

  // Delete ball (prevent if last one)
  const deleteBall = useCallback((ballId: string) => {
    if (!currentLevel || currentLevel.balls.length <= 1) return;
    
    updateLevel({
      ...currentLevel,
      balls: currentLevel.balls.filter(b => b.id !== ballId),
    });
    if (selectedBallId === ballId) {
      setSelectedBallId(null);
    }
  }, [currentLevel, updateLevel, selectedBallId]);

  // Update entity
  const updateEntity = useCallback((entityId: string, updates: Partial<LevelEntity>) => {
    if (!currentLevel) return;

    // Keyed on the entity, so a whole drag or a run of keystrokes in a number
    // field is one undo step rather than sixty.
    updateLevel({
      ...currentLevel,
      entities: (currentLevel.entities || []).map(e =>
        e.id === entityId ? { ...e, ...updates } as LevelEntity : e
      ),
    }, `entity:${entityId}`);
  }, [currentLevel, updateLevel]);

  // Update ball
  const updateBall = useCallback((ballId: string, updates: Partial<BallConfig>) => {
    if (!currentLevel) return;

    updateLevel({
      ...currentLevel,
      balls: currentLevel.balls.map(b =>
        b.id === ballId ? { ...b, ...updates } : b
      ),
    }, `ball:${ballId}`);
  }, [currentLevel, updateLevel]);

  // Export YAML
  const exportYaml = useCallback(() => {
    const yamlContent = yaml.dump({ levels }, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map.yml';
    a.click();
    URL.revokeObjectURL(url);
  }, [levels]);

  /**
   * The YAML a save should write.
   *
   * Splices the changed levels over the file we loaded instead of dumping the
   * document. The whole-file dump this replaces deleted all 269 comment lines
   * every time anyone moved a wall, and it did it silently, since the game
   * loads a comment-free map.yml perfectly well. The Playground's editor has
   * spliced for exactly this reason; the builder simply never did.
   *
   * Falls back to the full dump when the raw file is missing or any entry
   * cannot be located unambiguously, which loses comments but never writes a
   * half-spliced file.
   */
  const saveYaml = useCallback((): string => {
    const raw = rawMapYaml.current;
    const fullDump = () => yaml.dump({ levels }, { indent: 2, lineWidth: -1, noRefs: true });
    if (!raw) return fullDump();

    const before = new Map(originalLevels.current.map(l => [String(l.id), JSON.stringify(l)]));
    const changed = levels.filter(l => before.get(String(l.id)) !== JSON.stringify(l));
    // Nothing edited: hand back the file untouched rather than a re-dump that
    // would show up as a whole-file diff for a no-op save.
    if (changed.length === 0) return raw;
    // A level the file does not contain cannot be spliced into it.
    if (changed.some(l => !before.has(String(l.id)))) return fullDump();

    const replacements = changed.map(l => ({
      value: String(l.id),
      // One level, dumped as a sequence of one, so js-yaml produces the "  - "
      // entry shape and indentation the file already uses.
      entry: yaml.dump([l], { indent: 2, lineWidth: -1, noRefs: true })
        .split('\n').map(line => (line ? '  ' + line : line)).join('\n'),
    }));
    return spliceYamlEntries(raw, 'id', replacements) ?? fullDump();
  }, [levels]);

  // Save YAML to server (dev server must be running)
  const saveToServer = useCallback(async () => {
    setSaveStatus('saving');
    const yamlContent = saveYaml();
    try {
      const res = await fetch('/api/map', {
        method: 'PUT',
        body: yamlContent,
        headers: { 'Content-Type': 'text/yaml' },
      });
      setSaveStatus(res.ok ? 'saved' : 'error');
      // The file on disk is now what we just wrote, so a second save splices
      // against it rather than against the version we first loaded.
      if (res.ok) {
        rawMapYaml.current = yamlContent;
        originalLevels.current = JSON.parse(JSON.stringify(levels)) as LevelConfig[];
        setDirty(false);
      }
    } catch {
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus('idle'), 2500);
  }, [levels, saveYaml]);

  // Copy YAML to clipboard
  const copyYaml = useCallback(() => {
    const yamlContent = yaml.dump({ levels }, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    navigator.clipboard.writeText(yamlContent);
    alert('YAML copied to clipboard!');
  }, [levels]);

  // Keyboard shortcuts: Delete/Backspace to remove the selected object, and
  // Ctrl/Cmd+C / Ctrl/Cmd+V to copy and paste it. Typing in a field falls
  // through to native behaviour (so copy/paste there edits the field value).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Undo/redo first: Ctrl+Y would otherwise fall through to nothing, and
      // Ctrl+Shift+Z must not be read as a plain Ctrl+Z.
      const gesture = historyGesture(e);
      if (gesture) {
        e.preventDefault();
        applyHistory(gesture);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'c') {
        if (selectedEntityId || selectedBallId) {
          e.preventDefault();
          copySelection();
        }
      } else if (mod && key === 'v') {
        if (clipboardRef.current) {
          e.preventDefault();
          pasteClipboard();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedEntityId) {
          deleteEntity(selectedEntityId);
        } else if (selectedAreaIndex !== null) {
          deleteArea(selectedAreaIndex);
        } else if (selectedBallId && currentLevel && currentLevel.balls.length > 1) {
          deleteBall(selectedBallId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntityId, selectedBallId, selectedAreaIndex, deleteEntity, deleteBall, deleteArea, currentLevel, copySelection, pasteClipboard, applyHistory]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading levels...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-3 bg-card border-b border-border flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-bold text-primary flex-1">Map Builder</h1>
        {/* Undo / redo. Labelled with how deep the stack currently is, because
            the limit is real: at ten actions the oldest falls off silently, and
            a button that looks available but cannot reach what you wanted is
            worse than one that tells you how far back it goes. */}
        <button
          onClick={() => applyHistory('undo')}
          disabled={!canUndo(history)}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-40 disabled:hover:bg-muted"
          title={canUndo(history)
            ? `Undo (Ctrl+Z) - ${history.past.length} of ${HISTORY_LIMIT} actions kept`
            : 'Nothing to undo'}
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => applyHistory('redo')}
          disabled={!canRedo(history)}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-40 disabled:hover:bg-muted"
          title={canRedo(history) ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo'}
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setSnapToGrid(s => !s)}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            snapToGrid
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          title={snapToGrid ? 'Snap to grid (ON)' : 'Snap to grid (OFF)'}
        >
          Snap
        </button>
        <button
          onClick={copyYaml}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          title="Copy YAML to clipboard"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={exportYaml}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          title="Download YAML"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={saveToServer}
          disabled={saveStatus === 'saving'}
          className={`relative p-2 rounded-lg transition-colors ${
            saveStatus === 'saved'  ? 'bg-green-600 text-white' :
            saveStatus === 'error'  ? 'bg-destructive text-white' :
            'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
          title={
            saveStatus === 'saved'  ? 'Saved!' :
            saveStatus === 'error'  ? 'Save failed - dev server running?' :
            dirty ? 'Unsaved changes - save to disk (requires dev server)' :
            'Saved. Nothing to write.'
          }
        >
          {saveStatus === 'saved'  ? <Check className="w-4 h-4" /> :
           saveStatus === 'error'  ? <AlertCircle className="w-4 h-4" /> :
           <Save className="w-4 h-4" />}
          {/* A dot rather than a colour change: the button already uses colour
              for the save RESULT, and "unsaved" is a different axis from
              "the last write worked". */}
          {dirty && saveStatus === 'idle' && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-background"
              aria-label="Unsaved changes"
            />
          )}
        </button>
      </div>

      {/* Level Selector */}
      <div className="flex-shrink-0 p-2 bg-muted/50 border-b border-border overflow-x-auto">
        <div className="flex gap-2 items-center min-w-max">
          {levels.map((level, index) => (
            <div key={level.id} className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setSelectedLevelIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                className={`px-3 py-1.5 rounded-l text-sm font-medium transition-colors ${
                  index === selectedLevelIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-card/80'
                }`}
              >
                {level.id}
              </button>
              {index === selectedLevelIndex && (
                <button
                  onClick={() => duplicateLevel(index)}
                  className="px-1.5 py-1.5 rounded-r bg-primary/80 text-primary-foreground hover:bg-primary/60 transition-colors"
                  title="Duplicate level"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={createNewLevel}
            className="p-1.5 rounded bg-card hover:bg-card/80 transition-colors"
            title="Add Level"
          >
            <Plus className="w-4 h-4" />
          </button>
          {levels.length > 1 && (
            <button
              onClick={deleteLevel}
              className="p-1.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
              title="Delete Level"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Canvas Area — min-w-0 so the canvas' intrinsic buffer width can't
            push the side panel off-screen (flex items default to min-width:auto). */}
        <div className="flex-1 min-h-0 min-w-0 p-2">
          {currentLevel && (
            <MapCanvas
              level={currentLevel}
              selectedEntityId={selectedEntityId}
              selectedBallId={selectedBallId}
              selectedAreaIndex={selectedAreaIndex}
              selectedWellIndex={selectedWellIndex}
              selectedZoneIndex={selectedZoneIndex}
              onSelectZone={(index) => {
                setSelectedZoneIndex(index);
                setSelectedWellIndex(null);
                setSelectedEntityId(null);
                setSelectedBallId(null);
                setSelectedAreaIndex(null);
              }}
              onUpdateZone={updateZone}
              snapToGrid={snapToGrid}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setSelectedBallId(null);
                setSelectedAreaIndex(null);
                setSelectedWellIndex(null);
              }}
              onSelectBall={(id) => {
                setSelectedBallId(id);
                setSelectedEntityId(null);
                setSelectedAreaIndex(null);
                setSelectedWellIndex(null);
              }}
              onSelectArea={(index) => {
                setSelectedAreaIndex(index);
                setSelectedEntityId(null);
                setSelectedBallId(null);
                setSelectedWellIndex(null);
              }}
              onUpdateEntity={updateEntity}
              onUpdateBall={updateBall}
              onUpdateArea={updateArea}
              onSelectWell={(index) => {
                setSelectedWellIndex(index);
                setSelectedEntityId(null);
                setSelectedBallId(null);
                setSelectedAreaIndex(null);
              }}
              onUpdateWell={updateWell}
            />
          )}
        </div>

        {/* Side Panel */}
        <div className="flex-shrink-0 w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-border bg-card overflow-y-auto max-h-64 lg:max-h-full lg:h-full">
          {currentLevel && (
            <>
              <LevelPanel
                level={currentLevel}
                onUpdateLevel={updateLevel}
              />
              <EntityPanel
                level={currentLevel}
                selectedEntityId={selectedEntityId}
                selectedBallId={selectedBallId}
                selectedAreaIndex={selectedAreaIndex}
                selectedWellIndex={selectedWellIndex}
                selectedZoneIndex={selectedZoneIndex}
                onSelectZone={(index) => {
                  setSelectedZoneIndex(index);
                  setSelectedWellIndex(null);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                onAddZone={addZone}
                onDeleteZone={deleteZone}
                onUpdateZone={updateZone}
                onSelectWell={(index) => {
                  setSelectedWellIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                onAddWell={addWell}
                onDeleteWell={deleteWell}
                onUpdateWell={updateWell}
                onSelectEntity={(id) => {
                  setSelectedEntityId(id);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                onSelectBall={(id) => {
                  setSelectedBallId(id);
                  setSelectedEntityId(null);
                  setSelectedAreaIndex(null);
                }}
                onSelectArea={(index) => {
                  setSelectedAreaIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                }}
                onAddEntity={addEntity}
                onAddBall={addBall}
                onAddArea={addArea}
                onDeleteEntity={deleteEntity}
                onDuplicateEntity={duplicateEntity}
                onDeleteBall={deleteBall}
                onDeleteArea={deleteArea}
                onUpdateEntity={updateEntity}
                onUpdateBall={updateBall}
                onUpdateArea={updateArea}
              />
              {/* The three questions the YAML cannot answer: does it play, what
                  does it look like the other three ways up, and is this idea
                  already everywhere in its act. */}
              <PlaytestPanel level={currentLevel} />
              <RotationStrip level={currentLevel} />
              <MechanicSpreadPanel levels={levels} current={currentLevel} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getRandomColor(): string {
  const colors = ['ff6b6b', '4ecdc4', 'ffd93d', '6bcb77', 'c792ea', '00d4ff', 'ff8c42'];
  return colors[Math.floor(Math.random() * colors.length)];
}

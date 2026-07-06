import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, RotateCcw, X, Layers, Save, Check, AlertCircle, ChevronRight, Circle, Plus, Trash2 } from 'lucide-react';
import yaml from 'js-yaml';
import { GameScreen } from '@/components/game/GameScreen';
import { GameModifiers, useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useColorProgression } from '@/hooks/useColorProgression';
import { LevelConfig, LevelData, LevelEntity, BallConfig, WallRectEntity, WallCircleEntity, WallPolygonEntity } from '@/types/level';
import { BallTypeDef, getAllBallTypes, loadBallTypes, selectBallTypesForMap } from '@/lib/ballTypes';
import { LevelPanel } from './LevelPanel';
import { EntityPanel } from './EntityPanel';

interface PlaygroundScreenProps {
  onBack: () => void;
  accentColor?: string;
}

// ─── Modifier metadata ────────────────────────────────────────────────────────

type ModifierMeta = {
  label: string;
  kind: 'multiplicative' | 'additive';
  step: number;
  min: number;
  defaultValue: number;
  description: string;
};

const MODIFIER_META: Record<keyof GameModifiers, ModifierMeta> = {
  ballSpeedMultiplier:              { label: 'Ball Speed',             kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies ball movement speed (< 1 = slower)' },
  ballSizeMultiplier:               { label: 'Ball Size',              kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies ball radius (< 1 = smaller)' },
  fenceGenerationSpeedMultiplier:   { label: 'Fence Gen Speed',        kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies how fast fences grow (> 1 = faster)' },
  scoreMultiplier:                  { label: 'Score (OT) Mult.',       kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies overtime hours earned per map' },
  instantFencesPerMap:              { label: 'Instant Fences',         kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Fences that generate instantly at map start' },
  additionalConcurrentFences:       { label: 'Extra Concurrent',       kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Additional fences that can grow simultaneously' },
  bonusRemovalChance:               { label: 'Bonus Remove Chance',    kind: 'additive',       step: 0.05, min: 0,    defaultValue: 0,    description: 'Probability a fence triggers a bonus area removal (0–1)' },
  bonusRemovalAmount:               { label: 'Bonus Remove Amount',    kind: 'additive',       step: 0.05, min: 0,    defaultValue: 0,    description: 'Extra area removed when bonus triggers (fraction, 0–1)' },
  extraLives:                       { label: 'Extra Lives',            kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Extra lives granted immediately' },
  scoreInterestRate:                { label: 'Score Interest Rate',    kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Fraction of score added as interest between maps' },
  extraShopItems:                   { label: 'Extra Shop Slots',       kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Additional item slots in the upgrade shop' },
  shopRestockCount:                 { label: 'Shop Restocks',          kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Purchases per shop visit that refill their slot with a new offer' },
  extraCertificateHours:          { label: 'Extra Cert. Hours',      kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Bonus Certificate Hours banked when the run ends' },
  microManagerPerLock:              { label: 'MicroManager/Lock',      kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Speed reduction per locked ball (0.01 = 1%, max 50%)' },
  ballPathPredictionBounces:        { label: 'Path Preview Bounces',   kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'SCRUM Master: bounces ahead to preview (0 = off)' },
  ballPathPredictionBalls:          { label: 'Path Preview Balls',     kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'SCRUM Master: fastest N balls to track (≥100 = all, 0 = off)' },
  shopDiscountMultiplier:           { label: 'Shop Discount',          kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies upgrade-shop prices (< 1 = cheaper)' },
  pushBonusMultiplier:              { label: 'Push Bonus Mult.',       kind: 'multiplicative', step: 0.25, min: 0.25, defaultValue: 1,    description: 'Multiplies push-your-luck chunk payouts' },
  startingCapturePercent:           { label: 'Starting Capture %',     kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Board starts with this % already captured (max 40)' },
  fenceDurabilityBonus:             { label: 'Fence Durability +',     kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Extra ball hits Ascension fences survive (no effect outside Ascension)' },
  ballFreezeDuration:               { label: 'Feature Freeze (s)',     kind: 'additive',       step: 2,    min: 0,    defaultValue: 0,    description: 'Feature Freeze: seconds a tapped ball stays frozen (0 = off)' },
  ballFreezeCount:                  { label: 'Cascade Freeze (+balls)',kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Cascade Freeze: extra nearby balls frozen per tap (total = 1 + this)' },
  autoFreezeDuration:               { label: 'Cron Job (s)',           kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Cron Job: seconds an auto-frozen ball stays frozen, fired every 10s (0 = off)' },
};

const MULTIPLICATIVE_KEYS = Object.entries(MODIFIER_META)
  .filter(([, m]) => m.kind === 'multiplicative')
  .map(([k]) => k as keyof GameModifiers);

const ADDITIVE_KEYS = Object.entries(MODIFIER_META)
  .filter(([, m]) => m.kind === 'additive')
  .map(([k]) => k as keyof GameModifiers);

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ModifierValues = Partial<Record<keyof GameModifiers, number>>;

function isDefaultValue(key: keyof GameModifiers, value: number): boolean {
  return value === MODIFIER_META[key].defaultValue;
}

function countActive(values: ModifierValues): number {
  return Object.entries(values).filter(
    ([k, v]) => v !== undefined && !isDefaultValue(k as keyof GameModifiers, v)
  ).length;
}

function toBonuses(values: ModifierValues): Partial<Record<keyof GameModifiers, number>> | undefined {
  const result: Partial<Record<keyof GameModifiers, number>> = {};
  for (const [k, v] of Object.entries(values)) {
    const key = k as keyof GameModifiers;
    if (v !== undefined && !isDefaultValue(key, v)) result[key] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ─── Default playground level ─────────────────────────────────────────────────

const PLAYGROUND_LEVEL: LevelConfig = {
  id: 'playground',
  level: 1,
  sizeThreshold: 5,
  expectedCuts: 10,
  points: 100,
  balls: [
    { id: 'test-1', initialSpeed: 80, topSpeed: 80, color: 'ff4444' },
    { id: 'test-2', initialSpeed: 70, topSpeed: 70, color: '4488ff' },
    { id: 'test-3', initialSpeed: 60, topSpeed: 60, color: '44ff44' },
  ],
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PlaygroundScreen({ onBack, accentColor = '#00ff88' }: PlaygroundScreenProps) {
  // `applied` drives the game — only changes on Apply / Reset
  const [applied, setApplied] = useState<ModifierValues>({});
  // `draft` is live editing state inside the modal
  const [draft, setDraft] = useState<ModifierValues>({});
  const [gameKey, setGameKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // Level picker
  const [allLevels, setAllLevels] = useState<LevelConfig[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<LevelConfig | null>(null);
  const [levelPickerOpen, setLevelPickerOpen] = useState(false);

  // Ball picker — explicit ball-type override for trying balls out.
  // null = no override (use the level's default selection); [] = explicitly no
  // balls; non-empty = exactly those balls.
  const [ballCatalog, setBallCatalog] = useState<BallTypeDef[]>(getAllBallTypes());
  const [ballTypeIds, setBallTypeIds] = useState<string[] | null>(null);
  const [ballPickerOpen, setBallPickerOpen] = useState(false);
  const [showBallSpeeds, setShowBallSpeeds] = useState(false);
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  // Dev: on clear, play the desaturation drain then freeze on the drained frame;
  // click the board to reload. `frozen` arms the click-to-reload catcher.
  const [freezeOnClear, setFreezeOnClear] = useState(false);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    fetch('/map.yml')
      .then(r => r.text())
      .then(text => {
        const data = yaml.load(text) as LevelData;
        // Migrated maps have no `balls` array (the game derives them). Normalise
        // so the legacy entity/ball editor panels don't choke on `undefined`.
        if (data?.levels) setAllLevels(data.levels.map(l => ({ ...l, balls: l.balls ?? [] })));
      })
      .catch(() => {/* silently ignore */});
    // Load the ball catalogue (balls.yml) so the picker lists the latest types,
    // then restart so the running game reflects the loaded catalogue.
    loadBallTypes().then(() => { setBallCatalog([...getAllBallTypes()]); setGameKey(k => k + 1); });
  }, []);

  // The level the game is running (base for the ball override below).
  const baseLevel = selectedLevel ?? PLAYGROUND_LEVEL;

  // The balls the game spawns by default for this level (same deterministic
  // selection the real game uses) — what the picker shows when there's no
  // explicit override yet, so adding appends instead of replacing.
  const defaultBallIds = useMemo(
    () => selectBallTypesForMap(
      baseLevel.id,
      baseLevel.level,
      baseLevel.maxBalls ?? baseLevel.balls?.length ?? 1,
    ).map(t => t.id),
    // selectBallTypesForMap reads the module-level catalogue, which balls.yml
    // mutates on load; ballCatalog is the render signal that it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseLevel, ballCatalog],
  );

  // What's actually in play: the user's explicit override (which may be empty =
  // no balls), or the level default when there's no override yet.
  const effectiveBallIds = ballTypeIds ?? defaultBallIds;

  const addBallType = useCallback((id: string) => {
    setBallTypeIds([...effectiveBallIds, id]);
    setGameKey(k => k + 1);
  }, [effectiveBallIds]);

  const removeBallTypeAt = useCallback((index: number) => {
    // Removing leaves an explicit list — it may become empty (no balls), which
    // is intentional and does NOT revert to the default.
    setBallTypeIds(effectiveBallIds.filter((_, i) => i !== index));
    setGameKey(k => k + 1);
  }, [effectiveBallIds]);

  // Reset back to the level's default ball selection (drops the override).
  const clearBallTypes = useCallback(() => {
    setBallTypeIds(null);
    setGameKey(k => k + 1);
  }, []);

  // Level editor panel
  const [editDraft, setEditDraft] = useState<LevelConfig | null>(null);
  const [editEntityId, setEditEntityId] = useState<string | null>(null);
  const [editBallId, setEditBallId] = useState<string | null>(null);
  const [editSaveStatus, setEditSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Sync draft whenever the selected level changes (new level picked)
  useEffect(() => {
    if (selectedLevel) {
      setEditDraft(JSON.parse(JSON.stringify(selectedLevel)));
      setEditEntityId(null);
      setEditBallId(null);
    } else {
      setEditDraft(null);
    }
    // Depend on the level ID, not the object reference: editDraft is mutated
    // in place by the editor panels, and we only want to reset it when the
    // user actually switches to a different level, not on every local edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLevel?.id]);

  const updateEditLevel = useCallback((updated: LevelConfig) => {
    setEditDraft(updated);
  }, []);

  const addEditEntity = useCallback((type: 'circle' | 'polygon' | 'rect') => {
    setEditDraft(prev => {
      if (!prev) return prev;
      let entity: LevelEntity;
      if (type === 'circle') entity = { id: `wall-${Date.now()}`, kind: 'wall', shape: 'circle', cx: 450, cy: 800, radius: 100 };
      else if (type === 'rect') entity = { id: `wall-${Date.now()}`, kind: 'wall', shape: 'rect', x: 350, y: 700, width: 200, height: 200 };
      else entity = { id: `wall-${Date.now()}`, kind: 'wall', shape: 'polygon', points: [[350,700],[550,700],[550,900],[350,900]] };
      setEditEntityId(entity.id);
      setEditBallId(null);
      return { ...prev, entities: [...(prev.entities || []), entity] };
    });
  }, []);

  const addEditBall = useCallback(() => {
    setEditDraft(prev => {
      if (!prev) return prev;
      const colors = ['ff6b6b', '4ecdc4', 'ffd93d', '6bcb77', 'c792ea', '00d4ff', 'ff8c42'];
      const ball: BallConfig = {
        id: `ball-${Date.now()}`,
        initialSpeed: 300,
        topSpeed: 600,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
      setEditBallId(ball.id);
      setEditEntityId(null);
      return { ...prev, balls: [...prev.balls, ball] };
    });
  }, []);

  const deleteEditEntity = useCallback((id: string) => {
    setEditDraft(prev => {
      if (!prev) return prev;
      if (editEntityId === id) setEditEntityId(null);
      return { ...prev, entities: (prev.entities || []).filter(e => e.id !== id) };
    });
  }, [editEntityId]);

  const duplicateEditEntity = useCallback((id: string) => {
    setEditDraft(prev => {
      if (!prev) return prev;
      const entity = (prev.entities || []).find(e => e.id === id);
      if (!entity) return prev;
      const copy: LevelEntity = JSON.parse(JSON.stringify(entity));
      copy.id = `wall-${Date.now()}`;
      if (copy.shape === 'rect') { (copy as WallRectEntity).x += 30; (copy as WallRectEntity).y += 30; }
      else if (copy.shape === 'circle') { (copy as WallCircleEntity).cx += 30; (copy as WallCircleEntity).cy += 30; }
      else if (copy.shape === 'polygon') { (copy as WallPolygonEntity).points = (copy as WallPolygonEntity).points.map(([x, y]) => [x + 30, y + 30]); }
      setEditEntityId(copy.id);
      return { ...prev, entities: [...(prev.entities || []), copy] };
    });
  }, []);

  const deleteEditBall = useCallback((id: string) => {
    setEditDraft(prev => {
      if (!prev || prev.balls.length <= 1) return prev;
      if (editBallId === id) setEditBallId(null);
      return { ...prev, balls: prev.balls.filter(b => b.id !== id) };
    });
  }, [editBallId]);

  const updateEditEntity = useCallback((id: string, updates: Partial<LevelEntity>) => {
    setEditDraft(prev => {
      if (!prev) return prev;
      return { ...prev, entities: (prev.entities || []).map(e => e.id === id ? { ...e, ...updates } as LevelEntity : e) };
    });
  }, []);

  const updateEditBall = useCallback((id: string, updates: Partial<BallConfig>) => {
    setEditDraft(prev => {
      if (!prev) return prev;
      return { ...prev, balls: prev.balls.map(b => b.id === id ? { ...b, ...updates } : b) };
    });
  }, []);

  const applyEdits = useCallback(() => {
    if (!editDraft) return;
    const updated = editDraft;
    setSelectedLevel(updated);
    setAllLevels(prev => prev.map(l => l.id === updated.id ? updated : l));
    setGameKey(k => k + 1);
  }, [editDraft]);

  const saveEditsToDisk = useCallback(async () => {
    if (!editDraft) return;
    setEditSaveStatus('saving');
    const updated = editDraft;
    const nextLevels = allLevels.map(l => l.id === updated.id ? updated : l);
    const yamlContent = yaml.dump({ levels: nextLevels }, { indent: 2, lineWidth: -1, noRefs: true });
    try {
      const res = await fetch('/api/map', {
        method: 'PUT',
        body: yamlContent,
        headers: { 'Content-Type': 'text/yaml' },
      });
      if (res.ok) {
        setSelectedLevel(updated);
        setAllLevels(nextLevels);
        setGameKey(k => k + 1);
        setEditSaveStatus('saved');
        setTimeout(() => setEditSaveStatus('idle'), 1200);
      } else {
        setEditSaveStatus('error');
        setTimeout(() => setEditSaveStatus('idle'), 2500);
      }
    } catch {
      setEditSaveStatus('error');
      setTimeout(() => setEditSaveStatus('idle'), 2500);
    }
  }, [editDraft, allLevels]);

  const openModal = useCallback(() => {
    setDraft(applied); // seed draft from currently applied values
    setModalOpen(true);
  }, [applied]);

  const closeModal = useCallback(() => {
    if (JSON.stringify(draft) !== JSON.stringify(applied)) {
      setApplied(draft);
      setGameKey(k => k + 1);
    }
    setModalOpen(false);
  }, [draft, applied]);

  const resetAll = useCallback(() => {
    setDraft({});
  }, []);

  const hardReset = useCallback(() => {
    setApplied({});
    setDraft({});
    setSelectedLevel(null);
    setGameKey(k => k + 1);
  }, []);

  const goToNextLevel = useCallback(() => {
    if (allLevels.length === 0) return;
    if (!selectedLevel) {
      setSelectedLevel(allLevels[0]);
    } else {
      const idx = allLevels.findIndex(l => l.id === selectedLevel.id);
      setSelectedLevel(allLevels[(idx + 1) % allLevels.length]);
    }
    setGameKey(k => k + 1);
  }, [allLevels, selectedLevel]);

  const getDraftValue = useCallback((key: keyof GameModifiers): number => {
    return draft[key] ?? MODIFIER_META[key].defaultValue;
  }, [draft]);

  const setDraftValue = useCallback((key: keyof GameModifiers, raw: string) => {
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    setDraft(prev => ({ ...prev, [key]: num }));
  }, []);

  const resetDraftKey = useCallback((key: keyof GameModifiers) => {
    setDraft(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const draftActiveCount = countActive(draft);
  const appliedActiveCount = countActive(applied);

  const achievementBonuses = toBonuses(applied);
  const activeModifiers = useActiveModifiers([], [], achievementBonuses);
  // The game always spawns exactly the effective ball list (override or default),
  // so the picker and the running game never disagree.
  const activeLevel = useMemo<LevelConfig>(
    () => ({ ...baseLevel, ballTypeIds: effectiveBallIds, maxBalls: effectiveBallIds.length }),
    [baseLevel, effectiveBallIds],
  );
  const { accentHex: levelAccent } = useColorProgression(activeLevel.level);
  const accent = levelAccent;

  return (
    <div className="fixed inset-0 bg-background flex flex-row">

      {/* ── Game pane ── transform containment makes GameScreen's fixed children relative to this div */}
      <div style={{ flex: 1, overflow: 'hidden', transform: 'translateZ(0)', position: 'relative' }}>
        <GameScreen
          key={gameKey}
          level={activeLevel}
          levelNumber={activeLevel.level}
          totalLevels={1}
          totalScore={0}
          ownedUpgradeIds={[]}
          upgrades={[]}
          lives={99}
          onLivesChange={() => {}}
          onGameEnd={onBack}
          onLevelComplete={() => setGameKey(k => k + 1)}
          freezeOnClear={freezeOnClear}
          onMapComplete={() => { if (freezeOnClear) setFrozen(true); }}
          onMainMenu={onBack}
          onRestart={hardReset}
          accentColor={accent}
          achievementBonuses={achievementBonuses}
          activeModifiers={activeModifiers}
          showBallSpeeds={showBallSpeeds}
          showPerfOverlay={showPerfOverlay}
        />

        {/* Dev: freeze-on-clear toggle (always visible) */}
        <button
          onClick={() => setFreezeOnClear(v => !v)}
          title="On clear, play the desaturation drain then freeze; click the board to reload"
          className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg transition-opacity hover:opacity-90"
          style={{
            zIndex: 50,
            backgroundColor: freezeOnClear ? `${accent}1a` : '#1a1f1a',
            border: `1px solid ${freezeOnClear ? `${accent}55` : 'rgba(255,255,255,0.12)'}`,
          }}
        >
          <span className="text-xs font-semibold" style={{ color: freezeOnClear ? accent : 'hsl(var(--foreground))' }}>
            Freeze on clear
          </span>
          <span
            className="relative inline-flex items-center rounded-full transition-colors"
            style={{ width: 36, height: 20, backgroundColor: freezeOnClear ? accent : 'rgba(255,255,255,0.15)' }}
          >
            <span className="absolute rounded-full bg-white transition-all" style={{ width: 14, height: 14, top: 3, left: freezeOnClear ? 19 : 3 }} />
          </span>
        </button>

        {/* Dev: click anywhere on the frozen drained board to reload the map */}
        {frozen && (
          <div
            onClick={() => { setFrozen(false); setGameKey(k => k + 1); }}
            className="absolute inset-0 flex items-end justify-center pb-12 cursor-pointer"
            style={{ zIndex: 40 }}
          >
            <span
              className="px-3 py-1.5 rounded-full text-xs font-semibold animate-pulse"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
            >
              Click to reload
            </span>
          </div>
        )}

        {/* Controls overlay — only visible when a level is selected (floating toolbar handles the no-level case) */}
        {selectedLevel && <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={hardReset}
            title="Reset game"
            className="flex items-center justify-center w-9 h-9 rounded-lg shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#ef4444', color: '#fff' }}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLevelPickerOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
            style={{
              backgroundColor: selectedLevel ? '#a855f722' : '#1a1f1a',
              color: selectedLevel ? '#a855f7' : accent,
              border: `1px solid ${selectedLevel ? '#a855f7' : accent}55`,
            }}
          >
            <Layers className="w-4 h-4" />
            {selectedLevel ? `L${selectedLevel.level}: ${selectedLevel.id}` : 'Level'}
          </button>
          <button
            onClick={goToNextLevel}
            title="Next level"
            className="flex items-center justify-center w-9 h-9 rounded-lg shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1a1f1a', color: accent, border: `1px solid ${accent}55` }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setBallPickerOpen(true)}
            title="Balls"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg shadow-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1a1f1a', color: accent, border: `1px solid ${accent}55` }}
          >
            <Circle className="w-4 h-4" /> Balls
            {ballTypeIds !== null && (
              <span className="bg-black/30 px-1.5 rounded-full text-[10px] font-bold">{effectiveBallIds.length}</span>
            )}
          </button>
        </div>}
      </div>

      {/* ── Level sidebar (always visible when a real level is selected) ── */}
      {selectedLevel && editDraft && (
        <div
          className="flex flex-col flex-shrink-0"
          style={{
            width: 320,
            backgroundColor: '#0a0f0a',
            borderLeft: '1px solid #a855f733',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
            style={{ borderBottom: '1px solid #a855f722' }}
          >
            <Layers className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#a855f7' }} />
            <span
              className="flex-1 min-w-0 text-xs font-bold truncate"
              style={{ fontFamily: 'Orbitron, sans-serif', color: '#a855f7' }}
            >
              L{selectedLevel.level}: {selectedLevel.id}
            </span>
          </div>

          {/* Scrollable body: LevelPanel + EntityPanel */}
          <div className="flex-1 overflow-y-auto">
            <LevelPanel level={editDraft} onUpdateLevel={updateEditLevel} />
            <EntityPanel
              level={editDraft}
              selectedEntityId={editEntityId}
              selectedBallId={editBallId}
              onSelectEntity={id => { setEditEntityId(id); setEditBallId(null); }}
              onSelectBall={id => { setEditBallId(id); setEditEntityId(null); }}
              onAddEntity={addEditEntity}
              onAddBall={addEditBall}
              onDeleteEntity={deleteEditEntity}
              onDuplicateEntity={duplicateEditEntity}
              onDeleteBall={deleteEditBall}
              onUpdateEntity={updateEditEntity}
              onUpdateBall={updateEditBall}
            />
          </div>

          {/* Footer */}
          <div
            className="flex-shrink-0 p-3 flex flex-col gap-2"
            style={{ borderTop: '1px solid #a855f722' }}
          >
            <button
              onClick={saveEditsToDisk}
              disabled={editSaveStatus === 'saving'}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-semibold"
              style={{
                backgroundColor:
                  editSaveStatus === 'saved'  ? '#16a34a' :
                  editSaveStatus === 'error'  ? '#dc2626' :
                  '#a855f7',
                color: '#fff',
              }}
            >
              {editSaveStatus === 'saved'  ? <><Check className="w-4 h-4" /> Saved!</> :
               editSaveStatus === 'error'  ? <><AlertCircle className="w-4 h-4" /> Failed - dev server running?</> :
               editSaveStatus === 'saving' ? 'Saving…' :
               <><Save className="w-4 h-4" /> Save to disk</>}
            </button>
            <div className="flex gap-2">
              <button
                onClick={applyEdits}
                className="flex-1 py-2 rounded-lg text-xs font-semibold"
                style={{ backgroundColor: '#1a1f1a', color: '#a855f7', border: '1px solid #a855f733' }}
              >
                Apply &amp; Restart
              </button>
              <button
                onClick={openModal}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                style={{ backgroundColor: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Mods
                {appliedActiveCount > 0 && (
                  <span className="ml-0.5 bg-black/30 px-1 rounded-full text-[10px] font-bold">
                    {appliedActiveCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating toolbar (only when in default playground mode, no level selected) ── */}
      {!selectedLevel && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
          <button
            onClick={hardReset}
            title="Reset game & modifiers"
            className="flex items-center justify-center w-9 h-9 rounded-lg font-semibold shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#ef4444', color: '#fff' }}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLevelPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1a1f1a', color: accent, border: `1px solid ${accent}55` }}
          >
            <Layers className="w-4 h-4" />
            Level
          </button>
          <button
            onClick={goToNextLevel}
            title="Next level"
            className="flex items-center justify-center w-9 h-9 rounded-lg shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1a1f1a', color: accent, border: `1px solid ${accent}55` }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setBallPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1a1f1a', color: accent, border: `1px solid ${accent}55` }}
          >
            <Circle className="w-4 h-4" />
            Balls
            {ballTypeIds !== null && (
              <span className="ml-1 bg-black/30 px-1.5 py-0.5 rounded-full text-xs font-bold">{effectiveBallIds.length}</span>
            )}
          </button>
          <button
            onClick={openModal}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: accent, color: '#000', boxShadow: `0 0 16px ${accent}66` }}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Modifiers
            {appliedActiveCount > 0 && (
              <span className="ml-1 bg-black/30 px-1.5 py-0.5 rounded-full text-xs font-bold">
                {appliedActiveCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Level picker modal */}
      <AnimatePresence>
        {levelPickerOpen && (
          <motion.div
            key="level-picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
            onClick={() => setLevelPickerOpen(false)}
          >
            <motion.div
              key="level-picker-panel"
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm max-h-[80vh] rounded-xl overflow-hidden flex flex-col"
              style={{
                backgroundColor: '#0a0f0a',
                border: '1px solid #a855f755',
                boxShadow: '0 0 40px #a855f722',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid #a855f733' }}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4" style={{ color: '#a855f7' }} />
                  <span
                    className="font-black tracking-widest uppercase text-sm"
                    style={{ fontFamily: 'Orbitron, sans-serif', color: '#a855f7' }}
                  >
                    Pick a Level
                  </span>
                </div>
                <button onClick={() => setLevelPickerOpen(false)}>
                  <X className="w-5 h-5" style={{ color: '#a855f799' }} />
                </button>
              </div>

              {/* Level list */}
              <div className="overflow-y-auto flex-1 px-3 py-3 space-y-1">
                {/* Playground default */}
                <button
                  className="w-full text-left px-3 py-2 rounded-lg transition-colors"
                  style={{
                    backgroundColor: !selectedLevel ? '#a855f722' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${!selectedLevel ? '#a855f755' : 'rgba(255,255,255,0.06)'}`,
                  }}
                  onClick={() => { setSelectedLevel(null); setGameKey(k => k + 1); setLevelPickerOpen(false); }}
                >
                  <div className="text-xs font-semibold" style={{ color: !selectedLevel ? '#a855f7' : 'hsl(var(--muted-foreground))' }}>
                    Playground (default)
                  </div>
                  <div className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.6)', fontFamily: "'JetBrains Mono', monospace" }}>
                    3 balls · threshold 5%
                  </div>
                </button>

                {allLevels.map(lvl => {
                  const isActive = selectedLevel?.id === lvl.id;
                  return (
                    <button
                      key={lvl.id}
                      className="w-full text-left px-3 py-2 rounded-lg transition-colors"
                      style={{
                        backgroundColor: isActive ? '#a855f722' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${isActive ? '#a855f755' : 'rgba(255,255,255,0.06)'}`,
                      }}
                      onClick={() => { setSelectedLevel(lvl); setGameKey(k => k + 1); setLevelPickerOpen(false); }}
                    >
                      <div className="text-xs font-semibold" style={{ color: isActive ? '#a855f7' : 'hsl(var(--foreground))' }}>
                        L{lvl.level}: {lvl.id}
                      </div>
                      <div className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.6)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {(() => { const n = lvl.maxBalls ?? lvl.balls?.length ?? 0; return `max ${n} ball${n !== 1 ? 's' : ''}`; })()} · threshold {lvl.sizeThreshold}%
                        {lvl.entities?.length ? ` · ${lvl.entities.length} entity` : ''}
                      </div>
                    </button>
                  );
                })}

                {allLevels.length === 0 && (
                  <div className="text-xs text-center py-4" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Loading levels…
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ball picker modal */}
      <AnimatePresence>
        {ballPickerOpen && (
          <motion.div
            key="ball-picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
            onClick={() => setBallPickerOpen(false)}
          >
            <motion.div
              key="ball-picker-panel"
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md max-h-[85vh] rounded-xl overflow-hidden flex flex-col"
              style={{ backgroundColor: '#0a0f0a', border: `1px solid ${accent}55`, boxShadow: `0 0 40px ${accent}22` }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${accent}33` }}>
                <div className="flex items-center gap-2">
                  <Circle className="w-4 h-4" style={{ color: accent }} />
                  <span className="font-black tracking-widest uppercase text-sm" style={{ fontFamily: 'Orbitron, sans-serif', color: accent }}>
                    Balls
                  </span>
                </div>
                <button onClick={() => setBallPickerOpen(false)}>
                  <X className="w-5 h-5" style={{ color: `${accent}99` }} />
                </button>
              </div>

              {/* Show-speeds toggle */}
              <div className="px-5 pt-4 flex-shrink-0">
                <button
                  onClick={() => setShowBallSpeeds(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: showBallSpeeds ? `${accent}1a` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${showBallSpeeds ? `${accent}55` : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  <span className="text-xs font-semibold" style={{ color: showBallSpeeds ? accent : 'hsl(var(--foreground))' }}>
                    Show ball speeds
                  </span>
                  <span
                    className="relative inline-flex items-center rounded-full transition-colors"
                    style={{ width: 36, height: 20, backgroundColor: showBallSpeeds ? accent : 'rgba(255,255,255,0.15)' }}
                  >
                    <span
                      className="absolute rounded-full bg-white transition-all"
                      style={{ width: 14, height: 14, top: 3, left: showBallSpeeds ? 19 : 3 }}
                    />
                  </span>
                </button>
              </div>

              {/* Perf-overlay toggle (frame-timing HUD) */}
              <div className="px-5 pt-3 flex-shrink-0">
                <button
                  onClick={() => setShowPerfOverlay(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: showPerfOverlay ? `${accent}1a` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${showPerfOverlay ? `${accent}55` : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  <span className="text-xs font-semibold" style={{ color: showPerfOverlay ? accent : 'hsl(var(--foreground))' }}>
                    Show perf overlay
                  </span>
                  <span
                    className="relative inline-flex items-center rounded-full transition-colors"
                    style={{ width: 36, height: 20, backgroundColor: showPerfOverlay ? accent : 'rgba(255,255,255,0.15)' }}
                  >
                    <span
                      className="absolute rounded-full bg-white transition-all"
                      style={{ width: 14, height: 14, top: 3, left: showPerfOverlay ? 19 : 3 }}
                    />
                  </span>
                </button>
              </div>

              {/* In-play balls (override if set, otherwise the level default) */}
              <div className="px-5 pt-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: `${accent}99`, fontFamily: 'Orbitron, sans-serif' }}>
                    In play ({effectiveBallIds.length}){ballTypeIds === null ? ' · level default' : ''}
                  </span>
                  {ballTypeIds !== null && (
                    <button onClick={clearBallTypes} className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#ef4444', border: '1px solid #ef444433' }}>
                      Reset to default
                    </button>
                  )}
                </div>
                {effectiveBallIds.length === 0 && (
                  <div className="text-[11px] mb-3" style={{ color: 'hsl(var(--muted-foreground) / 0.7)', fontFamily: "'JetBrains Mono', monospace" }}>
                    No balls - add some below, or Reset to default.
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mb-3">
                  {effectiveBallIds.map((id, i) => {
                    const t = ballCatalog.find(b => b.id === id);
                    return (
                      <button
                        key={`${id}-${i}`}
                        onClick={() => removeBallTypeAt(i)}
                        title="Remove"
                        className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full text-xs"
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}
                      >
                        <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: t?.color ?? '#888', boxShadow: `0 0 6px ${t?.color ?? '#888'}` }} />
                        <span style={{ color: 'hsl(var(--foreground))' }}>{t?.name ?? id}</span>
                        <X className="w-3 h-3" style={{ color: '#ef4444' }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Catalogue */}
              <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-1.5">
                {ballCatalog.map(ball => (
                  <div
                    key={ball.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <span
                      className="flex-shrink-0 w-7 h-7 rounded-full"
                      style={{ backgroundColor: ball.color, boxShadow: `0 0 10px ${ball.color}, inset -2px -2px 4px rgba(0,0,0,0.4)`, border: '1px solid rgba(255,255,255,0.2)' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'hsl(var(--foreground))' }}>
                        {ball.name}
                        {ball.phase2 && <span className="text-[9px] px-1 rounded" style={{ color: '#f59e0b', border: '1px solid #f59e0b55' }}>WIP</span>}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: 'hsl(var(--muted-foreground) / 0.7)', fontFamily: "'JetBrains Mono', monospace" }}>
                        spd {ball.baseSpeed} · L{ball.unlockLevel} · ×{ball.lockMultiplier} · {ball.ability}
                      </div>
                    </div>
                    <button
                      onClick={() => addBallType(ball.id)}
                      title={`Add ${ball.name}`}
                      className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0"
                      style={{ backgroundColor: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {ballCatalog.length === 0 && (
                  <div className="text-xs text-center py-4" style={{ color: 'hsl(var(--muted-foreground))' }}>Loading balls…</div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 flex-shrink-0 flex items-center justify-between" style={{ borderTop: `1px solid ${accent}33` }}>
                <span className="text-[10px]" style={{ color: `${accent}44`, fontFamily: "'JetBrains Mono', monospace" }}>
                  Adding / removing restarts the game.
                </span>
                <button
                  onClick={clearBallTypes}
                  disabled={ballTypeIds === null}
                  className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded"
                  style={{ color: '#ef4444', border: '1px solid #ef444433', opacity: ballTypeIds === null ? 0.3 : 1 }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Reset to default
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modifiers modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            key="modifier-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
            onClick={closeModal}
          >
            <motion.div
              key="modifier-modal-panel"
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-lg max-h-[85vh] rounded-xl overflow-hidden flex flex-col"
              style={{
                backgroundColor: '#0a0f0a',
                border: `1px solid ${accent}55`,
                boxShadow: `0 0 40px ${accent}22`,
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ borderBottom: `1px solid ${accent}33` }}
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" style={{ color: accent }} />
                  <span
                    className="font-black tracking-widest uppercase text-sm"
                    style={{ fontFamily: 'Orbitron, sans-serif', color: accent }}
                  >
                    Playground Modifiers
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {draftActiveCount > 0 && (
                    <button
                      onClick={resetAll}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: '#ef4444', border: '1px solid #ef444433' }}
                    >
                      Clear all
                    </button>
                  )}
                  <button onClick={closeModal}>
                    <X className="w-5 h-5" style={{ color: `${accent}99` }} />
                  </button>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
                <ModifierSection
                  title="Multiplicative"
                  subtitle="Stack by ×  - default 1.0"
                  keys={MULTIPLICATIVE_KEYS}
                  getValue={getDraftValue}
                  setValue={setDraftValue}
                  resetKey={resetDraftKey}
                  accentColor={accent}
                />
                <ModifierSection
                  title="Additive"
                  subtitle="Stack by +  - default 0"
                  keys={ADDITIVE_KEYS}
                  getValue={getDraftValue}
                  setValue={setDraftValue}
                  resetKey={resetDraftKey}
                  accentColor={accent}
                />
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3 flex-shrink-0"
                style={{ borderTop: `1px solid ${accent}33` }}
              >
                <span
                  className="text-[10px]"
                  style={{ color: `${accent}44`, fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Changes apply and restart the game on close.
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function ModifierSection({
  title,
  subtitle,
  keys,
  getValue,
  setValue,
  resetKey,
  accentColor,
}: {
  title: string;
  subtitle: string;
  keys: (keyof GameModifiers)[];
  getValue: (k: keyof GameModifiers) => number;
  setValue: (k: keyof GameModifiers, v: string) => void;
  resetKey: (k: keyof GameModifiers) => void;
  accentColor: string;
}) {
  return (
    <div>
      <div className="mb-3">
        <div
          className="text-xs font-bold uppercase tracking-widest"
          style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor }}
        >
          {title}
        </div>
        <div className="text-[10px]" style={{ color: `${accentColor}55`, fontFamily: "'JetBrains Mono', monospace" }}>
          {subtitle}
        </div>
      </div>
      <div className="space-y-2">
        {keys.map(key => {
          const meta = MODIFIER_META[key];
          const value = getValue(key);
          const isDefault = isDefaultValue(key, value);
          return (
            <div
              key={key}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{
                backgroundColor: isDefault ? 'rgba(255,255,255,0.03)' : `${accentColor}0d`,
                border: `1px solid ${isDefault ? 'rgba(255,255,255,0.06)' : `${accentColor}33`}`,
              }}
            >
              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <div
                  className="text-xs font-semibold truncate"
                  style={{ color: isDefault ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))' }}
                >
                  {meta.label}
                </div>
                <div
                  className="text-[10px] truncate"
                  style={{ color: 'hsl(var(--muted-foreground) / 0.6)', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {meta.description}
                </div>
              </div>

              {/* Input */}
              <input
                type="number"
                value={value}
                step={meta.step}
                min={meta.min}
                onChange={e => setValue(key, e.target.value)}
                className="w-20 text-right text-sm font-mono rounded px-2 py-1 bg-transparent outline-none border"
                style={{
                  color: isDefault ? 'hsl(var(--muted-foreground))' : accentColor,
                  borderColor: isDefault ? 'rgba(255,255,255,0.1)' : `${accentColor}55`,
                }}
              />

              {/* Reset button */}
              <button
                onClick={() => resetKey(key)}
                disabled={isDefault}
                className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-opacity"
                style={{
                  color: '#ef4444',
                  opacity: isDefault ? 0.2 : 0.8,
                  border: '1px solid #ef444444',
                }}
                title="Reset to default"
              >
                ↺
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

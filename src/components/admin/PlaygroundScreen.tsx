import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, RotateCcw, X, Layers, Save, Check, AlertCircle, ChevronRight } from 'lucide-react';
import yaml from 'js-yaml';
import { GameScreen } from '@/components/game/GameScreen';
import { GameModifiers, useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useColorProgression } from '@/hooks/useColorProgression';
import { LevelConfig, LevelData, LevelEntity, BallConfig } from '@/types/level';
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
  extraAugmentationPoints:          { label: 'Extra Aug. Points',      kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Bonus Augment Points granted' },
  microManagerPerLock:              { label: 'MicroManager/Lock',      kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Speed reduction per locked ball (0.01 = 1%, max 50%)' },
  ballPathPredictionBounces:        { label: 'Path Preview Bounces',   kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'SCRUM Master: bounces ahead to preview (0 = off)' },
  ballPathPredictionBalls:          { label: 'Path Preview Balls',     kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'SCRUM Master: fastest N balls to track (≥100 = all, 0 = off)' },
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

  useEffect(() => {
    fetch('/map.yml')
      .then(r => r.text())
      .then(text => {
        const data = yaml.load(text) as LevelData;
        if (data?.levels) setAllLevels(data.levels);
      })
      .catch(() => {/* silently ignore */});
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
      if (copy.shape === 'rect') { (copy as any).x += 30; (copy as any).y += 30; }
      else if (copy.shape === 'circle') { (copy as any).cx += 30; (copy as any).cy += 30; }
      else if (copy.shape === 'polygon') { (copy as any).points = (copy as any).points.map(([x,y]: [number,number]) => [x+30, y+30]); }
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
  const activeLevel = selectedLevel ?? PLAYGROUND_LEVEL;
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
          onMainMenu={onBack}
          onRestart={hardReset}
          accentColor={accent}
          achievementBonuses={achievementBonuses}
          activeModifiers={activeModifiers}
        />

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
               editSaveStatus === 'error'  ? <><AlertCircle className="w-4 h-4" /> Failed — dev server running?</> :
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
                        {lvl.balls.length} ball{lvl.balls.length !== 1 ? 's' : ''} · threshold {lvl.sizeThreshold}%
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
                  subtitle="Stack by ×  — default 1.0"
                  keys={MULTIPLICATIVE_KEYS}
                  getValue={getDraftValue}
                  setValue={setDraftValue}
                  resetKey={resetDraftKey}
                  accentColor={accent}
                />
                <ModifierSection
                  title="Additive"
                  subtitle="Stack by +  — default 0"
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

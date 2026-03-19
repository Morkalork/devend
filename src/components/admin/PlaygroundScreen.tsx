import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, RotateCcw, X } from 'lucide-react';
import { GameScreen } from '@/components/game/GameScreen';
import { GameModifiers } from '@/hooks/useActiveModifiers';

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
  fenceWidthMultiplier:             { label: 'Fence Width',            kind: 'multiplicative', step: 1,    min: 1,    defaultValue: 1,    description: 'Multiplies fence thickness (integer steps only)' },
  scoreMultiplier:                  { label: 'Score (OT) Mult.',       kind: 'multiplicative', step: 0.05, min: 0.1,  defaultValue: 1,    description: 'Multiplies overtime hours earned per map' },
  instantFencesPerMap:              { label: 'Instant Fences',         kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Fences that generate instantly at map start' },
  additionalConcurrentFences:       { label: 'Extra Concurrent',       kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Additional fences that can grow simultaneously' },
  bonusRemovalChance:               { label: 'Bonus Remove Chance',    kind: 'additive',       step: 0.05, min: 0,    defaultValue: 0,    description: 'Probability a fence triggers a bonus area removal (0–1)' },
  bonusRemovalAmount:               { label: 'Bonus Remove Amount',    kind: 'additive',       step: 0.05, min: 0,    defaultValue: 0,    description: 'Extra area removed when bonus triggers (fraction, 0–1)' },
  extraLives:                       { label: 'Extra Lives',            kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Extra lives granted immediately' },
  scoreInterestRate:                { label: 'Score Interest Rate',    kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Fraction of score added as interest between maps' },
  mapReductionPerFenceBonus:        { label: 'Map Reduction/Fence',    kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Extra area fraction removed per fence completion' },
  extraShopItems:                   { label: 'Extra Shop Slots',       kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Additional item slots in the upgrade shop' },
  extraAugmentationPoints:          { label: 'Extra Aug. Points',      kind: 'additive',       step: 1,    min: 0,    defaultValue: 0,    description: 'Bonus Augment Points granted' },
  microManagerPerLock:              { label: 'MicroManager/Lock',      kind: 'additive',       step: 0.01, min: 0,    defaultValue: 0,    description: 'Speed reduction per locked ball (0.01 = 1%, max 50%)' },
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

// ─── Component ────────────────────────────────────────────────────────────────

export function PlaygroundScreen({ onBack, accentColor = '#00ff88' }: PlaygroundScreenProps) {
  // `applied` drives the game — only changes on Apply / Reset
  const [applied, setApplied] = useState<ModifierValues>({});
  // `draft` is live editing state inside the modal
  const [draft, setDraft] = useState<ModifierValues>({});
  const [gameKey, setGameKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

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
    setGameKey(k => k + 1);
  }, []);

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

  return (
    <div className="fixed inset-0 bg-background">
      {/* Game */}
      <GameScreen
        key={gameKey}
        level={{
          id: 'playground',
          level: 1,
          sizeThreshold: 5,
          expectedCuts: 10,
          points: 100,
          balls: [
            { id: 'test-1', initialSpeed: 40, topSpeed: 40, color: 'ff4444' },
            { id: 'test-2', initialSpeed: 35, topSpeed: 35, color: '4488ff' },
            { id: 'test-3', initialSpeed: 30, topSpeed: 30, color: '44ff44' },
          ],
        }}
        levelNumber={1}
        totalLevels={1}
        totalScore={0}
        ownedUpgradeIds={[]}
        upgrades={[]}
        lives={99}
        onLivesChange={() => {}}
        onGameEnd={onBack}
        onLevelComplete={() => {}}
        onMainMenu={onBack}
        onRestart={hardReset}
        accentColor={accentColor}
        achievementBonuses={achievementBonuses}
      />

      {/* Fixed toolbar */}
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
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
          style={{
            backgroundColor: accentColor,
            color: '#000',
            boxShadow: `0 0 16px ${accentColor}66`,
          }}
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
                border: `1px solid ${accentColor}55`,
                boxShadow: `0 0 40px ${accentColor}22`,
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ borderBottom: `1px solid ${accentColor}33` }}
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" style={{ color: accentColor }} />
                  <span
                    className="font-black tracking-widest uppercase text-sm"
                    style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor }}
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
                    <X className="w-5 h-5" style={{ color: `${accentColor}99` }} />
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
                  accentColor={accentColor}
                />
                <ModifierSection
                  title="Additive"
                  subtitle="Stack by +  — default 0"
                  keys={ADDITIVE_KEYS}
                  getValue={getDraftValue}
                  setValue={setDraftValue}
                  resetKey={resetDraftKey}
                  accentColor={accentColor}
                />
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3 flex-shrink-0"
                style={{ borderTop: `1px solid ${accentColor}33` }}
              >
                <span
                  className="text-[10px]"
                  style={{ color: `${accentColor}44`, fontFamily: "'JetBrains Mono', monospace" }}
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

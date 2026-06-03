/**
 * Phaser store system — framework-agnostic progression manager.
 *
 * Replaces React hooks (useState/useCallback) with plain stores that
 * emit events for scene subscriptions.  Phase 4 implementation.
 */

type Listener = (...args: any[]) => void;

export class EventEmitterStore {
  protected listeners: Map<string, Listener[]> = new Map();

  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: Listener): void {
    const list = this.listeners.get(event);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  emit(event: string, ...args: any[]): void {
    const list = this.listeners.get(event);
    if (list) {
      list.forEach((fn) => fn(...args));
    }
  }
}

import yaml from 'js-yaml';
import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';
import { LevelConfig, LevelData } from '@/types/level';
import { calculateScoreBreakdown, getOvertimeCap } from '@/lib/scoring';

// ════════════════════════════════════════════════════════════════════════════
// SCORING STORE
// ════════════════════════════════════════════════════════════════════════════

const defaultScoringConfig: ScoringConfig = {
  scoring: {
    fenceEfficiency: {
      maxBonus: 1,
      steps: [{ fencesUnder: 1, bonus: 1 }],
    },
    spaceOptimization: {
      maxBonus: 1,
      thresholds: [{ extraPercent: 0.1, bonus: 1 }],
    },
    performanceMultiplier: {
      underPar: 1.0,
      atPar: 1.0,
      overPar1: 0.75,
      overPar2: 0.6,
      overPar3Plus: 0.4,
    },
  },
};

export class ScoringStore extends EventEmitterStore {
  private config: ScoringConfig = defaultScoringConfig;
  private isReady = false;

  constructor() {
    super();
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const res = await fetch('/scoring-config.yml');
      const text = await res.text();
      const parsed = (yaml.load(text) as Partial<ScoringConfig>) || {};
      this.config = {
        scoring: {
          fenceEfficiency: { ...defaultScoringConfig.scoring.fenceEfficiency, ...parsed.scoring?.fenceEfficiency },
          spaceOptimization: { ...defaultScoringConfig.scoring.spaceOptimization, ...parsed.scoring?.spaceOptimization },
          performanceMultiplier: { ...defaultScoringConfig.scoring.performanceMultiplier, ...parsed.scoring?.performanceMultiplier },
        },
      };
      this.isReady = true;
      this.emit('ready');
    } catch (err) {
      console.warn('Failed to load scoring config:', err);
      this.isReady = true;
      this.emit('ready');
    }
  }

  getConfig(): ScoringConfig {
    return this.config;
  }

  calculateLevelScore(
    usedFences: number,
    parFences: number,
    remainingPercent: number,
    thresholdPercent: number,
    basePoints: number,
    scoreMultiplier: number = 1,
    levelNumber: number = 1
  ): { base: number; bonus: number; penalty: number; total: number; breakdown: ScoreBreakdown } {
    const breakdown = calculateScoreBreakdown(
      usedFences,
      parFences,
      remainingPercent,
      thresholdPercent,
      basePoints,
      this.config,
      levelNumber
    );
    const cap = getOvertimeCap(levelNumber, this.config);
    const total = Math.min(breakdown.total * scoreMultiplier, cap);
    return {
      base: breakdown.base,
      bonus: breakdown.bonus,
      penalty: breakdown.penalty,
      total,
      breakdown,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKPOINT STORE
// ════════════════════════════════════════════════════════════════════════════

export class CheckpointStore extends EventEmitterStore {
  private checkpoints: { id: string; level: number; timestamp: number }[] = [];

  constructor() {
    super();
    this.loadCheckpoints();
  }

  private loadCheckpoints(): void {
    try {
      const stored = localStorage.getItem('devend-checkpoints');
      if (stored) {
        this.checkpoints = JSON.parse(stored);
      }
    } catch (err) {
      console.warn('Failed to load checkpoints:', err);
    }
  }

  saveCheckpoint(level: number): void {
    const checkpoint = {
      id: `ckpt-${Date.now()}`,
      level,
      timestamp: Date.now(),
    };
    this.checkpoints.push(checkpoint);
    this.saveToStorage();
    this.emit('checkpoint-saved', checkpoint);
  }

  getCheckpoints(): typeof this.checkpoints {
    return [...this.checkpoints];
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem('devend-checkpoints', JSON.stringify(this.checkpoints));
    } catch (err) {
      console.warn('Failed to save checkpoints:', err);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LEVEL MANAGER STORE
// ════════════════════════════════════════════════════════════════════════════

function buildLevelSequence(allMaps: LevelConfig[]): LevelConfig[] {
  const groups = new Map<number, LevelConfig[]>();
  for (const map of allMaps) {
    const lvl = map.level || 1;
    if (!groups.has(lvl)) groups.set(lvl, []);
    groups.get(lvl)!.push(map);
  }

  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
  return sortedLevels.map((lvl) => {
    const variants = groups.get(lvl)!;
    return variants[Math.floor(Math.random() * variants.length)];
  });
}

export class LevelManagerStore extends EventEmitterStore {
  private allMaps: LevelConfig[] = [];
  private levelSequence: LevelConfig[] = [];
  private currentLevelIndex = 0;
  private isLoading = false;
  private error: string | null = null;

  constructor() {
    super();
    this.loadLevels();
  }

  private async loadLevels(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    this.emit('loading');

    try {
      const res = await fetch('/map.yml');
      if (!res.ok) throw new Error(`Failed to load map.yml: ${res.status}`);

      const text = await res.text();
      const data = (yaml.load(text) as LevelData) || {};

      if (!data.levels || !Array.isArray(data.levels) || data.levels.length === 0) {
        throw new Error('Invalid map.yml: no levels found');
      }

      // Validate and set defaults
      for (const level of data.levels) {
        if (!level.level || typeof level.level !== 'number') {
          const match = level.id.match(/^level-(\d+)/);
          level.level = match ? parseInt(match[1], 10) : 1;
        }
      }

      this.allMaps = data.levels;
      this.levelSequence = buildLevelSequence(this.allMaps);
      this.isLoading = false;
      this.emit('ready', this.levelSequence);
    } catch (err) {
      this.error = String(err);
      this.isLoading = false;
      console.error('Failed to load levels:', err);
      this.emit('error', this.error);
    }
  }

  getCurrentLevel(): LevelConfig | null {
    return this.levelSequence[this.currentLevelIndex] || null;
  }

  nextLevel(): LevelConfig | null {
    this.currentLevelIndex++;
    const next = this.getCurrentLevel();
    if (next) {
      this.emit('level-changed', next, this.currentLevelIndex);
    }
    return next;
  }

  getLevelSequence(): LevelConfig[] {
    return [...this.levelSequence];
  }

  getCurrentLevelNumber(): number {
    return this.currentLevelIndex + 1;
  }

  resetToLevel(index: number): void {
    this.currentLevelIndex = Math.max(0, Math.min(index, this.levelSequence.length - 1));
    this.emit('level-reset', this.getCurrentLevel());
  }

  isReady(): boolean {
    return !this.isLoading && this.levelSequence.length > 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL STORE INSTANCES
// ════════════════════════════════════════════════════════════════════════════

export const scoringStore = new ScoringStore();
export const checkpointStore = new CheckpointStore();
export const levelManagerStore = new LevelManagerStore();

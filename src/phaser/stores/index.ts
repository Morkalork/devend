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
import { calculateScoreBreakdown, getOvertimeCap } from '@/lib/scoring';

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

// Global store instances
export const scoringStore = new ScoringStore();
export const checkpointStore = new CheckpointStore();

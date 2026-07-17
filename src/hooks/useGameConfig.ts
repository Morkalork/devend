/**
 * useGameConfig — global presentation/tuning values from public/game-config.yml
 * (canvas opacity, background colours, fence speed curve, …).
 * Falls back to the defaults below if the file fails to load.
 */
import { useState, useEffect } from 'react';
import yaml from 'js-yaml';
import { PickupConfig, PickupEffect, DEFAULT_PICKUP_CONFIG } from '@/types/pickups';

/** Raw `pickups:` block shape as written in the YAML (snake_case, keyed effects). */
interface RawPickupConfig {
  start_level?: number;
  spawn_check_seconds?: number;
  spawn_chance?: number;
  max_simultaneous?: number;
  lifetime_seconds?: number;
  effects?: Partial<Record<string, { weight?: number; value?: number }>>;
}

/** Map the YAML block onto the runtime PickupConfig, defaulting field-by-field. */
function parsePickupConfig(raw: RawPickupConfig | undefined): PickupConfig {
  const d = DEFAULT_PICKUP_CONFIG;
  const yamlKeyToEffect: Record<string, PickupEffect> = {
    overtime: 'overtime', fork: 'fork', cap_raise: 'capRaise', freeze_charge: 'freezeCharge',
    free_shop_item: 'freeShopItem',
  };
  const effects = d.effects.map(def => {
    const rawKey = Object.keys(yamlKeyToEffect).find(k => yamlKeyToEffect[k] === def.effect)!;
    const e = raw?.effects?.[rawKey];
    return { effect: def.effect, weight: e?.weight ?? def.weight, value: e?.value ?? def.value };
  });
  return {
    startLevel: raw?.start_level ?? d.startLevel,
    spawnCheckSeconds: raw?.spawn_check_seconds ?? d.spawnCheckSeconds,
    spawnChance: raw?.spawn_chance ?? d.spawnChance,
    maxSimultaneous: raw?.max_simultaneous ?? d.maxSimultaneous,
    lifetimeSeconds: raw?.lifetime_seconds ?? d.lifetimeSeconds,
    effects,
  };
}

export interface GameConfig {
  visuals: {
    canvas_opacity: number;
    hud_opacity: number;
    background_color: string; // hex without #
    region_color: string; // hex without #
    accent_color: string; // hex without #
  };
  ball: {
    default_speed: number;
    max_speed: number;
    radius_percent: number;
  };
  fence: {
    speed_base: number;
    speed_min: number;
    speed_per_level: number;
  };
  gameplay: {
    starting_lives: number;
    max_lives: number;
    cut_completion_threshold: number;
  };
  lock: {
    win_threshold_percent: number; // region <= this % of the denominator -> lock
    min_region_cells: number;      // region <= this many cells always locks (0 = off)
  };
  scope_creep: {
    grace_seconds: number; // active-play seconds before the first speed surge
    step_seconds: number;  // seconds between surges after the grace window
    step_percent: number;  // ball speed added per surge (%)
    max_steps: number;     // surge cap (0 disables the mechanic)
  };
  /** Parsed (camelCase) pickup tuning; raw YAML is snake_case (see parsePickupConfig). */
  pickups: PickupConfig;
  crt_word_highlight: {
    interval_min_seconds: number; // min delay between highlights appearing
    interval_max_seconds: number; // max delay between highlights appearing
    display_seconds: number;      // how long each highlight stays visible
    grow_seconds: number;         // duration of the box grow-up animation
    line_grow_seconds: number;    // duration of each connector line grow animation
    color: string;                // hex without #
    border_opacity: number;       // 0–1
    background_opacity: number;   // 0–1
    border_width: number;         // pixels
  };
}

const defaultConfig: GameConfig = {
  visuals: {
    canvas_opacity: 0.9,
    hud_opacity: 0.85,
    background_color: "0a1a10",
    region_color: "1a3020",
    accent_color: "00ff88",
  },
  ball: {
    default_speed: 4.5,
    max_speed: 12,
    radius_percent: 2.5,
  },
  fence: {
    speed_base: 1200,
    speed_min: 750,
    speed_per_level: 50,
  },
  gameplay: {
    starting_lives: 3,
    max_lives: 5,
    cut_completion_threshold: 0.75,
  },
  lock: {
    win_threshold_percent: 10,
    min_region_cells: 0,
  },
  scope_creep: {
    grace_seconds: 45,
    step_seconds: 15,
    step_percent: 8,
    max_steps: 4,
  },
  pickups: DEFAULT_PICKUP_CONFIG,
  crt_word_highlight: {
    interval_min_seconds: 8,
    interval_max_seconds: 14,
    display_seconds: 10,
    grow_seconds: 1,
    line_grow_seconds: 0.4,
    color: "00ff88",
    border_opacity: 0.85,
    background_opacity: 0.2,
    border_width: 2,
  },
};

export function useGameConfig() {
  const [config, setConfig] = useState<GameConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/game-config.yml')
      .then((res) => res.text())
      .then((text) => {
        const parsed = yaml.load(text) as Partial<GameConfig> & { pickups?: RawPickupConfig };
        setConfig({
          ...defaultConfig,
          ...parsed,
          visuals: { ...defaultConfig.visuals, ...parsed?.visuals },
          ball: { ...defaultConfig.ball, ...parsed?.ball },
          fence: { ...defaultConfig.fence, ...parsed?.fence },
          gameplay: { ...defaultConfig.gameplay, ...parsed?.gameplay },
          lock: { ...defaultConfig.lock, ...parsed?.lock },
          scope_creep: { ...defaultConfig.scope_creep, ...parsed?.scope_creep },
          crt_word_highlight: { ...defaultConfig.crt_word_highlight, ...parsed?.crt_word_highlight },
          pickups: parsePickupConfig(parsed?.pickups),
        });
      })
      .catch((err) => {
        console.warn('Failed to load game config, using defaults:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Helper to convert hex to rgba
  const hexToRgba = (hex: string, alpha: number = 1) => {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return alpha === 1 ? `#${hex}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Helper to get background color as CSS string with optional alpha
  const getBackgroundColor = (alpha: number = 1) => hexToRgba(config.visuals.background_color, alpha);

  // Helper to get region color as CSS string with optional alpha
  const getRegionColor = (alpha: number = 1) => hexToRgba(config.visuals.region_color, alpha);

  // Helper to get accent color as CSS string with optional alpha
  const getAccentColor = (alpha: number = 1) => hexToRgba(config.visuals.accent_color, alpha);

  return { config, loading, getBackgroundColor, getRegionColor, getAccentColor };
}

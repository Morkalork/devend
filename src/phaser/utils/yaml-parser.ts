/**
 * YAML parsing utilities — extracted from hooks, framework-agnostic.
 * All parsing logic used by BootScene, decoupled from React.
 */
import yaml from 'js-yaml';

export interface GameConfig {
  visuals: {
    canvas_opacity: number;
    hud_opacity: number;
    background_color: string;
    region_color: string;
    accent_color: string;
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
  crt_word_highlight: {
    interval_min_seconds: number;
    interval_max_seconds: number;
    display_seconds: number;
    grow_seconds: number;
    line_grow_seconds: number;
    color: string;
    border_opacity: number;
    background_opacity: number;
    border_width: number;
  };
}

const defaultGameConfig: GameConfig = {
  visuals: {
    canvas_opacity: 0.9,
    hud_opacity: 0.85,
    background_color: '0a1a10',
    region_color: '1a3020',
    accent_color: '00ff88',
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
  crt_word_highlight: {
    interval_min_seconds: 8,
    interval_max_seconds: 14,
    display_seconds: 10,
    grow_seconds: 1,
    line_grow_seconds: 0.4,
    color: '00ff88',
    border_opacity: 0.85,
    background_opacity: 0.2,
    border_width: 2,
  },
};

export async function parseGameConfig(text: string): Promise<GameConfig> {
  const parsed = yaml.load(text) as Partial<GameConfig>;
  return {
    ...defaultGameConfig,
    ...parsed,
    visuals: { ...defaultGameConfig.visuals, ...parsed?.visuals },
    ball: { ...defaultGameConfig.ball, ...parsed?.ball },
    fence: { ...defaultGameConfig.fence, ...parsed?.fence },
    gameplay: { ...defaultGameConfig.gameplay, ...parsed?.gameplay },
    crt_word_highlight: { ...defaultGameConfig.crt_word_highlight, ...parsed?.crt_word_highlight },
  };
}

export interface ColorConfig {
  background: string;
  accent: string;
  balls: Record<string, string>;
}

export async function parseColorsYml(text: string): Promise<ColorConfig> {
  const data = yaml.load(text) as any;
  return {
    background: data.background || '0a1a10',
    accent: data.accent || '00ff88',
    balls: data.balls || {},
  };
}

export async function loadYamlFile(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.statusText}`);
  return res.text();
}

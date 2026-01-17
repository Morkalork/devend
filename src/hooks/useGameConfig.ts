import { useState, useEffect } from 'react';
import yaml from 'js-yaml';

export interface GameConfig {
  visuals: {
    canvas_opacity: number;
    hud_opacity: number;
    background_color: string; // hex without #
    region_color: string; // hex without #
  };
  ball: {
    default_speed: number;
    max_speed: number;
    radius_percent: number;
  };
  gameplay: {
    starting_lives: number;
    max_lives: number;
    cut_completion_threshold: number;
  };
}

const defaultConfig: GameConfig = {
  visuals: {
    canvas_opacity: 0.9,
    hud_opacity: 0.85,
    background_color: "0a1a10",
    region_color: "1a3020",
  },
  ball: {
    default_speed: 4.5,
    max_speed: 12,
    radius_percent: 2.5,
  },
  gameplay: {
    starting_lives: 3,
    max_lives: 5,
    cut_completion_threshold: 0.75,
  },
};

export function useGameConfig() {
  const [config, setConfig] = useState<GameConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/game-config.yml')
      .then((res) => res.text())
      .then((text) => {
        const parsed = yaml.load(text) as Partial<GameConfig>;
        setConfig({ 
          ...defaultConfig, 
          ...parsed,
          visuals: { ...defaultConfig.visuals, ...parsed?.visuals },
          ball: { ...defaultConfig.ball, ...parsed?.ball },
          gameplay: { ...defaultConfig.gameplay, ...parsed?.gameplay },
        });
      })
      .catch((err) => {
        console.warn('Failed to load game config, using defaults:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Helper to get background color as CSS string with optional alpha
  const getBackgroundColor = (alpha: number = 1) => {
    const hex = config.visuals.background_color;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return alpha === 1 ? `#${hex}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Helper to get region color as CSS string with optional alpha
  const getRegionColor = (alpha: number = 1) => {
    const hex = config.visuals.region_color;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return alpha === 1 ? `#${hex}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return { config, loading, getBackgroundColor, getRegionColor };
}

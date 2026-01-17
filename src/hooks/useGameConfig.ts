import { useState, useEffect } from 'react';
import yaml from 'js-yaml';

export interface GameConfig {
  visuals: {
    canvas_opacity: number;
    hud_opacity: number;
    background: {
      hue: number;
      saturation: number;
      lightness: number;
    };
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
    background: {
      hue: 140,
      saturation: 100,
      lightness: 2,
    },
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
        const parsed = yaml.load(text) as GameConfig;
        setConfig({ ...defaultConfig, ...parsed });
      })
      .catch((err) => {
        console.warn('Failed to load game config, using defaults:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Helper to get background color as CSS string
  const getBackgroundColor = (alpha: number = 1) => {
    const { hue, saturation, lightness } = config.visuals.background;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
  };

  return { config, loading, getBackgroundColor };
}

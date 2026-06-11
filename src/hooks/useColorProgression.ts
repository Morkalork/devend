/**
 * useColorProgression — maps a level number to the accent colour theme.
 *
 * Colour steps are defined in public/colors.yml (name, hex, how many levels
 * the step lasts). AccentColorContext uses this to recolour the whole UI as
 * the player climbs levels.
 */
import { useState, useEffect, useMemo } from 'react';
import yaml from 'js-yaml';

interface ColorStep {
  name: string;
  hex: string;
  levels: number;
}

interface ColorConfig {
  progression: ColorStep[];
}

const defaultProgression: ColorStep[] = [
  { name: "Neon Green", hex: "00ff88", levels: 5 },
  { name: "Electric Blue", hex: "00d4ff", levels: 5 },
  { name: "Hot Pink", hex: "ff00aa", levels: 5 },
  { name: "Golden Yellow", hex: "ffdd00", levels: 5 },
  { name: "Crimson Red", hex: "ff3344", levels: 5 },
  { name: "Pure White", hex: "ffffff", levels: 5 },
];

export function useColorProgression(currentLevel: number = 1) {
  const [progression, setProgression] = useState<ColorStep[]>(defaultProgression);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/colors.yml')
      .then((res) => res.text())
      .then((text) => {
        const parsed = yaml.load(text) as ColorConfig;
        if (parsed?.progression && Array.isArray(parsed.progression)) {
          setProgression(parsed.progression);
        }
      })
      .catch((err) => {
        console.warn('Failed to load color config, using defaults:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Calculate current color based on level
  const currentColor = useMemo(() => {
    if (progression.length === 0) {
      return { name: "Default", hex: "00ff88" };
    }

    // Calculate total cycle length
    const totalCycleLength = progression.reduce((sum, step) => sum + step.levels, 0);
    
    // Get position in cycle (0-indexed)
    const positionInCycle = ((currentLevel - 1) % totalCycleLength);
    
    // Find which color step we're in
    let accumulated = 0;
    for (const step of progression) {
      accumulated += step.levels;
      if (positionInCycle < accumulated) {
        return step;
      }
    }
    
    // Fallback to last color
    return progression[progression.length - 1];
  }, [currentLevel, progression]);

  // Helper to get hex with # prefix
  const getAccentColor = (alpha: number = 1) => {
    const hex = currentColor.hex;
    if (alpha === 1) {
      return `#${hex}`;
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return {
    currentColor,
    accentHex: `#${currentColor.hex}`,
    getAccentColor,
    progression,
    loading,
  };
}

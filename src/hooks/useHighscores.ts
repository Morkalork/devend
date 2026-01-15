import { useState, useCallback, useEffect } from 'react';
import { 
  Highscore, 
  HIGHSCORES_STORAGE_KEY, 
  LAST_NAME_STORAGE_KEY, 
  MAX_HIGHSCORES 
} from '@/types/highscore';

/**
 * Sanitize name input: trim, uppercase, remove non A-Z characters, max 6 chars
 */
export function sanitiseName(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6);
}

/**
 * Load highscores from localStorage safely
 */
export function loadHighscores(): Highscore[] {
  try {
    const stored = localStorage.getItem(HIGHSCORES_STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    
    // Validate each entry has required fields
    return parsed.filter(
      (entry): entry is Highscore =>
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        typeof entry.level === 'number' &&
        typeof entry.totalScore === 'number' &&
        typeof entry.dateTime === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Sort highscores: level desc, totalScore desc, dateTime asc (older first for ties)
 */
function sortHighscores(list: Highscore[]): Highscore[] {
  return [...list].sort((a, b) => {
    // Primary: level descending
    if (b.level !== a.level) return b.level - a.level;
    // Secondary: totalScore descending
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // Tertiary: dateTime ascending (older first)
    return a.dateTime.localeCompare(b.dateTime);
  });
}

/**
 * Save highscores to localStorage
 */
export function saveHighscores(list: Highscore[]): void {
  const sorted = sortHighscores(list);
  const trimmed = sorted.slice(0, MAX_HIGHSCORES);
  localStorage.setItem(HIGHSCORES_STORAGE_KEY, JSON.stringify(trimmed));
}

/**
 * Add a new highscore entry, sort, trim to top 50, persist, and return updated list
 */
export function addHighscore(entry: Highscore): Highscore[] {
  const current = loadHighscores();
  const updated = [...current, entry];
  const sorted = sortHighscores(updated);
  const trimmed = sorted.slice(0, MAX_HIGHSCORES);
  localStorage.setItem(HIGHSCORES_STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

/**
 * Get the last used name from localStorage
 */
export function getLastName(): string {
  try {
    return localStorage.getItem(LAST_NAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Save the last used name to localStorage
 */
export function saveLastName(name: string): void {
  localStorage.setItem(LAST_NAME_STORAGE_KEY, name);
}

/**
 * Clear all highscores from localStorage
 */
export function clearHighscores(): void {
  localStorage.removeItem(HIGHSCORES_STORAGE_KEY);
}

/**
 * React hook for managing highscores with state
 */
export function useHighscores() {
  const [highscores, setHighscores] = useState<Highscore[]>([]);

  // Load highscores on mount
  useEffect(() => {
    setHighscores(loadHighscores());
  }, []);

  const refresh = useCallback(() => {
    setHighscores(loadHighscores());
  }, []);

  const add = useCallback((entry: Highscore) => {
    const updated = addHighscore(entry);
    setHighscores(updated);
    return updated;
  }, []);

  const clear = useCallback(() => {
    clearHighscores();
    setHighscores([]);
  }, []);

  return {
    highscores,
    refresh,
    add,
    clear,
  };
}

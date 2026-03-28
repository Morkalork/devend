import { useState, useCallback, useEffect, useRef } from 'react';
import yaml from 'js-yaml';
import {
  Certificate,
  CertConfig,
  CertPersistence,
  CERT_STORAGE_KEY,
  DEFAULT_CERT_PERSISTENCE,
} from '@/types/certificate';
import { GameModifiers, MULTIPLICATIVE_KEYS } from '@/hooks/useActiveModifiers';

const LEVELS_PER_POINT = 5;

function loadPersistence(): CertPersistence {
  try {
    const stored = localStorage.getItem(CERT_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_CERT_PERSISTENCE };
    const parsed = JSON.parse(stored);
    return {
      totalAugmentPoints: typeof parsed.totalAugmentPoints === 'number' ? parsed.totalAugmentPoints : 0,
      maxTierCounts: typeof parsed.maxTierCounts === 'object' && parsed.maxTierCounts !== null ? parsed.maxTierCounts : {},
      unlockedCertIds: Array.isArray(parsed.unlockedCertIds) ? parsed.unlockedCertIds : [],
      certLevelsOwned: typeof parsed.certLevelsOwned === 'object' && parsed.certLevelsOwned !== null ? parsed.certLevelsOwned : {},
    };
  } catch {
    return { ...DEFAULT_CERT_PERSISTENCE };
  }
}

function savePersistence(state: CertPersistence): void {
  localStorage.setItem(CERT_STORAGE_KEY, JSON.stringify(state));
}

export interface CertManagerOptions {
  onPointEarned?: () => void;
}

export function useCertificateManager(options: CertManagerOptions = {}) {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<CertPersistence>(DEFAULT_CERT_PERSISTENCE);
  const [isLoaded, setIsLoaded] = useState(false);

  // In-run tracking (ephemeral, not persisted)
  const [runLevelsCompleted, setRunLevelsCompleted] = useState(0);
  const runPointsEarned = Math.floor(runLevelsCompleted / LEVELS_PER_POINT);

  // Synchronous pending-unlock accumulator (for reading across React batching boundaries)
  const pendingUnlocksRef = useRef<Certificate[]>([]);

  const prevPointsRef = useRef(0);
  const onPointEarnedRef = useRef(options.onPointEarned);
  useEffect(() => { onPointEarnedRef.current = options.onPointEarned; }, [options.onPointEarned]);
  useEffect(() => {
    if (runPointsEarned > prevPointsRef.current) onPointEarnedRef.current?.();
    prevPointsRef.current = runPointsEarned;
  }, [runPointsEarned]);

  useEffect(() => {
    const loaded = loadPersistence();
    setPersistence(loaded);
    setIsLoaded(true);
  }, []);

  const loadCertificates = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/certificates.yml');
      if (!response.ok) throw new Error(`Failed to load certificates: ${response.status}`);
      const config = yaml.load(await response.text()) as CertConfig;
      if (!config?.certificates || !Array.isArray(config.certificates)) {
        throw new Error('Invalid certificates configuration');
      }
      setCertificates(config.certificates);
      setIsLoading(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading certificates');
      setIsLoading(false);
      return false;
    }
  }, []);

  /**
   * Called when a max-tier upgrade is bought.
   * Increments the run count and checks if any cert unlocks.
   * Returns the newly unlocked certs (synchronous, before React re-renders).
   */
  const recordMaxTierPurchase = useCallback((upgradeId: string): Certificate[] => {
    // Capture unlocks synchronously inside the state updater
    const newUnlocks: Certificate[] = [];

    setPersistence(prev => {
      const newCount = (prev.maxTierCounts[upgradeId] || 0) + 1;
      const nextCounts = { ...prev.maxTierCounts, [upgradeId]: newCount };

      const newlyUnlocked = certificates.filter(cert =>
        cert.unlockType === 'upgrade-chain' &&
        cert.sourceUpgradeId === upgradeId &&
        !prev.unlockedCertIds.includes(cert.id) &&
        newCount >= (cert.requiredRuns ?? 3)
      );
      newUnlocks.push(...newlyUnlocked);

      const newState = {
        ...prev,
        maxTierCounts: nextCounts,
        unlockedCertIds: [...prev.unlockedCertIds, ...newlyUnlocked.map(c => c.id)],
      };
      savePersistence(newState);
      return newState;
    });

    if (newUnlocks.length > 0) {
      pendingUnlocksRef.current.push(...newUnlocks);
    }
    return newUnlocks;
  }, [certificates]);

  /**
   * Called when achievement completion state changes.
   * Unlocks certs whose sourceAchievementId is now in the completed set.
   */
  const checkAchievementUnlocks = useCallback((completedAchievementIds: string[]): Certificate[] => {
    const newUnlocks: Certificate[] = [];

    setPersistence(prev => {
      const newlyUnlocked = certificates.filter(cert =>
        cert.unlockType === 'achievement' &&
        cert.sourceAchievementId != null &&
        completedAchievementIds.includes(cert.sourceAchievementId!) &&
        !prev.unlockedCertIds.includes(cert.id)
      );
      if (newlyUnlocked.length === 0) return prev;
      newUnlocks.push(...newlyUnlocked);
      const newState = {
        ...prev,
        unlockedCertIds: [...prev.unlockedCertIds, ...newlyUnlocked.map(c => c.id)],
      };
      savePersistence(newState);
      return newState;
    });

    if (newUnlocks.length > 0) {
      pendingUnlocksRef.current.push(...newUnlocks);
    }
    return newUnlocks;
  }, [certificates]);

  /**
   * Consume and clear pending unlock notifications.
   * Call this in handleContinueFromShop to capture certs unlocked during the shop session.
   */
  const takePendingUnlocks = useCallback((): Certificate[] => {
    const unlocks = [...pendingUnlocksRef.current];
    pendingUnlocksRef.current = [];
    return unlocks;
  }, []);

  /**
   * Purchase levels 1 through targetLevel of a cert (inclusive).
   * Deducts total cumulative cost. Returns true on success.
   */
  const purchaseCertLevel = useCallback((certId: string, targetLevel: number): boolean => {
    const cert = certificates.find(c => c.id === certId);
    if (!cert) return false;

    const currentLevel = persistence.certLevelsOwned[certId] || 0;
    if (targetLevel <= currentLevel || targetLevel > cert.levels.length) return false;

    const totalCost = cert.levels
      .slice(currentLevel, targetLevel)
      .reduce((sum, l) => sum + l.cost, 0);

    if (persistence.totalAugmentPoints < totalCost) return false;

    setPersistence(prev => {
      const newState = {
        ...prev,
        totalAugmentPoints: prev.totalAugmentPoints - totalCost,
        certLevelsOwned: { ...prev.certLevelsOwned, [certId]: targetLevel },
      };
      savePersistence(newState);
      return newState;
    });
    return true;
  }, [certificates, persistence]);

  /**
   * Compute combined bonus modifiers from all owned cert levels.
   * Ready to be merged with achievementBonuses via mergeBonuses().
   */
  const getCertBonuses = useCallback((): Partial<Record<keyof GameModifiers, number>> => {
    const result: Partial<Record<keyof GameModifiers, number>> = {};
    for (const cert of certificates) {
      const levelsOwned = persistence.certLevelsOwned[cert.id] || 0;
      if (levelsOwned === 0) continue;
      for (let i = 0; i < levelsOwned; i++) {
        const { type, value } = cert.levels[i].effect;
        if (type === 'startingLevelBonus') continue; // handled by getCertStartingLevel
        const k = type as keyof GameModifiers;
        if (MULTIPLICATIVE_KEYS.includes(k)) {
          result[k] = ((result[k] as number) ?? 1) * value;
        } else {
          result[k] = ((result[k] as number) ?? 0) + value;
        }
      }
    }
    return result;
  }, [certificates, persistence.certLevelsOwned]);

  /**
   * Get max starting level from owned head-start certs (takes highest, not sum).
   */
  const getCertStartingLevel = useCallback((): number => {
    let max = 1;
    for (const cert of certificates) {
      const levelsOwned = persistence.certLevelsOwned[cert.id] || 0;
      if (levelsOwned === 0) continue;
      for (let i = 0; i < levelsOwned; i++) {
        if (cert.levels[i].effect.type === 'startingLevelBonus') {
          max = Math.max(max, cert.levels[i].effect.value);
        }
      }
    }
    return max;
  }, [certificates, persistence.certLevelsOwned]);

  // ── Run tracking ──────────────────────────────────────────────────────────

  const resetRunProgress = useCallback(() => {
    setRunLevelsCompleted(0);
    prevPointsRef.current = 0;
  }, []);

  const incrementRunLevel = useCallback(() => {
    setRunLevelsCompleted(prev => prev + 1);
  }, []);

  const finalizeRun = useCallback((): number => {
    const pointsAwarded = Math.floor(runLevelsCompleted / LEVELS_PER_POINT);
    if (runLevelsCompleted > 0) {
      setPersistence(prev => {
        const newState = { ...prev, totalAugmentPoints: prev.totalAugmentPoints + pointsAwarded };
        savePersistence(newState);
        return newState;
      });
    }
    setRunLevelsCompleted(0);
    prevPointsRef.current = 0;
    return pointsAwarded;
  }, [runLevelsCompleted]);

  const getRunProgress = useCallback(() => ({
    levelsCompleted: runLevelsCompleted,
    levelsToNextPoint: LEVELS_PER_POINT - (runLevelsCompleted % LEVELS_PER_POINT),
    progressInCurrentPoint: runLevelsCompleted % LEVELS_PER_POINT,
    pointsEarned: runPointsEarned,
    levelsPerPoint: LEVELS_PER_POINT,
  }), [runLevelsCompleted, runPointsEarned]);

  const resetAllData = useCallback(() => {
    const newState = { ...DEFAULT_CERT_PERSISTENCE };
    setPersistence(newState);
    savePersistence(newState);
  }, []);

  return {
    certificates,
    isLoading,
    error,
    isLoaded,
    totalAugmentPoints: persistence.totalAugmentPoints,
    certLevelsOwned: persistence.certLevelsOwned,
    unlockedCertIds: persistence.unlockedCertIds,
    maxTierCounts: persistence.maxTierCounts,
    // Run tracking
    runLevelsCompleted,
    runPointsEarned,
    // Methods
    loadCertificates,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    getRunProgress,
    recordMaxTierPurchase,
    checkAchievementUnlocks,
    takePendingUnlocks,
    purchaseCertLevel,
    getCertBonuses,
    getCertStartingLevel,
    resetAllData,
  };
}

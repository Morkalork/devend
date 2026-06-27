/**
 * useCertificateManager — certificates and Certificate Hours (meta-progression).
 *
 * Certificates are permanent bonuses defined in public/certificates.yml.
 * Most unlock by buying a specific upgrade's max tier in several separate
 * runs; two unlock via achievements. Once unlocked, individual certificate
 * levels are bought with Certificate Hours — earned at a rate of one per
 * LEVELS_PER_HOUR completed levels, banked when the run ends.
 *
 * Persistence: localStorage key CERT_STORAGE_KEY (see src/types/certificate.ts).
 * Owned-level effects are exposed via certBonuses, which useGameSession
 * merges with achievement bonuses into the GameModifiers pipeline.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import yaml from 'js-yaml';
import {
  Certificate,
  CertConfig,
  CertPersistence,
  CERT_STORAGE_KEY,
  DEFAULT_CERT_PERSISTENCE,
} from '@/types/certificate';
import { GameModifiers, MULTIPLICATIVE_KEYS } from '@/hooks/useActiveModifiers';

const LEVELS_PER_HOUR = 5;

function loadPersistence(): CertPersistence {
  try {
    const stored = localStorage.getItem(CERT_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_CERT_PERSISTENCE };
    const parsed = JSON.parse(stored);
    // `totalAugmentPoints` is the legacy storage name for certificate hours.
    const storedHours = parsed.totalCertificateHours ?? parsed.totalAugmentPoints;
    return {
      totalCertificateHours: typeof storedHours === 'number' ? storedHours : 0,
      maxTierCounts: typeof parsed.maxTierCounts === 'object' && parsed.maxTierCounts !== null ? parsed.maxTierCounts : {},
      unlockedCertIds: Array.isArray(parsed.unlockedCertIds) ? parsed.unlockedCertIds : [],
      certLevelsOwned: typeof parsed.certLevelsOwned === 'object' && parsed.certLevelsOwned !== null ? parsed.certLevelsOwned : {},
      lifetimeHoursSpent: typeof parsed.lifetimeHoursSpent === 'number' ? parsed.lifetimeHoursSpent : 0,
    };
  } catch {
    return { ...DEFAULT_CERT_PERSISTENCE };
  }
}

function savePersistence(state: CertPersistence): void {
  try {
    localStorage.setItem(CERT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist certificate state', e);
  }
}

export interface CertManagerOptions {
  onHourEarned?: () => void;
}

export function useCertificateManager(options: CertManagerOptions = {}) {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<CertPersistence>(DEFAULT_CERT_PERSISTENCE);
  const [isLoaded, setIsLoaded] = useState(false);

  // In-run tracking (ephemeral, not persisted)
  const [runLevelsCompleted, setRunLevelsCompleted] = useState(0);
  const runHoursEarned = Math.floor(runLevelsCompleted / LEVELS_PER_HOUR);

  // Synchronous pending-unlock accumulator (for reading across React batching boundaries)
  const pendingUnlocksRef = useRef<Certificate[]>([]);

  const prevHoursRef = useRef(0);
  const onHourEarnedRef = useRef(options.onHourEarned);
  useEffect(() => { onHourEarnedRef.current = options.onHourEarned; }, [options.onHourEarned]);
  useEffect(() => {
    if (runHoursEarned > prevHoursRef.current) onHourEarnedRef.current?.();
    prevHoursRef.current = runHoursEarned;
  }, [runHoursEarned]);

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
    if (targetLevel > cert.levels.length) return false;

    // Optimistic check against the rendered snapshot for the return value.
    const snapshotLevel = persistence.certLevelsOwned[certId] || 0;
    if (targetLevel <= snapshotLevel) return false;
    const snapshotCost = cert.levels
      .slice(snapshotLevel, targetLevel)
      .reduce((sum, l) => sum + l.cost, 0);
    const affordable = persistence.totalCertificateHours >= snapshotCost;

    // Re-validate and mutate atomically against `prev` so rapid double-taps
    // can't both pass the stale snapshot check and overdraw the balance.
    setPersistence(prev => {
      const currentLevel = prev.certLevelsOwned[certId] || 0;
      if (targetLevel <= currentLevel) return prev;

      const totalCost = cert.levels
        .slice(currentLevel, targetLevel)
        .reduce((sum, l) => sum + l.cost, 0);

      if (prev.totalCertificateHours < totalCost) return prev;

      const lifetimeHoursSpent = prev.lifetimeHoursSpent + totalCost;

      // Spending hours can itself unlock certs (hours-spent unlock type)
      const newlyUnlocked = certificates.filter(cert =>
        cert.unlockType === 'hours-spent' &&
        !prev.unlockedCertIds.includes(cert.id) &&
        lifetimeHoursSpent >= (cert.requiredHoursSpent ?? Infinity)
      );

      const newState = {
        ...prev,
        totalCertificateHours: Math.max(0, prev.totalCertificateHours - totalCost),
        certLevelsOwned: { ...prev.certLevelsOwned, [certId]: targetLevel },
        lifetimeHoursSpent,
        unlockedCertIds: newlyUnlocked.length > 0
          ? [...prev.unlockedCertIds, ...newlyUnlocked.map(c => c.id)]
          : prev.unlockedCertIds,
      };
      savePersistence(newState);
      return newState;
    });
    return affordable;
  }, [certificates, persistence]);

  /**
   * Compute combined bonus modifiers from all owned cert levels.
   * Ready to be merged with achievementBonuses via mergeBonuses().
   */
  const certBonuses = useMemo((): Partial<Record<keyof GameModifiers, number>> => {
    const result: Partial<Record<keyof GameModifiers, number>> = {};
    for (const cert of certificates) {
      const levelsOwned = persistence.certLevelsOwned[cert.id] || 0;
      if (levelsOwned === 0) continue;
      for (let i = 0; i < levelsOwned; i++) {
        const { type, value } = cert.levels[i].effect;
        if (type === 'startingLevelBonus') continue;
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
    prevHoursRef.current = 0;
  }, []);

  /** Ascension levels count more: pass weight = 1 + ascensionDepth. */
  const incrementRunLevel = useCallback((weight: number = 1) => {
    setRunLevelsCompleted(prev => prev + weight);
  }, []);

  /** `extraHours` is the extraCertificateHours modifier (Certification Wizard). */
  const finalizeRun = useCallback((extraHours: number = 0): number => {
    const safeExtra = Number.isFinite(extraHours) ? Math.max(0, Math.round(extraHours)) : 0;
    const hoursAwarded =
      Math.floor(runLevelsCompleted / LEVELS_PER_HOUR) +
      (runLevelsCompleted > 0 ? safeExtra : 0);
    if (runLevelsCompleted > 0) {
      setPersistence(prev => {
        const newState = { ...prev, totalCertificateHours: prev.totalCertificateHours + hoursAwarded };
        savePersistence(newState);
        return newState;
      });
    }
    setRunLevelsCompleted(0);
    prevHoursRef.current = 0;
    return hoursAwarded;
  }, [runLevelsCompleted]);

  const runProgress = useMemo(() => ({
    levelsCompleted: runLevelsCompleted,
    levelsToNextHour: LEVELS_PER_HOUR - (runLevelsCompleted % LEVELS_PER_HOUR),
    progressInCurrentHour: runLevelsCompleted % LEVELS_PER_HOUR,
    hoursEarned: runHoursEarned,
    levelsPerHour: LEVELS_PER_HOUR,
  }), [runLevelsCompleted, runHoursEarned]);

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
    totalCertificateHours: persistence.totalCertificateHours,
    certLevelsOwned: persistence.certLevelsOwned,
    unlockedCertIds: persistence.unlockedCertIds,
    maxTierCounts: persistence.maxTierCounts,
    lifetimeHoursSpent: persistence.lifetimeHoursSpent,
    // Run tracking
    runLevelsCompleted,
    runHoursEarned,
    runProgress,
    certBonuses,
    // Methods
    loadCertificates,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    recordMaxTierPurchase,
    checkAchievementUnlocks,
    takePendingUnlocks,
    purchaseCertLevel,
    getCertStartingLevel,
    resetAllData,
  };
}

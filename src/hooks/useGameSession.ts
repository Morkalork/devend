/**
 * useGameSession — the single orchestrator for one player session.
 *
 * Index.tsx calls this once and passes the result down to every screen.
 * It wires together all the smaller managers:
 *   - useLevelManager        levels from public/map.yml, current level index
 *   - useUpgradeManager      shop upgrades from public/upgrades.yml
 *   - useLoadoutManager      curse/blessing loadouts from public/loadouts.yml
 *                            (run-start loadout draft + Ascension draft)
 *   - useCertificateManager  certificates + Certificate Hours (meta currency)
 *   - useTutorialManager     one-time tutorial flags
 *   - useCheckpointSnapshots saved per-level snapshots for the level picker
 *   - useMetaProgression     lifetime stats (fences drawn, lives lost, …)
 *   - useAchievementManager  achievements + their gameplay bonuses
 *
 * It also owns run-scoped state (score, lives, owned upgrades) and the
 * handle* callbacks that screens invoke to advance the game flow.
 */
import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useLevelManager } from './useLevelManager';
import { useUpgradeManager } from './useUpgradeManager';
import { useLoadoutManager } from './useLoadoutManager';
import { useActiveModifiers, mergeBonuses, GameModifiers, MULTIPLICATIVE_KEYS, ModifierSource } from './useActiveModifiers';
import { useTutorialManager } from './useTutorialManager';
import { useCheckpointSnapshots } from './useCheckpointSnapshots';
import { useCertificateManager } from './useCertificateManager';
import { useMetaProgression } from './useMetaProgression';
import { loadBallTypes } from '@/lib/ballTypes';
import { computeActiveTagSets, ownedTagCounts, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { computeBuildIdentity, RunRecap } from '@/lib/buildRecap';
import { loadDoors, getDoors, drawDoorOffers, isAssignmentLevel, ASSIGNMENT_OFFER_COUNT } from '@/lib/doorDraft';
import { DoorConfig } from '@/types/door';
import { loadCapstones, getCapstones, getCapstoneTriggerLevel, drawCapstoneOffers, CAPSTONE_OFFER_COUNT } from '@/lib/capstones';
import { CapstoneConfig } from '@/types/capstone';
import { getHighscoreBonusMultiplier } from '@/lib/scoring';
import { highscoreBonus } from '@/lib/highscore';
import { unlockedForStart, newlyUnlocked } from '@/lib/loadoutUnlock';
import { runwayBonuses, spendChunks, spendBoons, SPEND_CHUNK_HOURS } from '@/lib/treasury';
import { inflationForLevel } from '@/lib/upgradePricing';
import { useAchievementManager } from './useAchievementManager';
import { useScreenNavigation } from './useScreenNavigation';
import { GameResult, LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';

const BASE_LIVES = 3;
const BASE_CONTINUES = 1;
/** War Chest ceiling: banked overtime never slows balls by more than this. */
const MAX_BANKED_SLOW = 0.08;

export function useGameSession(nav: ReturnType<typeof useScreenNavigation>) {
  const {
    levels,
    currentLevel,
    currentLevelIndex,
    totalLevels,
    isLastLevel,
    isLoading: isLoadingLevels,
    error: levelError,
    loadLevels,
    advanceToNextLevel,
    resetToFirstLevel,
    setLevelIndex,
  } = useLevelManager();

  const {
    upgrades,
    tagSets,
    isLoading: isLoadingUpgrades,
    error: upgradeError,
    loadUpgrades,
    canPurchase: canPurchaseUpgrade,
    isLocked: isUpgradeLocked,
  } = useUpgradeManager();

  const {
    loadouts,
    loadoutLookup,
    ascensionConfig,
    loadLoadouts,
  } = useLoadoutManager();

  const isLoading = isLoadingLevels || isLoadingUpgrades;
  const error = levelError || upgradeError;

  const [totalScore, setTotalScore] = useState(0);
  const [pendingLevelScore, setPendingLevelScore] = useState<LevelScoreData | null>(null);
  const [showLevelComplete, setShowLevelComplete] = useState(false);
  const [ownedUpgradeIds, setOwnedUpgradeIds] = useState<string[]>([]);
  const [currentLives, setCurrentLives] = useState(BASE_LIVES);
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(BASE_LIVES);
  const [cumulativeLockedBalls, setCumulativeLockedBalls] = useState(0);
  const [shopUnlockedCerts, setShopUnlockedCerts] = useState<Certificate[]>([]);
  const [pendingCertUnlocks, setPendingCertUnlocks] = useState<Certificate[]>([]);

  // Clean Release: instant fences carried into the NEXT map after finishing a
  // map under par. Re-evaluated at every level completion (so it lasts exactly
  // one map) and cleared on run start/restart.
  const [carryInstantFences, setCarryInstantFences] = useState(0);

  // Budget Cycle: boons carried into the NEXT map, charged by hours spent in
  // the shop visit just left (see src/lib/treasury.ts). Set on shop exit,
  // zeroed at the next level completion (one-map lifetime) and on run resets.
  // The spend accumulator is a ref because purchases arrive as a synchronous
  // burst right before the shop-exit handler (state would read stale).
  const [carrySpendFences, setCarrySpendFences] = useState(0);
  const [carrySpendFenceSpeed, setCarrySpendFenceSpeed] = useState(0);
  const spentThisShopVisitRef = useRef(0);

  // Assignments (doors): every 5th completed level replaces the shop with a
  // mandatory 1-of-3 door draft. `doorOffers` is rolled entering the draft;
  // `activeDoor` is the picked contract and lives until the NEXT assignment
  // replaces it (all 5 maps + their shops, so shop-facing rewards like extra
  // slots pay out across the whole block). Cleared on ascend and run resets.
  const [doorOffers, setDoorOffers] = useState<DoorConfig[]>([]);
  const [activeDoor, setActiveDoor] = useState<DoorConfig | null>(null);

  // Capstone ("Promotion"): the once-per-run exclusive perk, drafted 1-of-3
  // at the first assignment at/past the trigger level. Permanent for the run
  // (survives ascension); cleared only on run resets.
  const [capstoneOffers, setCapstoneOffers] = useState<CapstoneConfig[]>([]);
  const [capstone, setCapstone] = useState<CapstoneConfig | null>(null);

  // Per-run revive resource ("Continue"). Each run starts with BASE_CONTINUES
  // (+ any certificate grant); spending one on death retries the current level
  // with score + upgrades intact. gameInstanceKey forces GameCanvas to re-init
  // the current level on revive; pendingDeathResult drives the revive overlay.
  const [continuesRemaining, setContinuesRemaining] = useState(BASE_CONTINUES);
  const [gameInstanceKey, setGameInstanceKey] = useState(0);
  const [pendingDeathResult, setPendingDeathResult] = useState<GameResult | null>(null);
  // Guard against a duplicated completion delivery for the same map (see
  // handleLevelComplete); holds the last level number that was scored.
  const lastDeliveredCompletionRef = useRef<number | null>(null);
  // Run-start intro: the first map of a run assembles from shatter tiles
  // (GameCanvas introAssemble). Armed by every fresh-run path, disarmed by the
  // first completed level so mid-run maps just appear as usual.
  const [introAssemblePending, setIntroAssemblePending] = useState(false);
  // When a round is left without the locks the store requires, we still open the
  // store but show it "closed" (see UpgradeShop `closed`) rather than skipping it.
  const [storeClosed, setStoreClosed] = useState(false);

  // Ascension mode: after the final level the player may loop back to level 1
  // with a drafted loadout. Depth 0 = first pass through the levels. Index 0 of
  // draftedLoadoutIds is always the run-start loadout; ascension appends more.
  const [ascensionDepth, setAscensionDepth] = useState(0);
  const [draftedLoadoutIds, setDraftedLoadoutIds] = useState<string[]>([]);

  // Snapshot of the just-finalized run for the result screen (finalizeRun
  // resets the live counters, so the result screen can't read those).
  const [lastRunSummary, setLastRunSummary] = useState<{ levelsCompleted: number; hoursAwarded: number } | null>(null);

  // Names of loadouts that unlocked this run (shown on the result screen).
  const [lastRunLoadoutUnlocks, setLastRunLoadoutUnlocks] = useState<string[]>([]);

  // End-of-run build recap (archetype identity, capstone, per-archetype best).
  const [lastRunRecap, setLastRunRecap] = useState<RunRecap | null>(null);

  // One-time "loadouts unlocked" modal, shown after the first win reveals the
  // loadout system. Armed at the winning level, surfaced when leaving the
  // level-complete overlay (so it doesn't stack on top of it).
  const [showLoadoutsUnlockedModal, setShowLoadoutsUnlockedModal] = useState(false);
  const pendingLoadoutsIntroRef = useRef(false);

  const handleCertificateHourEarned = useCallback(() => {
    // Visual flash handled by consumer; cert manager calls this on point award
  }, []);

  const {
    certificates,
    totalCertificateHours,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    lifetimeHoursSpent,
    runLevelsCompleted,
    runHoursEarned: runHoursAwarded,
    loadCertificates,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    runProgress,
    certBonuses,
    getCertStartingLevel,
    purchaseCertLevel,
    recordMaxTierPurchase,
    checkAchievementUnlocks,
    takePendingUnlocks,
    resetAllData: resetCertData,
  } = useCertificateManager({ onHourEarned: handleCertificateHourEarned });

  const {
    shouldShowFence,
    shouldShowStore,
    shouldShowCertStore,
    shouldShowMover,
    shouldShowTopBar,
    shouldShowBottomBar,
    shouldShowAscension,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
    markAscensionSeen,
    resetAllTutorials,
  } = useTutorialManager();

  const {
    saveCheckpoint: saveRunCheckpoint,
    clearCheckpoints: clearRunCheckpoints,
  } = useCheckpointSnapshots();

  const {
    stats: metaStats,
    wonLoadoutIds,
    loadoutsIntroduced,
    mapHighscores,
    encounteredBallTypeIds,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordAscensionDepth,
    recordPushBonusBanked,
    recordLoadoutWin,
    recordMapHighscore,
    recordBallTypeEncountered,
    recordArchetypeBest,
    introduceLoadouts,
    resetProgression,
  } = useMetaProgression();

  const {
    achievements,
    completedIds: completedAchievementIds,
    activatedIds: activatedAchievementIds,
    bonusModifiers: achievementBonuses,
    checkAndComplete: checkAndCompleteAchievements,
    activateAchievement,
  } = useAchievementManager();

  // Drafted loadouts + the baseline per-depth speed ramp, folded into the
  // same bonus map the achievements/certificates use.
  const loadoutBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const id of draftedLoadoutIds) {
      const loadout = loadoutLookup.get(id);
      if (loadout) bonuses = mergeBonuses(bonuses, loadout.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    if (ascensionDepth > 0) {
      bonuses = mergeBonuses(bonuses, {
        ballSpeedMultiplier: Math.pow(ascensionConfig.speedRampPerDepth, ascensionDepth),
      });
    }
    return bonuses;
  }, [draftedLoadoutIds, loadoutLookup, ascensionDepth, ascensionConfig.speedRampPerDepth]);

  // Set bonuses: free modifier bundles active while the player owns enough
  // upgrades of a tag (tagSets block in upgrades.yml).
  const activeTagSets = useMemo(
    () => computeActiveTagSets(ownedUpgradeIds, upgrades, tagSets),
    [ownedUpgradeIds, upgrades, tagSets]
  );
  const tagSetBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const s of activeTagSets) {
      bonuses = mergeBonuses(bonuses, s.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    return bonuses;
  }, [activeTagSets]);

  const mergedBonuses = useMemo(
    () => mergeBonuses(
      mergeBonuses(mergeBonuses(achievementBonuses, certBonuses), loadoutBonuses),
      mergeBonuses(tagSetBonuses, capstone?.modifiers as Partial<Record<keyof GameModifiers, number>> | undefined),
    ),
    [achievementBonuses, certBonuses, loadoutBonuses, tagSetBonuses, capstone]
  );

  // Two-pass modifier resolution: the base pass aggregates every static source;
  // a second pass folds in run-state-dependent effects that READ base values
  // (War Chest keys off bankedSlowPer50h + the bank; Clean Release off the
  // under-par carry). Both fold through the same merge rules as everything else.
  const baseModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, mergedBonuses);
  const dynamicBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    if (baseModifiers.bankedSlowPer50h > 0 && totalScore > 0) {
      const reduction = Math.min(MAX_BANKED_SLOW, Math.floor(totalScore / 50) * baseModifiers.bankedSlowPer50h);
      if (reduction > 0) bonuses = mergeBonuses(bonuses, { ballSpeedMultiplier: 1 - reduction });
    }
    if (carryInstantFences > 0) {
      bonuses = mergeBonuses(bonuses, { instantFencesPerMap: carryInstantFences });
    }
    // Runway: perks granted while the bank sits at/above the owned thresholds.
    bonuses = mergeBonuses(bonuses, runwayBonuses(totalScore, baseModifiers));
    // Budget Cycle: boons bought by last shop visit's spend (one-map carry).
    if (carrySpendFences > 0) {
      bonuses = mergeBonuses(bonuses, { instantFencesPerMap: carrySpendFences });
    }
    if (carrySpendFenceSpeed > 0) {
      bonuses = mergeBonuses(bonuses, { fenceGenerationSpeedMultiplier: 1 + carrySpendFenceSpeed });
    }
    // Door pick: the chosen risk door's bundle rides along for this map (and
    // the shop after it; see handleContinueFromShop for the expiry).
    if (activeDoor) {
      bonuses = mergeBonuses(bonuses, activeDoor.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    return bonuses;
  }, [baseModifiers, totalScore, carryInstantFences, carrySpendFences, carrySpendFenceSpeed, activeDoor]);
  const finalBonuses = useMemo(
    () => mergeBonuses(mergedBonuses, dynamicBonuses),
    [mergedBonuses, dynamicBonuses]
  );
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, finalBonuses);

  // Mid-run extraContinues grants (Insurance Policy set bonus): when the
  // aggregated value rises, credit the difference to the live counter. Drops
  // (run reset clearing owned upgrades) just re-baseline without deducting.
  const extraContinuesSeen = useRef<number | null>(null);
  useEffect(() => {
    const now = activeModifiers.extraContinues;
    const prev = extraContinuesSeen.current;
    extraContinuesSeen.current = now;
    if (prev !== null && now > prev) {
      setContinuesRemaining(c => c + (now - prev));
    }
  }, [activeModifiers.extraContinues]);

  // Owned-tag tally for the build readout (HUD + shop chips).
  const tagCounts = useMemo(() => ownedTagCounts(ownedUpgradeIds, upgrades), [ownedUpgradeIds, upgrades]);
  const tagSetThreshold = tagSets?.threshold ?? DEFAULT_TAG_SET_THRESHOLD;

  const activeLoadouts = useMemo(
    () => draftedLoadoutIds.map(id => loadoutLookup.get(id)).filter((l): l is NonNullable<typeof l> => l != null),
    [draftedLoadoutIds, loadoutLookup]
  );

  // Per-source breakdown of what feeds activeModifiers, so the bottom-bar panel
  // can attribute each active modifier to the upgrade/cert/achievement/loadout/
  // ascension that produced it.
  const modifierSources = useMemo<ModifierSource[]>(() => {
    const sources: ModifierSource[] = [];

    for (const id of ownedUpgradeIds) {
      const u = upgrades.find(x => x.id === id);
      if (u) sources.push({ kind: 'upgrade', id: u.id, name: u.name, modifiers: u.modifiers });
    }

    for (const cert of certificates) {
      const owned = certLevelsOwned[cert.id] || 0;
      if (owned === 0) continue;
      const mods: Record<string, number> = {};
      for (let i = 0; i < owned; i++) {
        const { type, value } = cert.levels[i].effect;
        if (type === 'startingLevelBonus') continue;
        if (MULTIPLICATIVE_KEYS.includes(type as keyof GameModifiers)) mods[type] = (mods[type] ?? 1) * value;
        else mods[type] = (mods[type] ?? 0) + value;
      }
      if (Object.keys(mods).length > 0) sources.push({ kind: 'certificate', id: cert.id, name: cert.name, modifiers: mods });
    }

    for (const a of achievements) {
      if (!activatedAchievementIds.includes(a.id) || !a.bonus) continue;
      sources.push({ kind: 'achievement', id: a.id, name: a.name, modifiers: { [a.bonus.modifier]: a.bonus.value } });
    }

    for (const l of activeLoadouts) {
      sources.push({ kind: 'loadout', id: l.id, name: l.name, modifiers: l.modifiers });
    }

    for (const s of activeTagSets) {
      sources.push({ kind: 'tagSet', id: s.tag, name: s.name, modifiers: s.modifiers });
    }

    if (activeDoor) {
      sources.push({ kind: 'door', id: activeDoor.id, name: activeDoor.name, modifiers: activeDoor.modifiers });
    }

    if (capstone) {
      sources.push({ kind: 'capstone', id: capstone.id, name: capstone.name, modifiers: capstone.modifiers });
    }

    if (ascensionDepth > 0) {
      sources.push({
        kind: 'ascension',
        id: 'ascension',
        name: String(ascensionDepth),
        modifiers: { ballSpeedMultiplier: Math.pow(ascensionConfig.speedRampPerDepth, ascensionDepth) },
      });
    }

    return sources;
  }, [ownedUpgradeIds, upgrades, certificates, certLevelsOwned, achievements, activatedAchievementIds, activeLoadouts, activeTagSets, activeDoor, capstone, ascensionDepth, ascensionConfig.speedRampPerDepth]);

  // Loadouts offered in the run-start draft: unlocked once the player has
  // enough unique wins (see loadoutUnlock). Ascension uses the full catalogue.
  const availableLoadouts = useMemo(
    () => unlockedForStart(loadouts, wonLoadoutIds.length),
    [loadouts, wonLoadoutIds]
  );

  // Ascension rule: fences wear out after a number of ball hits — generous on
  // early levels, brutal late, plus the Defensive Programming upgrade bonus.
  // null at depth 0 = indestructible fences (the normal game).
  const fenceDurability = useMemo(() => {
    if (ascensionDepth === 0) return null;
    const levelNumber = currentLevelIndex + 1;
    const t = totalLevels > 1 ? Math.min(1, (levelNumber - 1) / (totalLevels - 1)) : 0;
    const base = Math.round(
      ascensionConfig.fenceDurabilityBase +
      (ascensionConfig.fenceDurabilityAtFinal - ascensionConfig.fenceDurabilityBase) * t
    );
    return Math.max(1, base + activeModifiers.fenceDurabilityBonus);
  }, [ascensionDepth, currentLevelIndex, totalLevels, ascensionConfig, activeModifiers.fenceDurabilityBonus]);

  const certSourceIds = useMemo(
    () => new Set(certificates.map(c => c.sourceUpgradeId).filter((id): id is string => id != null)),
    [certificates]
  );

  /**
   * Clear every piece of run-scoped state. Shared by all four run-reset paths
   * (start, play-again, restart, back-to-welcome) so a newly added field can
   * never be forgotten in one of them again. Lives, continues, level index and
   * navigation stay with the call sites - they legitimately differ per path.
   */
  const resetRunScopedState = useCallback(() => {
    setTotalScore(0);
    setOwnedUpgradeIds([]);
    setCarryInstantFences(0);
    setCarrySpendFences(0);
    setCarrySpendFenceSpeed(0);
    spentThisShopVisitRef.current = 0;
    setActiveDoor(null);
    setCapstone(null);
    setPendingLevelScore(null);
    lastDeliveredCompletionRef.current = null;
    setIntroAssemblePending(true);
    setStoreClosed(false);
    setShowLevelComplete(false);
    setCumulativeLockedBalls(0);
    setAscensionDepth(0);
    setDraftedLoadoutIds([]);
    setLastRunSummary(null);
    setLastRunLoadoutUnlocks([]);
    resetRunProgress();
  }, [resetRunProgress]);

  const handleStartGame = useCallback(async (forceLevel?: number, skipDraft?: boolean) => {
    // The loadout catalogue backs the run-start draft, but a load failure
    // should not hard-gate starting a run.
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadCertificates(),
      loadLoadouts(),
      // Ball catalogue (balls.yml). Failure falls back to built-in defaults, so
      // it does not gate starting a run — same treatment as loadouts.
      loadBallTypes(),
      // Door pool (doors.yml). On failure assignment levels fall back to the shop.
      loadDoors(),
      // Capstone pool (capstones.yml). Failure just skips the Promotion draft.
      loadCapstones(),
    ]);

    if (levelsSuccess && upgradesSuccess) {
      resetRunScopedState();

      const certBonusLives = (certBonuses.extraLives as number | undefined) ?? 0;
      const startingLives = BASE_LIVES + certBonusLives;
      setCurrentLives(startingLives);
      setLivesAtLevelStart(startingLives);
      setContinuesRemaining(BASE_CONTINUES + ((certBonuses.extraContinues as number | undefined) ?? 0));
      setPendingDeathResult(null);

      if (forceLevel !== undefined) {
        setLevelIndex(forceLevel - 1);
      } else {
        const certStartLevel = getCertStartingLevel();
        const queryLevel = parseInt(new URLSearchParams(window.location.search).get('level') || '0', 10);
        if (queryLevel > 0) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        const startingLevel = Math.max(certStartLevel, queryLevel || 0);
        if (startingLevel > 1) {
          setLevelIndex(startingLevel - 1);
        } else {
          resetToFirstLevel();
        }
      }

      // A fresh run drafts a loadout first, but the loadout system only appears
      // once it's been introduced (after the first win). The first run and the
      // ?level= debug path go straight into the game.
      if (skipDraft || !loadoutsIntroduced) nav.startGame();
      else nav.goToRunDraft();
    }
  }, [loadLevels, loadUpgrades, loadCertificates, loadLoadouts, nav.startGame, nav.goToRunDraft, setLevelIndex, resetToFirstLevel, certBonuses, getCertStartingLevel, resetRunScopedState, loadoutsIntroduced]);

  // End-of-run build recap: name the build from its archetype lean and score
  // the banked overtime against the dominant archetype's personal best.
  const captureRunRecap = useCallback((finalScore: number) => {
    const identity = computeBuildIdentity(tagCounts);
    let previousBest: number | null = null;
    let isArchetypeRecord = false;
    if (identity.primary) {
      const res = recordArchetypeBest(identity.primary, finalScore);
      previousBest = res.previous;
      isArchetypeRecord = res.isRecord;
    }
    setLastRunRecap({
      ...identity,
      tagCounts: Object.fromEntries(tagCounts),
      capstoneId: capstone?.id ?? null,
      capstoneName: capstone?.name ?? null,
      score: finalScore,
      isArchetypeRecord,
      previousBest,
    });
  }, [tagCounts, capstone, recordArchetypeBest]);

  const finalizeAndShowResult = useCallback((result: GameResult) => {
    const levelsCompleted = runLevelsCompleted;
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
    captureRunRecap(totalScore);
    nav.endGame({
      ...result,
      totalScore,
      ascensionDepth: ascensionDepth > 0 ? ascensionDepth : undefined,
      loadoutNames: ascensionDepth > 0 ? activeLoadouts.map(l => l.name) : undefined,
    });
  }, [nav.endGame, totalScore, finalizeRun, ascensionDepth, runLevelsCompleted, activeModifiers.extraCertificateHours, activeLoadouts, captureRunRecap]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // On death with a Continue banked, defer finalizing and offer a revive.
    if (!result.isWin && continuesRemaining > 0) {
      setPendingDeathResult(result);
      return;
    }
    finalizeAndShowResult(result);
  }, [continuesRemaining, finalizeAndShowResult]);

  /** Spend a Continue: refill lives and retry the current level (score + upgrades kept). */
  const handleSpendContinue = useCallback(() => {
    setContinuesRemaining(n => Math.max(0, n - 1));
    const startingLives = BASE_LIVES + ((certBonuses.extraLives as number | undefined) ?? 0);
    const refilled = Math.max(1, Math.max(currentLives, startingLives));
    setCurrentLives(refilled);
    setLivesAtLevelStart(refilled);
    setPendingDeathResult(null);
    setGameInstanceKey(k => k + 1); // remount the game view -> current level re-inits
  }, [certBonuses, currentLives]);

  /** Decline the revive: finalize the deferred death and show the result screen. */
  const handleDeclineContinue = useCallback(() => {
    const result = pendingDeathResult;
    setPendingDeathResult(null);
    if (result) finalizeAndShowResult(result);
  }, [pendingDeathResult, finalizeAndShowResult]);

  const handleLivesChange = useCallback((newLives: number) => {
    const livesLost = currentLives - newLives;
    if (livesLost > 0) recordLivesLost(livesLost);
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    const currentLevelNum = currentLevelIndex + 1;
    // A completion can only be delivered once per map: a stale second pipeline
    // (e.g. a leftover dissolve timeout firing after the overlay was already
    // continued) would double-score the level and resurrect the overlay over
    // whatever screen came next - re-running the assignment phase and showing
    // a second Promotion draft. The ref resets with each new run.
    if (lastDeliveredCompletionRef.current === currentLevelNum) return;
    lastDeliveredCompletionRef.current = currentLevelNum;
    setIntroAssemblePending(false); // the run is underway: later maps appear as usual
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    // Levels completed while ascended count more toward Certificate Hours
    incrementRunLevel(1 + ascensionDepth);

    if (currentLives >= livesAtLevelStart) recordPerfectLevel();

    // Survived a push-your-luck round and banked the bonus (failed pushes
    // also carry a pushBonus, so check the flag too)
    const bankedPush = (scoreData.pushBonus ?? 0) > 0 && !scoreData.pushFailed;
    if (bankedPush) recordPushBonusBanked();

    // Clean Release: an under-par finish grants instant fences on the NEXT
    // map. Re-evaluated on every completion, so the carry lasts exactly one map.
    setCarryInstantFences(
      (scoreData.fencesUnderPar ?? 0) > 0 ? activeModifiers.underParInstantFence : 0
    );
    // Budget Cycle boons expire with the map they were bought for (the next
    // shop exit re-grants them if the player spends again).
    setCarrySpendFences(0);
    setCarrySpendFenceSpeed(0);

    const projectedStats = {
      highestLevelReached: Math.max(metaStats.highestLevelReached, currentLevelNum),
      totalFencesDrawn: metaStats.totalFencesDrawn + (scoreData.cutCount || 0),
      totalLevelsCompletedWithoutLoss:
        currentLives >= livesAtLevelStart
          ? metaStats.totalLevelsCompletedWithoutLoss + 1
          : metaStats.totalLevelsCompletedWithoutLoss,
      totalLivesLost: metaStats.totalLivesLost,
      deepestAscension: Math.max(metaStats.deepestAscension, ascensionDepth),
      pushBonusesBanked: metaStats.pushBonusesBanked + (bankedPush ? 1 : 0),
    };
    checkAndCompleteAchievements(projectedStats);

    // Beating the final level = a win. The very first win reveals the loadout
    // system (the modal is surfaced when leaving the level-complete overlay).
    // Credit the run-start loadout (index 0) toward unique wins, and remember
    // any loadouts that just unlocked so the result screen can celebrate them.
    // Skipped runs (no drafted loadout) and repeat wins with the same loadout
    // do not advance the count.
    if (isLastLevel) {
      if (introduceLoadouts()) pendingLoadoutsIntroRef.current = true;
      const startLoadoutId = draftedLoadoutIds[0];
      if (startLoadoutId) {
        const { added, prevCount, newCount } = recordLoadoutWin(startLoadoutId);
        if (added) {
          const unlocked = newlyUnlocked(loadouts, prevCount, newCount).map(l => l.name);
          if (unlocked.length > 0) setLastRunLoadoutUnlocks(unlocked);
        }
      }
    }

    // Map highscore (#45): record this map's base score and, if it beat the
    // map's previous highscore, credit a bonus multiplier on TOP of the base
    // (applied after the per-map cap, so beating a record always pays). A map's
    // first-ever completion just sets the baseline, no bonus.
    const baseLevelScore = scoreData.levelScore;
    let highscoreBonusEarned = 0;
    let beatHighscore = false;
    let previousHighscore: number | undefined;
    if (scoreData.levelId) {
      const { previous, isRecord } = recordMapHighscore(scoreData.levelId, baseLevelScore);
      if (isRecord) {
        beatHighscore = true;
        previousHighscore = previous ?? undefined;
        highscoreBonusEarned = highscoreBonus(previous, baseLevelScore, getHighscoreBonusMultiplier());
      }
    }

    const levelOvertime = baseLevelScore + highscoreBonusEarned;

    setTotalScore(totalScore + levelOvertime);
    setPendingLevelScore({
      ...scoreData, levelScore: levelOvertime, tierMultiplier: 1,
      beatHighscore, previousHighscore, highscoreBonus: highscoreBonusEarned,
    });
    setShowLevelComplete(true);

    if (scoreData.lockedBallsCount && scoreData.lockedBallsCount > 0) {
      setCumulativeLockedBalls(prev => prev + scoreData.lockedBallsCount!);
    }

    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, recordPushBonusBanked, currentLives, livesAtLevelStart, incrementRunLevel, ascensionDepth, activeModifiers.underParInstantFence, checkAndCompleteAchievements, metaStats, isLastLevel, draftedLoadoutIds, recordLoadoutWin, recordMapHighscore, introduceLoadouts, loadouts]);

  /**
   * Enter the assignment draft (mandatory 1-of-3 door pick). If the door pool
   * failed to load, fall back to the regular shop so the level exit never
   * dead-ends without a screen.
   */
  const proceedToAssignment = useCallback(() => {
    const doorPool = getDoors();
    if (doorPool.length > 0) {
      setDoorOffers(drawDoorOffers(doorPool, ASSIGNMENT_OFFER_COUNT));
      nav.goToDoorDraft();
      return;
    }
    nav.goToUpgradeShop();
  }, [nav.goToDoorDraft, nav.goToUpgradeShop]);

  /**
   * Assignment level (every 5th): no shop. Route straight into the capstone
   * draft when the Promotion is due, otherwise into the assignment draft.
   */
  const beginAssignmentPhase = useCallback(() => {
    setPendingLevelScore(null);
    // Capstone ("Promotion"): the first assignment at/past the trigger level
    // routes through the mandatory 1-of-3 perk draft, once per run. ">=" so
    // runs that resume past the exact trigger level still get theirs.
    const capstonePool = getCapstones();
    if (!capstone && capstonePool.length > 0 && currentLevelIndex + 1 >= getCapstoneTriggerLevel()) {
      setCapstoneOffers(drawCapstoneOffers(capstonePool, CAPSTONE_OFFER_COUNT));
      nav.goToCapstoneDraft();
      return;
    }
    proceedToAssignment();
  }, [capstone, currentLevelIndex, nav.goToCapstoneDraft, proceedToAssignment]);

  /**
   * Post-shop bookkeeping shared by the shop's Continue button and the
   * lock-gated skip: save the level-picker checkpoint on 5th levels, surface
   * any pending cert unlocks, clear the pending score, then advance and play.
   */
  const finishShopPhase = useCallback(() => {
    const nextLevelNumber = currentLevelIndex + 2;
    // Level-picker snapshots only describe depth-0 runs, so skip them while ascended
    if (nextLevelNumber % 5 === 0 && ascensionDepth === 0) {
      saveRunCheckpoint({ level: nextLevelNumber, totalScore, ownedUpgradeIds, lives: currentLives, savedAt: Date.now() });
    }
    const pendingUnlocks = takePendingUnlocks();
    if (pendingUnlocks.length > 0) setPendingCertUnlocks(pendingUnlocks);
    setShopUnlockedCerts([]);
    setPendingLevelScore(null);
    advanceToNextLevel();
    nav.goToGame();
  }, [currentLevelIndex, ascensionDepth, saveRunCheckpoint, totalScore, ownedUpgradeIds, currentLives, takePendingUnlocks, advanceToNextLevel, nav.goToGame]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    setPendingCertUnlocks([]);
    // The first win armed the loadouts-unlocked modal; show it now (it overlays
    // whatever screen we navigate to next).
    if (pendingLoadoutsIntroRef.current) {
      pendingLoadoutsIntroRef.current = false;
      setShowLoadoutsUnlockedModal(true);
    }
    if (isLastLevel) {
      // Beat the final level: offer the ascend-or-retire choice. The pending
      // level score is kept so handleRetire can put it on the result screen.
      nav.goToAscensionDraft();
    } else if (isAssignmentLevel(currentLevelIndex + 1)) {
      beginAssignmentPhase();
    } else {
      // The shop is only earned by locking balls this round: at least one lock,
      // or two when the map offered three or more balls. We still OPEN the shop
      // when short, but it opens "closed" (no purchases) so the player sees what
      // they missed instead of the store being silently skipped.
      const locksThisRound = pendingLevelScore?.lockedBallsCount ?? 0;
      const ballsOnMap = currentLevel?.maxBalls ?? currentLevel?.balls?.length ?? 1;
      const locksRequired = ballsOnMap >= 3 ? 2 : 1;
      setStoreClosed(locksThisRound < locksRequired);
      nav.goToUpgradeShop();
    }
  }, [isLastLevel, currentLevelIndex, beginAssignmentPhase, pendingLevelScore, currentLevel, nav.goToAscensionDraft, nav.goToUpgradeShop]);

  const handleDismissLoadoutsUnlocked = useCallback(() => {
    setShowLoadoutsUnlockedModal(false);
  }, []);

  /** Ascend: draft a loadout and loop back to level 1 at depth + 1. */
  const handleAscend = useCallback((loadoutId: string) => {
    const newDepth = ascensionDepth + 1;
    setDraftedLoadoutIds(prev => [...prev, loadoutId]);
    setAscensionDepth(newDepth);
    recordAscensionDepth(newDepth);

    // Refill lives to the run's starting value (never down), then apply the
    // drafted loadout's life delta once — same as buying an extraLives upgrade.
    const startingLives = BASE_LIVES + ((certBonuses.extraLives as number | undefined) ?? 0);
    const livesDelta = loadoutLookup.get(loadoutId)?.modifiers.extraLives ?? 0;
    const refilled = Math.max(1, Math.max(currentLives, startingLives) + livesDelta);
    setCurrentLives(refilled);
    setLivesAtLevelStart(refilled);

    setPendingLevelScore(null);
    setActiveDoor(null); // the pre-ascension map's door does not follow into the loop
    resetToFirstLevel(); // also re-randomizes the level variants for the new loop
    nav.goToGame();
  }, [ascensionDepth, recordAscensionDepth, certBonuses, loadoutLookup, currentLives, resetToFirstLevel, nav.goToGame]);

  /**
   * Confirm the run-start loadout draft: adopt the chosen loadout (or none on
   * skip) at depth 0, then enter the game. Applies the loadout's extraLives
   * delta once, mirroring handleAscend.
   */
  const handleConfirmLoadout = useCallback((loadoutId: string | null) => {
    if (loadoutId) {
      setDraftedLoadoutIds([loadoutId]);
      const startingLives = BASE_LIVES + ((certBonuses.extraLives as number | undefined) ?? 0);
      const livesDelta = loadoutLookup.get(loadoutId)?.modifiers.extraLives ?? 0;
      const lives = Math.max(1, startingLives + livesDelta);
      setCurrentLives(lives);
      setLivesAtLevelStart(lives);
    } else {
      setDraftedLoadoutIds([]);
    }
    nav.startGame();
  }, [certBonuses, loadoutLookup, nav.startGame]);

  /** Retire: bank the run and show the result screen. */
  const handleRetire = useCallback(() => {
    const levelsCompleted = runLevelsCompleted;
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
    captureRunRecap(totalScore);
    nav.endGame({
      isWin: true,
      remainingPercent: pendingLevelScore?.remainingPercent || 0,
      levelId: currentLevel?.id || '',
      levelNumber: currentLevelIndex + 1,
      completedAllLevels: true,
      totalScore,
      levelScore: pendingLevelScore?.levelScore,
      cutCount: pendingLevelScore?.cutCount,
      expectedCuts: pendingLevelScore?.expectedCuts,
      basePoints: pendingLevelScore?.basePoints,
      ascensionDepth: ascensionDepth > 0 ? ascensionDepth : undefined,
      loadoutNames: ascensionDepth > 0 ? activeLoadouts.map(l => l.name) : undefined,
    });
    setPendingLevelScore(null);
  }, [runLevelsCompleted, finalizeRun, activeModifiers.extraCertificateHours, nav.endGame, pendingLevelScore, currentLevel, currentLevelIndex, totalScore, ascensionDepth, activeLoadouts, captureRunRecap]);

  const handlePurchaseUpgrade = useCallback((upgradeId: string, price: number) => {
    setTotalScore(prev => prev - price);
    setOwnedUpgradeIds(prev => [...prev, upgradeId]);
    // Budget Cycle: purchases land as a synchronous burst right before the
    // shop-exit handler, so the visit's spend accumulates in a ref.
    spentThisShopVisitRef.current += price;

    const upgrade = upgrades.find(u => u.id === upgradeId);
    const extraLives = upgrade?.modifiers?.extraLives;
    if (extraLives && typeof extraLives === 'number') {
      setCurrentLives(prev => prev + extraLives);
    }

    // Upgrade-chain certs credit the "max tier". For a tier-3 choice, either
    // option counts, so credit the choiceGroup (which is named after the cert's
    // sourceUpgradeId) rather than the specific variant id.
    const certKey = upgrade?.choiceGroup ?? upgradeId;
    if (certSourceIds.has(certKey)) {
      const unlocks = recordMaxTierPurchase(certKey);
      if (unlocks.length > 0) setShopUnlockedCerts(prev => [...prev, ...unlocks]);
    }
  }, [upgrades, certSourceIds, recordMaxTierPurchase]);

  const handleContinueFromShop = useCallback(() => {
    // Budget Cycle: this visit's spend buys next-map boons. Granted here and
    // expired at the next level completion. The chunk scales with the same
    // market-rate inflation as prices (see upgradePricing.inflationForLevel).
    const chunkHours = Math.round(SPEND_CHUNK_HOURS * inflationForLevel(currentLevelIndex + 1));
    const chunks = spendChunks(spentThisShopVisitRef.current, chunkHours);
    spentThisShopVisitRef.current = 0;
    const boons = spendBoons(chunks, activeModifiers);
    setCarrySpendFences(boons.instantFences);
    setCarrySpendFenceSpeed(boons.fenceSpeedBonus);

    finishShopPhase();
  }, [currentLevelIndex, activeModifiers, finishShopPhase]);

  /** Capstone draft pick: permanent for the run, then on to the assignment. */
  const handleSelectCapstone = useCallback((pick: CapstoneConfig) => {
    setCapstone(pick);
    proceedToAssignment();
  }, [proceedToAssignment]);

  /**
   * Assignment pick (mandatory): the chosen contract replaces the previous
   * one and runs until the next assignment swaps it out.
   */
  const handleSelectDoor = useCallback((door: DoorConfig) => {
    setActiveDoor(door);
    advanceToNextLevel();
    nav.goToGame();
  }, [advanceToNextLevel, nav.goToGame]);

  const handlePurchaseCertLevel = useCallback((certId: string, targetLevel: number) => {
    purchaseCertLevel(certId, targetLevel);
  }, [purchaseCertLevel]);

  const handlePlayAgain = useCallback((startLevel?: number) => {
    resetRunScopedState();

    const certBonusLives = certBonuses.extraLives ?? 0;
    const startingLives = BASE_LIVES + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    setContinuesRemaining(BASE_CONTINUES + ((certBonuses.extraContinues as number | undefined) ?? 0));
    setPendingDeathResult(null);

    if (startLevel !== undefined) {
      setLevelIndex(startLevel - 1);
    } else {
      clearRunCheckpoints();
      const certStartLevel = getCertStartingLevel();
      if (certStartLevel > 1) {
        setLevelIndex(certStartLevel - 1);
      } else {
        resetToFirstLevel();
      }
    }

    if (loadoutsIntroduced) nav.goToRunDraft();
    else nav.startGame();
  }, [resetToFirstLevel, nav.goToRunDraft, nav.startGame, setLevelIndex, certBonuses, getCertStartingLevel, resetRunScopedState, clearRunCheckpoints, loadoutsIntroduced]);

  const handleRestartRun = useCallback(() => {
    resetRunScopedState();
    clearRunCheckpoints();

    const certBonusLives = certBonuses.extraLives ?? 0;
    const startingLives = BASE_LIVES + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    setContinuesRemaining(BASE_CONTINUES + ((certBonuses.extraContinues as number | undefined) ?? 0));
    setPendingDeathResult(null);

    resetToFirstLevel();
    if (loadoutsIntroduced) nav.goToRunDraft();
    else nav.startGame();
  }, [resetToFirstLevel, nav.goToRunDraft, nav.startGame, certBonuses, resetRunScopedState, clearRunCheckpoints, loadoutsIntroduced]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
    resetRunScopedState();
    setCurrentLives(BASE_LIVES);
    setPendingDeathResult(null);
    nav.goToWelcome();
  }, [resetToFirstLevel, nav.goToWelcome, resetRunScopedState]);

  const handleOpenCertificateStore = useCallback(async () => {
    // Upgrades too: locked-cert tooltips name the upgrade that unlocks them,
    // and the catalogue isn't loaded yet when entering from the welcome screen.
    await Promise.all([loadCertificates(), loadUpgrades()]);
    nav.goToCertificateStore();
  }, [loadCertificates, loadUpgrades, nav.goToCertificateStore]);

  const handleOpenLoadouts = useCallback(async () => {
    // The catalogue isn't loaded yet when entering from the welcome screen.
    await loadLoadouts();
    nav.goToLoadouts();
  }, [loadLoadouts, nav.goToLoadouts]);

  const handleReEnableAllTutorials = useCallback(() => {
    resetAllTutorials();
  }, [resetAllTutorials]);

  const handleResetCertificates = useCallback(() => {
    resetCertData();
    resetProgression();
  }, [resetCertData, resetProgression]);

  // Load the ball catalogue (balls.yml) once on mount so the Tutorial reflects
  // edits even before a run starts. handleStartGame reloads it per run.
  useEffect(() => { loadBallTypes(); }, []);

  // Sync completed achievements into cert manager for achievement-locked certs
  useEffect(() => {
    if (completedAchievementIds.length > 0) {
      checkAchievementUnlocks(completedAchievementIds);
    }
  }, [completedAchievementIds, checkAchievementUnlocks]);

  // Auto-start when ?level= query param is present
  const levelQueryHandled = useRef(false);
  useEffect(() => {
    if (levelQueryHandled.current) return;
    const levelParam = new URLSearchParams(window.location.search).get('level');
    if (levelParam && parseInt(levelParam, 10) > 0) {
      levelQueryHandled.current = true;
      handleStartGame(undefined, true); // debug jump skips the loadout draft
    }
  }, [handleStartGame]);

  return {
    // Level state
    currentLevel,
    currentLevelIndex,
    totalLevels,
    // Loading
    isLoading,
    error,
    // Run state
    totalScore,
    currentLives,
    ownedUpgradeIds,
    showLevelComplete,
    pendingLevelScore,
    cumulativeLockedBalls,
    // Upgrades
    upgrades,
    canPurchaseUpgrade,
    isUpgradeLocked,
    // Tutorial flags
    showInGameTutorial: shouldShowFence,
    shouldShowStore,
    shouldShowCertStore,
    showMoverTutorial: shouldShowMover,
    showTopBarTutorial: shouldShowTopBar,
    showBottomBarTutorial: shouldShowBottomBar,
    shouldShowAscension,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
    markAscensionSeen,
    // Certificates
    certificates,
    totalCertificateHours,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    lifetimeHoursSpent,
    shopUnlockedCerts,
    pendingCertUnlocks,
    // Achievements
    achievements,
    completedAchievementIds,
    activatedAchievementIds,
    activateAchievement,
    // Meta progression
    metaStats,
    mapHighscores,
    encounteredBallTypeIds,
    recordBallTypeEncountered,
    runHoursAwarded,
    runLevelsCompleted,
    lastRunHoursAwarded: lastRunSummary?.hoursAwarded ?? 0,
    lastRunLevelsCompleted: lastRunSummary?.levelsCompleted ?? 0,
    lastRunLoadoutUnlocks,
    lastRunRecap,
    // Head Start certificates: the level a fresh run begins at (1 = none).
    // The result screen uses it to label Play Again as "Continue from level N".
    certStartingLevel: getCertStartingLevel(),
    // Loadouts + Ascension mode
    ascensionDepth,
    loadouts,
    availableLoadouts,
    draftedLoadoutIds,
    activeLoadouts,
    wonLoadoutIds,
    loadoutsIntroduced,
    showLoadoutsUnlockedModal,
    fenceDurability,
    // Continue (per-run revive)
    continuesRemaining,
    gameInstanceKey,
    introAssemblePending,
    storeClosed,
    pendingDeathResult,
    // Modifiers / bonuses
    activeModifiers,
    modifierSources,
    achievementBonuses: mergedBonuses,
    certificateProgress: runProgress,
    // Build readout (archetype tags + set bonuses)
    tagCounts,
    tagSetThreshold,
    activeTagSets,
    // Doors (branching map choice)
    doorOffers,
    activeDoor,
    // The map the door draft previews (null past the final level).
    nextLevel: levels[currentLevelIndex + 1] ?? null,
    handleSelectDoor,
    // Capstone ("Promotion")
    capstoneOffers,
    capstone,
    handleSelectCapstone,
    // Callbacks
    handleStartGame,
    handleConfirmLoadout,
    handleGameEnd,
    handleSpendContinue,
    handleDeclineContinue,
    handleLivesChange,
    handleLevelComplete,
    handleContinueFromOverlay,
    handleDismissLoadoutsUnlocked,
    handleAscend,
    handleRetire,
    handlePurchaseUpgrade,
    handleContinueFromShop,
    handlePurchaseCertLevel,
    handlePlayAgain,
    handleRestartRun,
    handleBackToWelcome,
    handleOpenCertificateStore,
    handleOpenLoadouts,
    handleReEnableAllTutorials,
    handleResetCertificates,
  };
}

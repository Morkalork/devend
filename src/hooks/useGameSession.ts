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
import { useUpgradeManager, getLoadedUpgrades } from './useUpgradeManager';
import { useLoadoutManager } from './useLoadoutManager';
import { useActiveModifiers, mergeBonuses, GameModifiers, MULTIPLICATIVE_KEYS, ModifierSource } from './useActiveModifiers';
import { useTutorialManager } from './useTutorialManager';
import { useCheckpointSnapshots } from './useCheckpointSnapshots';
import { useRunSave, RunSave } from './useRunSave';
import { useHallOfFame } from './useHallOfFame';
import { paceDelta, aheadThroughMaps, RunRankInfo } from '@/lib/runLedger';
import { setRunSeedText, getRunRng, todayKey, dailySeedText } from '@/lib/runRng';
import { useCertificateManager, getLoadedCertBonuses, getLoadedCertStartingLevel } from './useCertificateManager';
import { useMetaProgression } from './useMetaProgression';
import { loadBallTypes } from '@/lib/ballTypes';
import { GameFeature, getFeature, featuresUnlockedAtLevel, loadFeatures } from '@/lib/features';
import { performTotalReset } from '@/lib/totalReset';
import { loadAbilities } from '@/lib/abilities';
import { computeActiveTagSets, ownedTagCounts, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { computeBuildIdentity, RunRecap } from '@/lib/buildRecap';
import { loadDoors, getDoors, drawDoorOffers, isAssignmentLevel, ASSIGNMENT_OFFER_COUNT } from '@/lib/doorDraft';
import { scaleOffersForBlock } from '@/lib/assignmentScaling';
import { assignmentRewardForBlock, eligibleTierUpgrades } from '@/lib/assignments';
import { drawRandom } from '@/lib/yamlCatalogue';
import { isOnboardingMap, ONBOARDING_MAP_ID } from '@/lib/onboardingMap';
import { loadMapMutators } from '@/lib/mapMutators';
import { loadMapObjectives } from '@/lib/mapObjectives';
import { AssignmentConfig, AssignmentMapResult } from '@/types/assignment';
import { UpgradeConfig, UpgradeTier } from '@/types/upgrade';
import { loadCapstones, getCapstones, getCapstoneTriggerLevel, drawCapstoneOffers, CAPSTONE_OFFER_COUNT } from '@/lib/capstones';
import { CapstoneConfig } from '@/types/capstone';
import { getHighscoreBonusMultiplier } from '@/lib/scoring';
import { highscoreBonus } from '@/lib/highscore';
import { unlockedForStart, newlyUnlocked } from '@/lib/loadoutUnlock';
import { runwayBonuses, spendChunks, spendBoons, spendChunkCap, SPEND_CHUNK_HOURS } from '@/lib/treasury';
import { inflationForLevel } from '@/lib/upgradePricing';
import { useAchievementManager } from './useAchievementManager';
import { useScreenNavigation } from './useScreenNavigation';
import { GameResult, LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';
import { analytics } from '@/lib/analytics';
import { baseStartingLives, isInfiniteLivesEnabled, debugAscensionDepth, debugMutatorId, forcedTilts } from '@/lib/devFlags';
import { hasAnyMapTuning } from '@/lib/mapTuning';
import { TenureOffer, TENURE_OFFER_COUNT, tenureSteps, rollTenureOffers } from '@/lib/tenure';
import { ascensionRules, shopOpensAfter, NO_ASCENSION_RULES, LADDER_LENGTH } from '@/lib/ascensionLadder';
import { computeScalingBonuses, scalingReadouts } from '@/lib/upgradeScaling';
import { registerRunFlush, installRunFlushListeners } from '@/lib/runSaveFlush';

/**
 * Drop one debug query param, keeping the rest. The old code replaced the whole
 * search string, which meant ?ascension=3&level=12 lost the ascension jump the
 * moment the level jump consumed its own param.
 */
function stripQueryParam(name: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    const search = url.searchParams.toString();
    window.history.replaceState(null, '', url.pathname + (search ? `?${search}` : ''));
  } catch {
    /* no history API (embedded webview): the param is harmless if it lingers */
  }
}

const NORMAL_LIVES = 3;
/**
 * Lives a run starts with, before certificate/loadout bonuses. A function, not a
 * constant, because the admin "Infinite lives" flag overrides it and must take
 * effect on the next run without a reload (src/lib/devFlags.ts).
 */
const baseLives = (): number => baseStartingLives(NORMAL_LIVES);
/** Warm Cache: cap the cleared-map fence-speed ramp so a deep run can't run away
 *  (10 maps × the coefficient is the ceiling). */
const WARM_CACHE_RAMP_CAP = 10;
/** Runs start with NO free Continue: buy Golden Parachute (the priciest shop
 *  offer), earn one via certificates / the Insurance Policy set bonus, or
 *  complete level FREE_CONTINUE_LEVEL. */
const BASE_CONTINUES = 0;
/** Completing this level grants 1 free Continue (once per pass; an ascension
 *  loop that reaches it again grants another). */
const FREE_CONTINUE_LEVEL = 20;
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
    restoreSequence,
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
  const [currentLives, setCurrentLives] = useState(baseLives);
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(baseLives);
  const [cumulativeLockedBalls, setCumulativeLockedBalls] = useState(0);
  const [shopUnlockedCerts, setShopUnlockedCerts] = useState<Certificate[]>([]);
  const [pendingCertUnlocks, setPendingCertUnlocks] = useState<Certificate[]>([]);

  // Clean Release: instant fences carried into the NEXT map after finishing a
  // map under par. Re-evaluated at every level completion (so it lasts exactly
  // one map) and cleared on run start/restart.
  const [carryInstantFences, setCarryInstantFences] = useState(0);
  // Run-wide ability charges earned by smashing treasure chests (issue #38):
  // { abilityId -> count }. Banked across maps for the rest of the run; the
  // ability bar reads them, pressing a button spends one.
  const [abilityCharges, setAbilityCharges] = useState<Record<string, number>>({});

  // Budget Cycle: boons carried into the NEXT map, charged by hours spent in
  // the shop visit just left (see src/lib/treasury.ts). Set on shop exit,
  // zeroed at the next level completion (one-map lifetime) and on run resets.
  // The spend accumulator is a ref because purchases arrive as a synchronous
  // burst right before the shop-exit handler (state would read stale).
  const [carrySpendFences, setCarrySpendFences] = useState(0);
  const [carrySpendFenceSpeed, setCarrySpendFenceSpeed] = useState(0);
  const [carrySpendCapture, setCarrySpendCapture] = useState(0);
  const spentThisShopVisitRef = useRef(0);

  // Free-store-item pickups (issue #48): each claimed token makes the next
  // OPEN store's cheapest offer free. Unlike the one-map carries above, this
  // persists until actually consumed by an open store visit (closed stores
  // don't burn it), and rides in the run save.
  const [carryFreeShopItems, setCarryFreeShopItems] = useState(0);

  // Issue #49: how the CURRENT contract is going, accumulated across its
  // 5-level block (a ref: bumped inside synchronous score/lives flows) and
  // snapshotted into lastContractSummary when the next assignment draft opens,
  // so the Assignment view can show how the finished contract went.
  const blockStatsRef = useRef({ overtime: 0, maps: 0, locks: 0, livesLost: 0 });
  const [lastContractSummary, setLastContractSummary] = useState<
    {
      doorId: string; doorName: string; overtime: number; maps: number; locks: number; livesLost: number;
      // Issue #60: how the mission resolved. `rewardLabel` is the reached tier's
      // label (null = mission missed); `missionText` recaps the task.
      missionText?: string; rewardLabel?: string | null;
    } | null
  >(null);
  // Issue #60: per-map results captured across the active assignment's block,
  // for multi-map mission evaluation (the live HUD reads completed maps + the
  // in-progress map; the block-end reward grant reads completed maps only).
  const [blockResults, setBlockResults] = useState<AssignmentMapResult[]>([]);
  // Issue #60: run-scoped modifier bundles granted by completed assignment
  // rewards (scope: 'run'). Merged into the run's modifiers like a capstone.
  const [assignmentRewardMods, setAssignmentRewardMods] = useState<Record<string, number>>({});
  // Issue #60: a tier-draft reward owed by the just-finished assignment, shown
  // as a 1-of-3 upgrade pick before the next assignment draft. null = none owed.
  const [pendingTierDraft, setPendingTierDraft] = useState<{ tier: UpgradeTier; offers: UpgradeConfig[] } | null>(null);
  /**
   * Tenure (issue #75): offers rolled at run start from the PREVIOUS ended
   * run's depth, plus whether the loadout draft still follows once picked.
   * Rolled fresh per run, so a retry is a new draw rather than the same cards.
   */
  const [pendingTenure, setPendingTenure] = useState<{
    offers: TenureOffer[];
    earnedAtLevel: number;
    thenDraftLoadout: boolean;
    /** What the previous run owned, so the screen can badge the continuation. */
    lastRunUpgradeIds: string[];
  } | null>(null);
  // Issue #63: when the "Assignment Complete" summary is showing, whether its
  // Continue should route into the run finale (ascension) rather than the next
  // block's drafts. Set for the final block; cleared for mid-run boundaries.
  const [summaryIsFinal, setSummaryIsFinal] = useState(false);

  // Assignments (doors): every 5th completed level replaces the shop with a
  // mandatory 1-of-3 door draft. `doorOffers` is rolled entering the draft;
  // `activeDoor` is the picked contract and lives until the NEXT assignment
  // replaces it (all 5 maps + their shops, so shop-facing rewards like extra
  // slots pay out across the whole block). Cleared on ascend and run resets.
  const [doorOffers, setDoorOffers] = useState<AssignmentConfig[]>([]);
  const [activeDoor, setActiveDoor] = useState<AssignmentConfig | null>(null);

  // Capstone ("Promotion"): the once-per-run exclusive perk, drafted 1-of-3
  // at the first assignment at/past the trigger level. Permanent for the run
  // (survives ascension); cleared only on run resets.
  const [capstoneOffers, setCapstoneOffers] = useState<CapstoneConfig[]>([]);
  const [capstone, setCapstone] = useState<CapstoneConfig | null>(null);

  // Per-run revive resource ("Continue"). Each run starts with BASE_CONTINUES
  // (none; + any certificate grant); spending one on death retries the current
  // level with score + upgrades intact. gameInstanceKey forces GameCanvas to re-init
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
  // Locks made this round vs. required (for the closed-store "X/Y" banner, #67).
  const [storeLockProgress, setStoreLockProgress] = useState<{ have: number; need: number }>({ have: 0, need: 1 });

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

  // One-time "Feature Unlocked" modals (see features.ts). Features are armed as
  // they unlock (by a level completion, or an in-game event like the first
  // certificate hour) into a queue, then surfaced one at a time when leaving the
  // level-complete overlay (so they don't stack on top of it). unlockedFeature
  // is the one currently showing.
  const [unlockedFeature, setUnlockedFeature] = useState<GameFeature | null>(null);
  const pendingFeatureUnlocksRef = useRef<GameFeature[]>([]);
  // Event-unlocked features (e.g. certificates) are armed from callbacks defined
  // before unlockFeature is in scope; this ref bridges to the real arming fn.
  const armFeatureUnlockRef = useRef<(id: string) => void>(() => {});

  const handleCertificateHourEarned = useCallback(() => {
    // Visual flash handled by consumer; cert manager calls this on point award.
    // The first hour ever earned reveals the Certificates system (features.ts).
    armFeatureUnlockRef.current('certificates');
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
    restoreRunProgress,
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
    shouldShowDaily,
    shouldShowTimeLimit,
    markOnboardingSeen,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
    markAscensionSeen,
    markDailySeen,
    markTimeLimitSeen,
    resetAllTutorials,
  } = useTutorialManager();

  const {
    saveCheckpoint: saveRunCheckpoint,
    clearCheckpoints: clearRunCheckpoints,
  } = useCheckpointSnapshots();

  // Full-run persistence: written each time a map begins, cleared when the run
  // ends or a New Game starts. Powers the welcome-screen Continue button.
  const { hasSavedRun, savedRun, saveRun, clearRun, readRun } = useRunSave();

  // Hall of Fame (HIGHSCORES.md Phase A): the all-time Top 10 run ledger plus
  // the #1 run's per-map trajectory, which Record Pace races during the run.
  const { topRuns, bestRunTrajectory, monthlyBests, dailyBests, dailyStreak, bestScore, recordRun } = useHallOfFame();
  // Cumulative overtime after each completed map of the CURRENT run. A ref
  // because it's appended inside handleLevelComplete's synchronous flow and
  // persisted via the run-save snapshot (also refreshed per render).
  const runTrajectoryRef = useRef<number[]>([]);
  // Debug starts (?level= / forceLevel) never file on the ledger.
  const recordEligibleRef = useRef(true);
  // The mid-run "new personal best" banner fires once per run.
  const pbCelebratedRef = useRef(false);
  // Record Pace payload for the current level-complete overlay.
  const [levelPace, setLevelPace] = useState<{ delta: number | null; newPersonalBest: boolean } | null>(null);
  // Where the just-finished run landed on the ladder (for the result screen).
  const [lastRunRank, setLastRunRank] = useState<(RunRankInfo & { aheadThroughMaps: number | null; monthBest: boolean; dayBest?: boolean; dailyStreak?: number }) | null>(null);
  // Daily Stand-up (HIGHSCORES.md Phase D): non-null = this run is the seeded
  // daily for that "YYYY-MM-DD" key. Mirrored in a ref for the filing path.
  const [dailyKey, setDailyKey] = useState<string | null>(null);
  const dailyKeyRef = useRef<string | null>(null);

  const {
    stats: metaStats,
    isLoaded: metaLoaded,
    wonLoadoutIds,
    mapHighscores,
    encounteredBallTypeIds,
    archetypeBests,
    recordLevelReached,
    recordRunEnded,
    recordRunUpgrades,
    lastRunUpgradeIds,
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
    unlockFeature,
    isFeatureUnlocked,
    resetProgression,
  } = useMetaProgression();

  // Loadouts are gated behind the general feature-unlock system: earned by
  // beating the game for the first time (completing the final level; see the
  // isLastLevel win path below). Until then the Sprint Planning draft is skipped
  // and the menu Loadouts entry stays hidden.
  const loadoutsIntroduced = isFeatureUnlocked('loadouts');

  // Unlock a feature and, if it was newly unlocked, queue its "Feature Unlocked"
  // modal (surfaced when leaving the level-complete overlay). Idempotent.
  const armFeatureUnlock = useCallback((id: string) => {
    if (!unlockFeature(id)) return;
    const feature = getFeature(id);
    if (feature) pendingFeatureUnlocksRef.current.push(feature);
  }, [unlockFeature]);
  // Bridge for callbacks defined before armFeatureUnlock is in scope (e.g. the
  // certificate-hour handler).
  useEffect(() => { armFeatureUnlockRef.current = armFeatureUnlock; }, [armFeatureUnlock]);

  // Back-fill feature unlocks for existing saves so players who earned access
  // under the old ad-hoc gates keep it, WITHOUT a surprise modal (silent: no
  // queue push). Runs once, after meta progression has loaded. New players
  // unlock live via armFeatureUnlock (which does show the modal).
  const featureReconcileDoneRef = useRef(false);
  useEffect(() => {
    if (featureReconcileDoneRef.current || !metaLoaded) return;
    featureReconcileDoneRef.current = true;
    // Reached level 5+ => cleared level 5 => achievements were available.
    if (metaStats.highestLevelReached >= 5) unlockFeature('achievements');
    // Reached level 11+ => beat the level-10 boss => loadouts were available.
    // (Complements the loadoutsIntroduced first-win seed in useMetaProgression.)
    if (metaStats.highestLevelReached >= 11) unlockFeature('loadouts');
    const hadCertificates =
      totalCertificateHours > 0 ||
      unlockedCertIds.length > 0 ||
      Object.keys(certLevelsOwned).length > 0;
    if (hadCertificates) unlockFeature('certificates');
  }, [metaLoaded, metaStats.highestLevelReached, totalCertificateHours, unlockedCertIds, certLevelsOwned, unlockFeature]);

  const {
    achievements,
    completedIds: completedAchievementIds,
    activatedIds: activatedAchievementIds,
    bonusModifiers: achievementBonuses,
    checkAndComplete: checkAndCompleteAchievements,
    activateAchievement,
  } = useAchievementManager();

  /**
   * Every ladder rung in force at the current depth, folded into one rule set.
   * Read by the shop, the assignment draft, the Promotion, fence durability,
   * the mutator roll and the forced curse, so a rung is authored once in
   * loadouts.yml and applies everywhere without a second switch statement.
   */
  const ascRules = useMemo(
    () => (ascensionDepth > 0 ? ascensionRules(ascensionDepth, ascensionConfig.ladder) : NO_ASCENSION_RULES),
    [ascensionDepth, ascensionConfig.ladder],
  );

  /**
   * Drafted loadouts, the ladder's own modifier rungs, and the forced curse,
   * folded into the same bonus map the achievements/certificates use.
   *
   * Ball speed used to be speedRampPerDepth ^ depth at EVERY depth, which was
   * the whole of what an ascension meant. It is now one rung among ten, and the
   * ramp only takes over past the ladder's end so deep ascensions still
   * escalate once the named rungs run out.
   */
  const loadoutBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const id of draftedLoadoutIds) {
      const loadout = loadoutLookup.get(id);
      if (loadout) bonuses = mergeBonuses(bonuses, loadout.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    if (ascensionDepth > 0) {
      bonuses = mergeBonuses(bonuses, ascRules.modifiers as Partial<Record<keyof GameModifiers, number>>);
      // The imposed curse is a normal loadout the player never drafted.
      const forced = ascRules.forcedCurseLoadoutId
        ? loadoutLookup.get(ascRules.forcedCurseLoadoutId)
        : undefined;
      if (forced && !draftedLoadoutIds.includes(forced.id)) {
        bonuses = mergeBonuses(bonuses, forced.modifiers as Partial<Record<keyof GameModifiers, number>>);
      }
      const past = ascensionDepth - LADDER_LENGTH;
      if (past > 0) {
        bonuses = mergeBonuses(bonuses, {
          ballSpeedMultiplier: Math.pow(ascensionConfig.speedRampPerDepth, past),
        });
      }
    }
    return bonuses;
  }, [draftedLoadoutIds, loadoutLookup, ascensionDepth, ascRules, ascensionConfig.speedRampPerDepth]);

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

  /**
   * Build scaling: upgrades whose effect grows with how committed the run is to
   * their archetype (src/lib/upgradeScaling.ts). Folded in with the other
   * static sources, since it depends only on what is OWNED, not on run state.
   */
  const scalingBonuses = useMemo(
    () => computeScalingBonuses(ownedUpgradeIds, upgrades),
    [ownedUpgradeIds, upgrades]
  );
  /** The per-upgrade breakdown, for the Specs panel. Memoised on the same deps
   *  as the bonuses: it walks the whole catalogue, and useGameSession re-renders
   *  on every score and life change, so calling it inline rebuilt a 110-entry
   *  lookup several times a second AND handed the panel a new array each time. */
  const scalingDetail = useMemo(
    () => scalingReadouts(ownedUpgradeIds, upgrades),
    [ownedUpgradeIds, upgrades]
  );

  const mergedBonuses = useMemo(
    () => mergeBonuses(
      mergeBonuses(mergeBonuses(achievementBonuses, certBonuses), loadoutBonuses),
      mergeBonuses(
        mergeBonuses(tagSetBonuses, scalingBonuses),
        capstone?.modifiers as Partial<Record<keyof GameModifiers, number>> | undefined,
      ),
    ),
    [achievementBonuses, certBonuses, loadoutBonuses, tagSetBonuses, scalingBonuses, capstone]
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
    if (carrySpendCapture > 0) {
      bonuses = mergeBonuses(bonuses, { startingCapturePercent: carrySpendCapture });
    }
    // Accepted assignment: its constraint (curse modifiers + the no-Push flag)
    // rides along for the whole block (#60). Skipped assignments (activeDoor
    // null) add nothing.
    if (activeDoor?.constraint) {
      if (activeDoor.constraint.modifiers) {
        bonuses = mergeBonuses(bonuses, activeDoor.constraint.modifiers as Partial<Record<keyof GameModifiers, number>>);
      }
      if (activeDoor.constraint.disablePushYourLuck) {
        bonuses = mergeBonuses(bonuses, { disablePushYourLuck: 1 });
      }
    }
    // Assignment rewards granted for the rest of the run (#60), folded like a
    // capstone bundle.
    if (Object.keys(assignmentRewardMods).length > 0) {
      bonuses = mergeBonuses(bonuses, assignmentRewardMods as Partial<Record<keyof GameModifiers, number>>);
    }
    // Warm Cache loadout: fence growth snowballs with each map cleared this run.
    // Translate the per-cleared-map coefficient into a fenceGenerationSpeedMultiplier
    // boost, capped so a deep run can't run away with it.
    if (baseModifiers.fenceSpeedPerMapCleared > 0 && runLevelsCompleted > 0) {
      const rampMaps = Math.min(runLevelsCompleted, WARM_CACHE_RAMP_CAP);
      bonuses = mergeBonuses(bonuses, {
        fenceGenerationSpeedMultiplier: 1 + baseModifiers.fenceSpeedPerMapCleared * rampMaps,
      });
    }
    return bonuses;
  }, [baseModifiers, totalScore, carryInstantFences, carrySpendFences, carrySpendFenceSpeed, carrySpendCapture, activeDoor, assignmentRewardMods, runLevelsCompleted]);
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

    if (activeDoor?.constraint?.modifiers) {
      sources.push({ kind: 'door', id: activeDoor.id, name: activeDoor.name, modifiers: activeDoor.constraint.modifiers });
    }

    if (Object.keys(assignmentRewardMods).length > 0) {
      sources.push({ kind: 'door', id: 'assignment-reward', name: 'Assignment reward', modifiers: assignmentRewardMods });
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
  }, [ownedUpgradeIds, upgrades, certificates, certLevelsOwned, achievements, activatedAchievementIds, activeLoadouts, activeTagSets, activeDoor, assignmentRewardMods, capstone, ascensionDepth, ascensionConfig.speedRampPerDepth]);

  // Loadouts offered in the run-start draft: unlocked once the player has
  // enough unique wins (see loadoutUnlock). Ascension uses the full catalogue.
  const availableLoadouts = useMemo(
    () => unlockedForStart(loadouts, wonLoadoutIds.length),
    [loadouts, wonLoadoutIds]
  );

  // Ascension rule: fences wear out after a number of ball hits — generous on
  // early levels, brutal late, plus the Defensive Programming upgrade bonus.
  // null = indestructible fences (the normal game). Gated on the "Technical
  // Debt" rung rather than on depth > 0, so the first three ascensions have a
  // character of their own and Defensive Programming is a considered buy at
  // depth 4 instead of mandatory from the very first ascension.
  const fenceDurability = useMemo(() => {
    if (!ascRules.fencesWearOut) return null;
    const levelNumber = currentLevelIndex + 1;
    const t = totalLevels > 1 ? Math.min(1, (levelNumber - 1) / (totalLevels - 1)) : 0;
    const base = Math.round(
      ascensionConfig.fenceDurabilityBase +
      (ascensionConfig.fenceDurabilityAtFinal - ascensionConfig.fenceDurabilityBase) * t
    );
    return Math.max(1, base + activeModifiers.fenceDurabilityBonus);
  }, [ascRules.fencesWearOut, currentLevelIndex, totalLevels, ascensionConfig, activeModifiers.fenceDurabilityBonus]);

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
    // Signing Bonus: the run opens with hours already banked. Set here rather
    // than at one of the run-start handlers so every path gets it, the Daily
    // included: certs already apply to a seeded run (Equity Grant, Head Start
    // and the rest), and singling this one out would be the inconsistency.
    // getLoadedCertBonuses(), not the `certBonuses` memo: certificates are
    // fetched INSIDE the run-start handlers, so this closure predates the load
    // on the first run of a session and the memo still reads empty. That would
    // make the bonus appear from the second run onwards and never the first.
    setTotalScore((getLoadedCertBonuses().startingOvertime as number | undefined) ?? 0);
    setOwnedUpgradeIds([]);
    setCarryInstantFences(0);
    setAbilityCharges({});
    setCarrySpendFences(0);
    setCarrySpendFenceSpeed(0);
    setCarrySpendCapture(0);
    setCarryFreeShopItems(0);
    spentThisShopVisitRef.current = 0;
    blockStatsRef.current = { overtime: 0, maps: 0, locks: 0, livesLost: 0 };
    setLastContractSummary(null);
    setBlockResults([]);
    setAssignmentRewardMods({});
    setPendingTierDraft(null);
    setPendingTenure(null);
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
    runTrajectoryRef.current = [];
    recordEligibleRef.current = true;
    pbCelebratedRef.current = false;
    setLevelPace(null);
    setLastRunRank(null);
    resetRunProgress();
  }, [resetRunProgress]);

  // Latest run snapshot, refreshed every render, so the save effect can fire
  // exactly once per map entry (keyed on the map-entry signals below) while the
  // payload always reflects the settled post-advance state. Reading from a ref
  // avoids re-saving on every mid-map life/score change.
  const runSnapshotRef = useRef<Omit<RunSave, 'version' | 'savedAt'> | null>(null);
  runSnapshotRef.current = {
    levelSequenceIds: levels.map(l => l.id),
    currentLevelIndex,
    totalScore,
    ownedUpgradeIds,
    currentLives,
    livesAtLevelStart,
    continuesRemaining,
    cumulativeLockedBalls,
    runLevelsCompleted,
    carryInstantFences,
    carrySpendFences,
    carrySpendFenceSpeed,
    carrySpendCapture,
    carryFreeShopItems,
    blockStats: blockStatsRef.current,
    blockResults,
    assignmentRewardModifiers: assignmentRewardMods,
    activeDoorId: activeDoor?.id ?? null,
    capstoneId: capstone?.id ?? null,
    ascensionDepth,
    draftedLoadoutIds,
    runTrajectory: runTrajectoryRef.current,
    recordEligible: recordEligibleRef.current,
    dailyKey,
    abilityCharges,
  };

  // Persist the run whenever a new map begins (map advance or a Continue-revive
  // remount). Keyed only on the map-entry signals; the payload is read from the
  // ref so this writes once per map, not on every in-map state change.
  useEffect(() => {
    if (nav.currentScreen !== 'game') return;
    const snap = runSnapshotRef.current;
    if (!snap || snap.levelSequenceIds.length === 0) return;
    saveRun(snap);
  }, [nav.currentScreen, currentLevelIndex, gameInstanceKey, saveRun]);

  /**
   * Also persist when the page is hidden or torn down, and when the error
   * boundary catches a crash.
   *
   * Per-map writes are the right granularity for the map, but they leave
   * everything BETWEEN maps unsaved: upgrades bought, a draft taken, an
   * assignment accepted. On a phone that window is very reachable - clear a
   * map, open the shop, get distracted, the OS reclaims the tab - and you come
   * back to the map's start with the purchases gone, having paid for them.
   */
  useEffect(() => {
    registerRunFlush(() => {
      const snap = runSnapshotRef.current;
      if (!snap || snap.levelSequenceIds.length === 0) return;
      saveRun(snap);
    });
    const uninstall = installRunFlushListeners();
    return () => { uninstall(); registerRunFlush(null); };
  }, [saveRun]);

  /** Leave any seeded-run context: normal runs roll Math.random again. */
  const clearDailyMode = useCallback(() => {
    setRunSeedText(null);
    dailyKeyRef.current = null;
    setDailyKey(null);
  }, []);

  /**
   * The last step of starting a fresh, unseeded run: hand over the Tenure draft
   * if the previous run earned one, then continue into the loadout draft or
   * straight into the map.
   *
   * Shared because there are three ways to start a run and Tenure originally
   * fired from only one of them. New Game rolled it; Play Again and Restart went
   * straight to the loadout draft, so losing past map 10 and pressing Play Again
   * (the most natural way there is to start the next run) silently skipped the
   * head start that run had just earned. The tell was that both other paths
   * already ran the loadout draft, and Tenure is specified to come BEFORE it.
   *
   * Seeded Daily runs deliberately do not come through here: a per-player head
   * start would make one shared seed incomparable.
   */
  const enterRun = useCallback((thenDraftLoadout: boolean) => {
    const tenureDepth = metaStats.lastRunDepth;
    const offers = tenureSteps(tenureDepth) > 0
      // getLoadedUpgrades(), not the `upgrades` state: on the New Game path this
      // closure was created before loadUpgrades() ran, so the state read here
      // would be stale. On the other two the catalogue is already loaded from
      // the run just played, and an empty one simply yields no offers.
      //
      // The depth sets how much is granted; lastRunShopLevel limits what may be
      // granted to what the run could actually have bought.
      ? rollTenureOffers(getLoadedUpgrades(), tenureDepth, Math.random,
                         TENURE_OFFER_COUNT, lastRunUpgradeIds, metaStats.lastRunShopLevel)
      : [];
    if (offers.length > 0) {
      setPendingTenure({
        offers, earnedAtLevel: tenureDepth, thenDraftLoadout,
        lastRunUpgradeIds: [...lastRunUpgradeIds],
      });
      nav.goToTenureDraft();
    } else if (thenDraftLoadout) nav.goToRunDraft();
    else nav.startGame();
  }, [metaStats.lastRunDepth, metaStats.lastRunShopLevel, lastRunUpgradeIds, nav.goToTenureDraft, nav.goToRunDraft, nav.startGame]);

  const handleStartGame = useCallback(async (forceLevel?: number, skipDraft?: boolean) => {
    // A normal run must never inherit a previous daily's seed: disarm BEFORE
    // loading, because loadLevels() already rolls the level lineup.
    clearDailyMode();
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
      loadAbilities(),
      loadFeatures(),
      // Door pool (doors.yml). On failure assignment levels fall back to the shop.
      loadDoors(),
      // Capstone pool (capstones.yml). Failure just skips the Promotion draft.
      loadCapstones(),
      // Map mutator pool (mapMutators.yml). Failure just plays maps unmutated.
      loadMapMutators(),
      // Map objective pool (objectives.yml). Failure just plays maps without a goal.
      loadMapObjectives(),
    ]);

    if (levelsSuccess && upgradesSuccess) {
      resetRunScopedState();
      // New Game discards any prior save; the fresh run re-saves on its first map.
      clearRun();

      // getLoadedCertBonuses(), not the `certBonuses` memo: the load two dozen
      // lines up happened INSIDE this handler, so the memo in this closure is
      // still the pre-load one on the first run of a session. Same for the
      // starting level below.
      const certs = getLoadedCertBonuses();
      const certBonusLives = (certs.extraLives as number | undefined) ?? 0;
      const startingLives = baseLives() + certBonusLives;
      setCurrentLives(startingLives);
      setLivesAtLevelStart(startingLives);
      setContinuesRemaining(BASE_CONTINUES + ((certs.extraContinues as number | undefined) ?? 0));
      setPendingDeathResult(null);

      // Admin "Infinite lives" and live map tuning both make a run
      // unrepresentative in exactly the way the ?level= jump does, so they get
      // the same treatment: play it, but never let highscores / Employee of the
      // Month / Records learn from it.
      if (isInfiniteLivesEnabled() || hasAnyMapTuning() || debugMutatorId() || forcedTilts()) {
        recordEligibleRef.current = false;
      }

      // ?ascension=N: start this run already at that depth, so the ladder's
      // later rungs can be looked at without clearing the map list N times.
      // Applied after resetRunScopedState (which zeroes the depth) and before
      // the level jump, so ?ascension=3&level=12 works as one instruction.
      // The param is consumed here, matching ?level=, so a later Play Again is
      // an ordinary depth-0 run rather than silently staying ascended.
      const debugAscension = debugAscensionDepth();
      if (debugAscension > 0) {
        setAscensionDepth(debugAscension);
        recordEligibleRef.current = false; // debug jump: never files on the ledger
        stripQueryParam('ascension');
      }

      if (forceLevel !== undefined) {
        setLevelIndex(forceLevel - 1);
        recordEligibleRef.current = false; // debug jump: never files on the ledger
      } else {
        const certStartLevel = getLoadedCertStartingLevel();
        const queryLevel = parseInt(new URLSearchParams(window.location.search).get('level') || '0', 10);
        if (queryLevel > 0) {
          stripQueryParam('level');
          recordEligibleRef.current = false; // debug jump: never files on the ledger
        }
        const startingLevel = Math.max(certStartLevel, queryLevel || 0);
        if (startingLevel > 1) {
          setLevelIndex(startingLevel - 1);
        } else {
          resetToFirstLevel();
        }
      }

      analytics.runStarted({ mode: 'new', daily: false });

      // A fresh run drafts a loadout first, but the loadout system only appears
      // once it's been introduced (after the first win). The first run and the
      // ?level= debug path go straight into the game.
      const thenDraftLoadout = !(skipDraft || !loadoutsIntroduced);

      enterRun(thenDraftLoadout);
    }
  }, [loadLevels, loadUpgrades, loadCertificates, loadLoadouts, setLevelIndex, resetToFirstLevel, resetRunScopedState, clearRun, loadoutsIntroduced, clearDailyMode, enterRun]);

  /**
   * Daily Stand-up (HIGHSCORES.md Phase D): start today's seeded run. The seed
   * is armed BEFORE the catalogues load (loadLevels rolls the level lineup),
   * so every player on today's key is served the same variants, drafts, shops,
   * obstacles and pickups. Always starts at level 1 (no cert Head Start): it
   * is a shared run, and scores go on the daily ledger as well as the
   * all-time one.
   */
  const handleStartDaily = useCallback(async () => {
    const key = todayKey();
    setRunSeedText(dailySeedText(key));
    dailyKeyRef.current = key;
    setDailyKey(key);

    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadCertificates(),
      loadLoadouts(),
      loadBallTypes(),
      loadAbilities(),
      loadFeatures(),
      loadDoors(),
      loadCapstones(),
      loadMapMutators(),
      loadMapObjectives(),
    ]);
    if (!levelsSuccess || !upgradesSuccess) {
      clearDailyMode();
      return;
    }

    resetRunScopedState();
    clearRun();

    // Loaded, not memoised: the Daily fetches its catalogues here too.
    const certs = getLoadedCertBonuses();
    const certBonusLives = (certs.extraLives as number | undefined) ?? 0;
    const startingLives = baseLives() + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    setContinuesRemaining(BASE_CONTINUES + ((certs.extraContinues as number | undefined) ?? 0));
    setPendingDeathResult(null);

    resetToFirstLevel(); // same seeded lineup for everyone, from level 1

    analytics.runStarted({ mode: 'daily', daily: true });

    // Daily Stand-up is a seeded, identical-for-everyone challenge: it skips the
    // loadout draft (which normal runs always show now, #38) to stay clean.
    nav.startGame();
  }, [loadLevels, loadUpgrades, loadCertificates, loadLoadouts, resetRunScopedState, clearRun, resetToFirstLevel, nav.startGame, clearDailyMode]);

  /**
   * Resume a saved run from the welcome screen. Loads the catalogues (same as a
   * fresh start), then restores every run-scoped field from the save and drops
   * the player at the start of the map they were on. Doors/capstones are
   * re-hydrated from the loaded pools by id; the exact level variants are
   * restored via restoreSequence so the resumed maps match what was saved.
   */
  const handleContinueRun = useCallback(async () => {
    const save = readRun();
    if (!save) return;

    // Restore the run's seeded context (or lack of it) BEFORE loading: the
    // shops/drafts/pickups ahead must keep rolling from the daily seed.
    const savedDaily = save.dailyKey ?? null;
    setRunSeedText(savedDaily ? dailySeedText(savedDaily) : null);
    dailyKeyRef.current = savedDaily;
    setDailyKey(savedDaily);

    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadCertificates(),
      loadLoadouts(),
      loadBallTypes(),
      loadAbilities(),
      loadFeatures(),
      loadDoors(),
      loadCapstones(),
      loadMapMutators(),
      loadMapObjectives(),
    ]);
    if (!levelsSuccess || !upgradesSuccess) return;

    setTotalScore(save.totalScore);
    setOwnedUpgradeIds(save.ownedUpgradeIds);
    setCurrentLives(save.currentLives);
    setLivesAtLevelStart(save.livesAtLevelStart);
    setContinuesRemaining(save.continuesRemaining);
    setCumulativeLockedBalls(save.cumulativeLockedBalls);
    setCarryInstantFences(save.carryInstantFences);
    setAbilityCharges(save.abilityCharges ?? {});
    setCarrySpendFences(save.carrySpendFences);
    setCarrySpendFenceSpeed(save.carrySpendFenceSpeed);
    setCarrySpendCapture(save.carrySpendCapture ?? 0);
    setCarryFreeShopItems(save.carryFreeShopItems ?? 0);
    blockStatsRef.current = save.blockStats ?? { overtime: 0, maps: 0, locks: 0, livesLost: 0 };
    setBlockResults(save.blockResults ?? []);
    setAssignmentRewardMods(save.assignmentRewardModifiers ?? {});
    setPendingTierDraft(null);
    setLastContractSummary(null);
    spentThisShopVisitRef.current = 0;
    setAscensionDepth(save.ascensionDepth);
    setDraftedLoadoutIds(save.draftedLoadoutIds);
    setActiveDoor(save.activeDoorId ? getDoors().find(d => d.id === save.activeDoorId) ?? null : null);
    setCapstone(save.capstoneId ? getCapstones().find(c => c.id === save.capstoneId) ?? null : null);

    // Resuming mid-run: no intro assemble, no leftover overlays/offers.
    setIntroAssemblePending(false);
    setStoreClosed(false);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setPendingDeathResult(null);
    lastDeliveredCompletionRef.current = null;

    // Records: the resumed run keeps its trajectory and eligibility (saves
    // written before Phase A default to eligible with an empty trajectory).
    runTrajectoryRef.current = save.runTrajectory ?? [];
    recordEligibleRef.current = save.recordEligible ?? true;
    // Don't re-flash the PB banner if the saved run had already passed it.
    pbCelebratedRef.current = bestScore !== null && save.totalScore > bestScore;
    setLevelPace(null);
    setLastRunRank(null);

    restoreRunProgress(save.runLevelsCompleted);
    restoreSequence(save.levelSequenceIds, save.currentLevelIndex);

    analytics.runStarted({ mode: 'resume', daily: savedDaily !== null });

    nav.goToGame();
  }, [readRun, loadLevels, loadUpgrades, loadCertificates, loadLoadouts, restoreRunProgress, restoreSequence, nav.goToGame, bestScore]);

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

  /**
   * File the finished run on the Hall of Fame ledger (HIGHSCORES.md Phase A)
   * and stash its rank / near-miss gaps / pace epitaph for the result screen.
   * Ineligible (debug-start) and empty runs file nothing.
   */
  const fileRunOnLedger = useCallback((finalScore: number) => {
    const trajectory = runTrajectoryRef.current;
    if (!recordEligibleRef.current || finalScore <= 0 || trajectory.length === 0) {
      setLastRunRank(null);
      return;
    }
    // Epitaph + rank must read the ladder BEFORE this run is filed on it.
    const epitaph = aheadThroughMaps(trajectory, bestRunTrajectory, finalScore, bestScore);
    const identity = computeBuildIdentity(tagCounts);
    const info = recordRun({
      score: finalScore,
      levelsCompleted: trajectory.length,
      ascensionDepth,
      primaryTag: identity.primary,
      secondaryTag: identity.secondary,
      capstoneId: capstone?.id ?? null,
      capstoneName: capstone?.name ?? null,
      loadoutIds: draftedLoadoutIds,
      savedAt: Date.now(),
    }, trajectory, dailyKeyRef.current);
    setLastRunRank({ ...info, aheadThroughMaps: epitaph });
  }, [bestRunTrajectory, bestScore, tagCounts, ascensionDepth, capstone, draftedLoadoutIds, recordRun]);

  const finalizeAndShowResult = useCallback((result: GameResult) => {
    const levelsCompleted = runLevelsCompleted;
    analytics.runEnded({
      isWin: result.isWin,
      levelsCompleted,
      totalScore,
      ascensionDepth,
      daily: dailyKeyRef.current !== null,
    });
    // Tenure (issue #75): the depth this run ENDED at decides the next
    // run's free upgrade. Recorded here and nowhere else, so quitting to the
    // menu leaves the last real result standing.
    //
    // The second number is the deepest shop this run reached, which caps what
    // Tenure may offer. A win means this level was cleared and its shop seen;
    // a death means the last shop was the previous level's.
    recordRunEnded(currentLevelIndex + 1, result.isWin ? currentLevelIndex + 1 : currentLevelIndex);
    // Tenure's guaranteed offer continues the build this run was made of.
    recordRunUpgrades(ownedUpgradeIds);
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
    captureRunRecap(totalScore);
    fileRunOnLedger(totalScore);
    clearRun(); // the run is over: no Continue on the welcome screen
    nav.endGame({
      ...result,
      totalScore,
      ascensionDepth: ascensionDepth > 0 ? ascensionDepth : undefined,
      loadoutNames: ascensionDepth > 0 ? activeLoadouts.map(l => l.name) : undefined,
    });
  }, [nav.endGame, totalScore, finalizeRun, ascensionDepth, runLevelsCompleted, activeModifiers.extraCertificateHours, activeLoadouts, captureRunRecap, fileRunOnLedger, clearRun, recordRunEnded, recordRunUpgrades, ownedUpgradeIds, currentLevelIndex]);

  /**
   * Tenure pick confirmed (issue #75): grant every upgrade in the chosen
   * chain, then continue into the loadout draft (or straight into the game when
   * loadouts are not in play yet).
   *
   * The WHOLE chain is granted, not just its top tier, because upgrade
   * modifiers compound: handing over only the Principal would make the
   * 30-level reward weaker than the 20-level one.
   */
  const handleTenurePicked = useCallback((headId: string) => {
    const pending = pendingTenure;
    const offer = pending?.offers.find(o => o.headId === headId) ?? null;
    if (offer) {
      const granted = offer.upgrades.map(u => u.id);
      setOwnedUpgradeIds(prev => [...prev, ...granted.filter(id => !prev.includes(id))]);
    }
    setPendingTenure(null);
    if (pending?.thenDraftLoadout) nav.goToRunDraft();
    else nav.startGame();
  }, [pendingTenure, nav.goToRunDraft, nav.startGame]);

  const handleGameEnd = useCallback((result: GameResult) => {
    if (!result.isWin) {
      analytics.levelFailed({
        level: currentLevelIndex + 1,
        continuesLeft: continuesRemaining,
        daily: dailyKeyRef.current !== null,
      });
    }
    // On death with a Continue banked, defer finalizing and offer a revive.
    if (!result.isWin && continuesRemaining > 0) {
      setPendingDeathResult(result);
      return;
    }
    finalizeAndShowResult(result);
  }, [continuesRemaining, finalizeAndShowResult, currentLevelIndex]);

  /** Spend a Continue: refill lives and retry the current level (score + upgrades kept). */
  const handleSpendContinue = useCallback(() => {
    analytics.continueSpent({ level: currentLevelIndex + 1 });
    setContinuesRemaining(n => Math.max(0, n - 1));
    const startingLives = baseLives() + ((certBonuses.extraLives as number | undefined) ?? 0);
    const refilled = Math.max(1, Math.max(currentLives, startingLives));
    setCurrentLives(refilled);
    setLivesAtLevelStart(refilled);
    setPendingDeathResult(null);
    setGameInstanceKey(k => k + 1); // remount the game view -> current level re-inits
  }, [certBonuses, currentLives, currentLevelIndex]);

  /** Decline the revive: finalize the deferred death and show the result screen. */
  const handleDeclineContinue = useCallback(() => {
    const result = pendingDeathResult;
    setPendingDeathResult(null);
    if (result) finalizeAndShowResult(result);
  }, [pendingDeathResult, finalizeAndShowResult]);

  /**
   * Ran out of time with lives to spare: the timeout already docked one life
   * (via onLivesChange), so just restart the current map fresh by remounting
   * the game view. The run only ends when the last life is spent (handled by
   * the physics game-over path at zero lives).
   */
  const handleMapTimedOut = useCallback(() => {
    setLivesAtLevelStart(currentLives);
    setGameInstanceKey(k => k + 1);
  }, [currentLives]);

  const handleLivesChange = useCallback((newLives: number) => {
    const livesLost = currentLives - newLives;
    if (livesLost > 0) {
      recordLivesLost(livesLost);
      // Contract bookkeeping (#49): lives lost while a contract runs.
      if (activeDoor) blockStatsRef.current.livesLost += livesLost;
    }
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost, activeDoor]);

  // A smashed chest granted one charge of an ability (issue #38): bank it
  // run-wide so it persists into every later map this run.
  const handleGrantAbility = useCallback((abilityId: string) => {
    setAbilityCharges(prev => ({ ...prev, [abilityId]: (prev[abilityId] ?? 0) + 1 }));
  }, []);

  // The player pressed an ability button: spend one charge (floored at 0).
  const handleSpendAbility = useCallback((abilityId: string) => {
    setAbilityCharges(prev => {
      const have = prev[abilityId] ?? 0;
      if (have <= 0) return prev;
      return { ...prev, [abilityId]: have - 1 };
    });
  }, []);

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
    // The onboarding map (first run only) has served its purpose the moment it
    // is cleared: every later run opens on the real level-1 map instead.
    if (isOnboardingMap(currentLevel)) markOnboardingSeen();
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    // Levels completed while ascended count more toward Certificate Hours
    incrementRunLevel(1 + ascensionDepth);

    // Loyalty bonus: completing level FREE_CONTINUE_LEVEL awards a free
    // Continue (runs start with none; the dedupe ref above keeps this to one
    // grant per pass, and an ascension loop can earn it again).
    if (currentLevelNum === FREE_CONTINUE_LEVEL) setContinuesRemaining(c => c + 1);

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
    setCarrySpendCapture(0);
    // Free-store-item pickups (issue #48): bank the map's claims; they persist
    // until an OPEN store consumes one (unlike the one-map carries above).
    if ((scoreData.freeShopItemsEarned ?? 0) > 0) {
      setCarryFreeShopItems(n => n + scoreData.freeShopItemsEarned!);
    }

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
      // Only written when a run ENDS, so these are carried through unchanged.
      lastRunDepth: metaStats.lastRunDepth,
      lastRunShopLevel: metaStats.lastRunShopLevel,
    };
    checkAndCompleteAchievements(projectedStats);

    // Feature unlocks (features.ts): completing certain levels, on the real
    // first run (depth 0), reveals a new system. Level 5 unlocks achievements.
    // armFeatureUnlock queues the "Feature Unlocked" modal (surfaced when
    // leaving the level-complete overlay). (Certificates and loadouts unlock on
    // an event, not a level - see below and handleCertificateHourEarned.)
    if (ascensionDepth === 0) {
      for (const feature of featuresUnlockedAtLevel(currentLevelNum)) {
        armFeatureUnlock(feature.id);
      }
    }

    // Beating the final level = a win. Credit the run-start loadout (index 0)
    // toward unique wins, and remember any loadouts that just unlocked so the
    // result screen can celebrate them. Skipped runs (no drafted loadout) and
    // repeat wins with the same loadout do not advance the count.
    if (isLastLevel) {
      // First full completion unlocks the Loadouts feature: the "Feature
      // Unlocked" modal surfaces over the ascension draft that follows, right as
      // the player first meets loadouts (the ascension pick). Idempotent, so
      // later wins are no-ops.
      armFeatureUnlock('loadouts');
      // Legacy bookkeeping flag (loadouts now unlock via the feature system).
      introduceLoadouts();
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
    // The onboarding map is played once, ever, so it gets no map record: a row
    // in the Records screen that can never be beaten is just noise.
    if (scoreData.levelId && scoreData.levelId !== ONBOARDING_MAP_ID) {
      const { previous, isRecord } = recordMapHighscore(scoreData.levelId, baseLevelScore);
      if (isRecord) {
        beatHighscore = true;
        previousHighscore = previous ?? undefined;
        highscoreBonusEarned = highscoreBonus(previous, baseLevelScore, getHighscoreBonusMultiplier());
      }
    }

    const levelOvertime = baseLevelScore + highscoreBonusEarned;

    analytics.levelCompleted({
      level: currentLevelNum,
      overtime: levelOvertime,
      perfect: currentLives >= livesAtLevelStart,
      ascensionDepth,
      daily: dailyKeyRef.current !== null,
    });

    // Contract bookkeeping (#49): what this contract's maps have produced.
    if (activeDoor) {
      blockStatsRef.current.overtime += levelOvertime;
      blockStatsRef.current.maps += 1;
      blockStatsRef.current.locks += scoreData.lockedBallsCount ?? 0;
      // Mission bookkeeping (#60): capture this map's metrics for the multi-map
      // condition. `wonByAllLocked` is the auto-win from trapping every ball.
      const mapResult: AssignmentMapResult = {
        locks: scoreData.lockedBallsCount ?? 0,
        superiorLocks: scoreData.superiorLockCount ?? 0,
        cutsDelta: scoreData.cutCount - scoreData.expectedCuts,
        clearSeconds: scoreData.clearTimeSeconds ?? 9999,
        ballCount: scoreData.wonByAllLocked ? (scoreData.lockedBallsCount ?? 0) : 0,
        allBallsLocked: scoreData.wonByAllLocked ?? false,
      };
      setBlockResults(prev => [...prev, mapResult]);
    }

    // Record Pace (HIGHSCORES.md): extend this run's trajectory and race the
    // best run at the same maps-completed point. The PB banner fires once, the
    // moment the cumulative total passes the all-time best mid-run.
    const cumulative = totalScore + levelOvertime;
    const mapsCompleted = runTrajectoryRef.current.length + 1;
    runTrajectoryRef.current = [...runTrajectoryRef.current, cumulative];
    let pace: { delta: number | null; newPersonalBest: boolean } | null = null;
    if (recordEligibleRef.current) {
      const delta = paceDelta(cumulative, mapsCompleted, bestRunTrajectory, bestScore);
      const newPersonalBest = bestScore !== null && cumulative > bestScore && !pbCelebratedRef.current;
      if (newPersonalBest) pbCelebratedRef.current = true;
      if (delta !== null || newPersonalBest) pace = { delta, newPersonalBest };
    }
    setLevelPace(pace);

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
  }, [totalScore, currentLevelIndex, currentLevel, markOnboardingSeen, recordLevelReached, recordFencesDrawn, recordPerfectLevel, recordPushBonusBanked, currentLives, livesAtLevelStart, incrementRunLevel, ascensionDepth, activeModifiers.underParInstantFence, checkAndCompleteAchievements, metaStats, isLastLevel, draftedLoadoutIds, recordLoadoutWin, recordMapHighscore, introduceLoadouts, armFeatureUnlock, loadouts, bestRunTrajectory, bestScore, activeDoor]);

  /**
   * Enter the assignment draft (1-of-3, or skip). If the pool failed to load,
   * fall back to the regular shop so the level exit never dead-ends.
   */
  const proceedToAssignment = useCallback(() => {
    const doorPool = getDoors();
    if (doorPool.length > 0) {
      // Seeded runs key the roll by the level it lands on, so every player on
      // the daily seed is offered the same assignments.
      // Reduced Headcount (ascension rung 2) narrows the contract draft. No
      // upgrade sells a third door, so this rung cannot be bought back.
      const offerCount = Math.max(1, Math.min(ASSIGNMENT_OFFER_COUNT, ascRules.doorOffers ?? ASSIGNMENT_OFFER_COUNT));
      const drawn = drawDoorOffers(doorPool, offerCount, getRunRng(`doors:${currentLevelIndex + 1}`));
      // Size the lock targets to the block they are actually set over. Authored
      // as absolute numbers they were mostly impossible: lock_quota wanted 20
      // locks from blocks that put 8 to 15 balls on the board, and taking the
      // constraint for five maps to chase a reward that could never be reached
      // is worse than a hard mission, it is a dead one.
      setDoorOffers(scaleOffersForBlock(drawn, levels, currentLevelIndex + 1));
      nav.goToDoorDraft();
      return;
    }
    nav.goToUpgradeShop();
  }, [nav.goToDoorDraft, nav.goToUpgradeShop, currentLevelIndex, ascRules.doorOffers, levels]);

  /**
   * After the finished assignment's reward is granted, route into the capstone
   * draft when the Promotion is due, otherwise into the assignment draft.
   */
  const routeAfterAssignmentReward = useCallback(() => {
    const capstonePool = getCapstones();
    // Promotion Freeze (ascension rung 3): no capstone is awarded at all.
    if (!ascRules.noCapstone && !capstone && capstonePool.length > 0 && currentLevelIndex + 1 >= getCapstoneTriggerLevel()) {
      setCapstoneOffers(drawCapstoneOffers(capstonePool, CAPSTONE_OFFER_COUNT, getRunRng(`capstones:${currentLevelIndex + 1}`)));
      nav.goToCapstoneDraft();
      return;
    }
    proceedToAssignment();
  }, [capstone, currentLevelIndex, ascRules.noCapstone, nav.goToCapstoneDraft, proceedToAssignment]);

  /**
   * Grant the just-finished assignment's reward (issue #60): the reward of the
   * highest mission tier reached over the block (completed maps only). Lives and
   * overtime are banked immediately; run-scoped modifier bundles fold in like a
   * capstone; a tier-draft reward is queued (returns true) so the caller shows
   * the 1-of-3 upgrade pick before the next draft. Also writes the report card.
   */
  const grantAssignmentReward = useCallback((): { tierDraftOwed: boolean } => {
    if (!activeDoor) {
      setLastContractSummary(null);
      return { tierDraftOwed: false };
    }
    const outcome = assignmentRewardForBlock(activeDoor, blockResults);
    let rewardLabel: string | null = null;
    let tierDraftOwed = false;
    if (outcome) {
      const r = outcome.reward;
      rewardLabel = activeDoor.mission.tiers[outcome.tierIndex]?.label ?? null;
      switch (r.type) {
        case 'lives':
          setCurrentLives(prev => prev + r.count);
          break;
        case 'overtime':
          setTotalScore(prev => prev + r.hours);
          break;
        case 'modifiers':
          // "Enhance an owned upgrade" rewards only pay when that upgrade is owned.
          if (!r.requiresUpgradeId || ownedUpgradeIds.includes(r.requiresUpgradeId)) {
            setAssignmentRewardMods(prev => ({
              ...mergeBonuses(prev, r.modifiers as Partial<Record<keyof GameModifiers, number>>),
            }) as Record<string, number>);
          } else {
            rewardLabel = null; // gate not met: nothing granted
          }
          break;
        case 'tierDraft': {
          const pool = eligibleTierUpgrades(upgrades, r.tier, ownedUpgradeIds);
          const offers = drawRandom(pool, 3, getRunRng(`tierDraft:${currentLevelIndex + 1}`));
          if (offers.length > 0) {
            setPendingTierDraft({ tier: r.tier, offers });
            tierDraftOwed = true;
          } else {
            rewardLabel = null; // no eligible upgrades to grant
          }
          break;
        }
      }
    }
    setLastContractSummary({
      doorId: activeDoor.id,
      doorName: activeDoor.name,
      ...blockStatsRef.current,
      missionText: activeDoor.mission.text,
      rewardLabel,
    });
    return { tierDraftOwed };
  }, [activeDoor, blockResults, ownedUpgradeIds, upgrades, currentLevelIndex]);

  /**
   * Assignment level (every 5th): no shop. Grant the finished assignment's
   * reward, then (if a tier draft is owed) show the 1-of-3 upgrade pick, else
   * route into the capstone or assignment draft.
   */
  const beginAssignmentPhase = useCallback(() => {
    setPendingLevelScore(null);
    const hadAssignment = !!activeDoor;
    grantAssignmentReward();
    if (hadAssignment) {
      // #63: recap how the finished mission went on its own screen before the
      // next draft. Continuing from it routes into the tier pick / next draft.
      setSummaryIsFinal(false);
      nav.goToAssignmentSummary();
      return;
    }
    // No assignment this block (skipped, or the first block): the summary would
    // be empty, so route straight into the next draft.
    routeAfterAssignmentReward();
  }, [activeDoor, grantAssignmentReward, routeAfterAssignmentReward, nav.goToAssignmentSummary]);

  /**
   * Route out of the "Assignment Complete" summary: into the run finale for the
   * final block, otherwise into the capstone/assignment draft. (#63)
   */
  const routeAfterSummary = useCallback(() => {
    if (summaryIsFinal) {
      nav.goToAscensionDraft();
      return;
    }
    routeAfterAssignmentReward();
  }, [summaryIsFinal, routeAfterAssignmentReward, nav.goToAscensionDraft]);

  /**
   * Continue button on the assignment summary: a tier-draft reward is picked
   * first (summary-first, then pick), otherwise straight on to the next phase.
   */
  const handleContinueFromSummary = useCallback(() => {
    if (pendingTierDraft) {
      nav.goToTierDraft();
      return;
    }
    routeAfterSummary();
  }, [pendingTierDraft, routeAfterSummary, nav.goToTierDraft]);

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
    // Features unlocked this round; show the first "Feature Unlocked" modal now
    // (it overlays whatever screen we navigate to next). Dismissing advances the
    // queue, so multiple unlocks (e.g. achievements + certificates at level 5)
    // show one after another.
    if (pendingFeatureUnlocksRef.current.length > 0) {
      setUnlockedFeature(pendingFeatureUnlocksRef.current.shift()!);
    }
    if (isLastLevel) {
      // Beat the final level: grant the final block's assignment reward and, if
      // there was an assignment, recap it (#63) before the ascend-or-retire
      // choice. The pending level score is kept so handleRetire can put it on
      // the result screen.
      const hadAssignment = !!activeDoor;
      grantAssignmentReward();
      if (hadAssignment) {
        setSummaryIsFinal(true);
        nav.goToAssignmentSummary();
      } else {
        nav.goToAscensionDraft();
      }
    } else if (isAssignmentLevel(currentLevelIndex + 1)) {
      beginAssignmentPhase();
    } else {
      // The shop is only earned by locking balls this round: at least one lock,
      // or two when the map offered three or more balls. We still OPEN the shop
      // when short, but it opens "closed" (no purchases) so the player sees what
      // they missed instead of the store being silently skipped.
      const locksThisRound = pendingLevelScore?.lockedBallsCount ?? 0;
      const ballsOnMap = currentLevel?.maxBalls ?? currentLevel?.balls?.length ?? 1;
      // Corporate Card relaxes the toll: one level caps it at a single lock,
      // two waives it entirely and the shop is simply always open.
      const relief = Math.max(0, Math.round(activeModifiers.storeLockRelief ?? 0));
      const locksRequired = relief >= 2 ? 0 : Math.min(relief >= 1 ? 1 : 2, ballsOnMap >= 3 ? 2 : 1);
      // Hiring Freeze (ascension rung 1): on the levels the store skips there is
      // nothing to show, so go straight on. Assignment levels never reach here,
      // so a contract can never be swallowed by the cadence.
      if (!shopOpensAfter(currentLevelIndex + 1, ascRules)) {
        finishShopPhase();
        return;
      }
      setStoreClosed(locksThisRound < locksRequired);
      setStoreLockProgress({ have: locksThisRound, need: locksRequired });
      nav.goToUpgradeShop();
    }
  }, [isLastLevel, currentLevelIndex, beginAssignmentPhase, pendingLevelScore, currentLevel, activeDoor, grantAssignmentReward, ascRules, activeModifiers.storeLockRelief, finishShopPhase, nav.goToAssignmentSummary, nav.goToAscensionDraft, nav.goToUpgradeShop]);

  const handleDismissFeatureUnlocked = useCallback(() => {
    // Advance to the next queued unlock, or close if none remain.
    setUnlockedFeature(pendingFeatureUnlocksRef.current.shift() ?? null);
  }, []);

  /** Ascend: draft a loadout and loop back to level 1 at depth + 1. */
  const handleAscend = useCallback((loadoutId: string) => {
    const newDepth = ascensionDepth + 1;
    analytics.ascensionStarted({ depth: newDepth, loadoutId });
    setDraftedLoadoutIds(prev => [...prev, loadoutId]);
    setAscensionDepth(newDepth);
    recordAscensionDepth(newDepth);

    // Refill lives to the run's starting value (never down), then apply the
    // drafted loadout's life delta once — same as buying an extraLives upgrade.
    const startingLives = baseLives() + ((certBonuses.extraLives as number | undefined) ?? 0);
    const livesDelta = loadoutLookup.get(loadoutId)?.modifiers.extraLives ?? 0;
    const refilled = Math.max(1, Math.max(currentLives, startingLives) + livesDelta);
    setCurrentLives(refilled);
    setLivesAtLevelStart(refilled);

    setPendingLevelScore(null);
    setActiveDoor(null); // the pre-ascension map's door does not follow into the loop
    blockStatsRef.current = { overtime: 0, maps: 0, locks: 0, livesLost: 0 };
    setBlockResults([]); // fresh mission block for the new loop (#60)
    setPendingTierDraft(null);
    setLastContractSummary(null);
    // Assignment reward modifiers persist across ascension (part of the run's build).
    resetToFirstLevel(); // also re-randomizes the level variants for the new loop
    nav.goToGame();
  }, [ascensionDepth, recordAscensionDepth, certBonuses, loadoutLookup, currentLives, resetToFirstLevel, nav.goToGame]);

  /**
   * Confirm the run-start loadout draft: adopt the chosen loadout (or none on
   * skip) at depth 0, then enter the game. Applies the loadout's extraLives
   * delta once, mirroring handleAscend.
   */
  const handleConfirmLoadout = useCallback((loadoutId: string | null) => {
    analytics.loadoutSelected({ loadoutId });
    if (loadoutId) {
      setDraftedLoadoutIds([loadoutId]);
      const startingLives = baseLives() + ((certBonuses.extraLives as number | undefined) ?? 0);
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
    analytics.runEnded({
      isWin: true,
      levelsCompleted,
      totalScore,
      ascensionDepth,
      daily: dailyKeyRef.current !== null,
    });
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
    captureRunRecap(totalScore);
    fileRunOnLedger(totalScore);
    clearRun(); // retiring banks and ends the run
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
  }, [runLevelsCompleted, finalizeRun, activeModifiers.extraCertificateHours, nav.endGame, pendingLevelScore, currentLevel, currentLevelIndex, totalScore, ascensionDepth, activeLoadouts, captureRunRecap, fileRunOnLedger, clearRun]);

  const handlePurchaseUpgrade = useCallback((upgradeId: string, price: number) => {
    analytics.upgradePurchased({ upgradeId, price, level: currentLevelIndex + 1 });
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
  }, [upgrades, certSourceIds, recordMaxTierPurchase, currentLevelIndex]);

  const handleContinueFromShop = useCallback(() => {
    // Budget Cycle: this visit's spend buys next-map boons. Granted here and
    // expired at the next level completion. The chunk scales with the same
    // market-rate inflation as prices (see upgradePricing.inflationForLevel).
    const chunkHours = Math.round(SPEND_CHUNK_HOURS * inflationForLevel(currentLevelIndex + 1));
    const chunks = spendChunks(spentThisShopVisitRef.current, chunkHours, spendChunkCap(activeModifiers));
    spentThisShopVisitRef.current = 0;
    const boons = spendBoons(chunks, activeModifiers);
    setCarrySpendFences(boons.instantFences);
    setCarrySpendFenceSpeed(boons.fenceSpeedBonus);
    setCarrySpendCapture(boons.capturePercent);

    // Free-store-item pickup (issue #48): an OPEN store visit consumes one
    // voucher (the shop showed its cheapest offer free). Closed stores keep it.
    if (!storeClosed && carryFreeShopItems > 0) {
      setCarryFreeShopItems(n => Math.max(0, n - 1));
    }

    finishShopPhase();
  }, [currentLevelIndex, activeModifiers, finishShopPhase, storeClosed, carryFreeShopItems]);

  /** Capstone draft pick: permanent for the run, then on to the assignment. */
  const handleSelectCapstone = useCallback((pick: CapstoneConfig) => {
    analytics.capstoneSelected({ capstoneId: pick.id });
    setCapstone(pick);
    proceedToAssignment();
  }, [proceedToAssignment]);

  /**
   * Assignment pick (mandatory): the chosen contract replaces the previous
   * one and runs until the next assignment swaps it out.
   */
  const handleSelectDoor = useCallback((door: AssignmentConfig) => {
    analytics.doorSelected({ doorId: door.id, level: currentLevelIndex + 1 });
    setActiveDoor(door);
    blockStatsRef.current = { overtime: 0, maps: 0, locks: 0, livesLost: 0 }; // new contract, fresh card (#49)
    setBlockResults([]); // new mission block (#60)
    advanceToNextLevel();
    nav.goToGame();
  }, [advanceToNextLevel, nav.goToGame, currentLevelIndex]);

  /**
   * Skip the assignment (issue #60): take on no constraint and no mission for
   * the next block. Neutral by design, which is what makes accepting a real
   * choice. Clears any active assignment and its block accumulators.
   */
  const handleSkipAssignment = useCallback(() => {
    analytics.doorSelected({ doorId: 'skip', level: currentLevelIndex + 1 });
    setActiveDoor(null);
    blockStatsRef.current = { overtime: 0, maps: 0, locks: 0, livesLost: 0 };
    setBlockResults([]);
    advanceToNextLevel();
    nav.goToGame();
  }, [advanceToNextLevel, nav.goToGame, currentLevelIndex]);

  /**
   * Tier-draft reward pick (issue #60): grant the chosen upgrade, then continue
   * to the capstone or assignment draft.
   */
  const handleSelectTierUpgrade = useCallback((upgradeId: string) => {
    setOwnedUpgradeIds(prev => (prev.includes(upgradeId) ? prev : [...prev, upgradeId]));
    const upgrade = upgrades.find(u => u.id === upgradeId);
    const extraLives = upgrade?.modifiers?.extraLives;
    if (typeof extraLives === 'number' && extraLives !== 0) setCurrentLives(prev => prev + extraLives);
    setPendingTierDraft(null);
    routeAfterSummary();
  }, [upgrades, routeAfterSummary]);

  const handlePurchaseCertLevel = useCallback((certId: string, targetLevel: number) => {
    purchaseCertLevel(certId, targetLevel);
  }, [purchaseCertLevel]);

  const handlePlayAgain = useCallback((startLevel?: number) => {
    clearDailyMode(); // play-again is always a normal (unseeded) run
    resetRunScopedState();

    // The accessor everywhere a run starts, even where the memo happens to be
    // fresh (this path loads nothing): one rule is harder to break by accident
    // than "the memo, except in the two handlers that fetch".
    const certs = getLoadedCertBonuses();
    const certBonusLives = (certs.extraLives as number | undefined) ?? 0;
    const startingLives = baseLives() + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    setContinuesRemaining(BASE_CONTINUES + ((certs.extraContinues as number | undefined) ?? 0));
    setPendingDeathResult(null);

    if (startLevel !== undefined) {
      setLevelIndex(startLevel - 1);
    } else {
      clearRunCheckpoints();
      const certStartLevel = getLoadedCertStartingLevel();
      if (certStartLevel > 1) {
        setLevelIndex(certStartLevel - 1);
      } else {
        resetToFirstLevel();
      }
    }

    analytics.runStarted({ mode: 'playAgain', daily: false });

    enterRun(loadoutsIntroduced);
  }, [resetToFirstLevel, setLevelIndex, resetRunScopedState, clearRunCheckpoints, loadoutsIntroduced, clearDailyMode, enterRun]);

  const handleRestartRun = useCallback(() => {
    clearDailyMode(); // restart is always a normal (unseeded) run
    resetRunScopedState();
    clearRunCheckpoints();

    const certs = getLoadedCertBonuses();
    const certBonusLives = (certs.extraLives as number | undefined) ?? 0;
    const startingLives = baseLives() + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    setContinuesRemaining(BASE_CONTINUES + ((certs.extraContinues as number | undefined) ?? 0));
    setPendingDeathResult(null);

    resetToFirstLevel();
    enterRun(loadoutsIntroduced);
  }, [resetToFirstLevel, resetRunScopedState, clearRunCheckpoints, loadoutsIntroduced, clearDailyMode, enterRun]);

  const handleBackToWelcome = useCallback(() => {
    // NOTE: does NOT clear the daily context; a saved daily run keeps its key
    // and Continue restores the seed. The next new-run path disarms it.
    resetToFirstLevel();
    resetRunScopedState();
    setCurrentLives(baseLives());
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

  // Total Reset: a complete deletion of ALL game state (progression, unlocks,
  // scores, saved run, tutorials-seen, ...), returning the install to a
  // brand-new state. Clears storage and reloads; the in-memory resets below are
  // belt-and-suspenders in case a host blocks the reload.
  const handleTotalReset = useCallback(() => {
    resetCertData();
    resetProgression();
    performTotalReset();
  }, [resetCertData, resetProgression]);

  // Load the ball catalogue (balls.yml) once on mount so the Tutorial reflects
  // edits even before a run starts. handleStartGame reloads it per run.
  useEffect(() => { loadBallTypes(); loadAbilities(); }, []);

  // Panic Button (features.yml 'panicShockwave', unlocked by beating the first
  // boss at level 10): once unlocked, every map starts topped up to at least one
  // free Shockwave charge - the game's "get the balls moving again" safety valve.
  // Keyed on the level index so it re-tops each new map; idempotent and never
  // lowers a bigger stack, so chest-earned charges are left untouched. Runs the
  // moment the feature flips unlocked too (deps include isFeatureUnlocked).
  useEffect(() => {
    if (!isFeatureUnlocked('panicShockwave')) return;
    setAbilityCharges(prev =>
      (prev.shockwave ?? 0) >= 1 ? prev : { ...prev, shockwave: 1 },
    );
  }, [currentLevelIndex, isFeatureUnlocked, setAbilityCharges]);

  // Sync completed achievements into cert manager for achievement-locked certs
  useEffect(() => {
    if (completedAchievementIds.length > 0) {
      checkAchievementUnlocks(completedAchievementIds);
    }
  }, [completedAchievementIds, checkAchievementUnlocks]);

  // Auto-start when a ?level= or ?ascension= debug jump is present. Either one
  // alone is enough, so ?ascension=6 drops straight into a depth-6 run.
  const levelQueryHandled = useRef(false);
  useEffect(() => {
    if (levelQueryHandled.current) return;
    const levelParam = new URLSearchParams(window.location.search).get('level');
    const wantsJump = (levelParam != null && parseInt(levelParam, 10) > 0) || debugAscensionDepth() > 0;
    if (wantsJump) {
      levelQueryHandled.current = true;
      handleStartGame(undefined, true); // debug jump skips the loadout draft
    }
  }, [handleStartGame]);

  return {
    // Tenure (issue #75)
    pendingTenure,
    handleTenurePicked,
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
    shouldShowDaily,
    shouldShowTimeLimit,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
    markAscensionSeen,
    markDailySeen,
    markTimeLimitSeen,
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
    /** What build scaling is paying right now, per upgrade (upgradeScaling.ts). */
    scalingReadouts: scalingDetail,
    /** The ladder rungs in force at the current depth (ascensionLadder.ts). */
    ascensionRules: ascRules,
    ascensionLadder: ascensionConfig.ladder,
    loadouts,
    availableLoadouts,
    draftedLoadoutIds,
    activeLoadouts,
    wonLoadoutIds,
    loadoutsIntroduced,
    isFeatureUnlocked,
    unlockedFeature,
    fenceDurability,
    // Continue (per-run revive)
    continuesRemaining,
    gameInstanceKey,
    introAssemblePending,
    storeClosed,
    storeLockProgress,
    carryFreeShopItems,
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
    // Mission block state (#60): per-map results for the live progress readout,
    // and the owed tier-draft reward (1-of-3 upgrade pick).
    blockResults,
    pendingTierDraft,
    handleSkipAssignment,
    handleSelectTierUpgrade,
    // How the just-finished contract went (#49): block stats + reward, used by
    // both the assignment draft report and the #63 summary screen.
    lastContractSummary,
    // Assignment-complete summary (#63): Continue routes on to the tier pick /
    // next draft / finale.
    handleContinueFromSummary,
    // The map the door draft previews (null past the final level).
    nextLevel: levels[currentLevelIndex + 1] ?? null,
    handleSelectDoor,
    // Capstone ("Promotion")
    capstoneOffers,
    capstone,
    handleSelectCapstone,
    // Run persistence (Continue / New Game on the welcome screen)
    hasSavedRun,
    /** The saved run's ascension depth, for the menu's Continue button. */
    savedRun,
    handleContinueRun,
    // Records (HIGHSCORES.md Phase A/B/C/D)
    levelPace,
    lastRunRank,
    topRuns,
    monthlyBests,
    archetypeBests,
    // Daily Stand-up
    dailyKey,
    dailyBests,
    dailyStreak,
    handleStartDaily,
    // Callbacks
    handleStartGame,
    handleConfirmLoadout,
    handleGameEnd,
    handleMapTimedOut,
    handleSpendContinue,
    handleDeclineContinue,
    handleLivesChange,
    handleGrantAbility,
    handleSpendAbility,
    abilityCharges,
    handleLevelComplete,
    handleContinueFromOverlay,
    handleDismissFeatureUnlocked,
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
    handleTotalReset,
  };
}

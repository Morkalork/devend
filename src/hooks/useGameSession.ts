/**
 * useGameSession — the single orchestrator for one player session.
 *
 * Index.tsx calls this once and passes the result down to every screen.
 * It wires together all the smaller managers:
 *   - useLevelManager        levels from public/map.yml, current level index
 *   - useUpgradeManager      shop upgrades from public/upgrades.yml
 *   - sprintOffers           the run-start draft's offers from public/offers.yml
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
import { useActiveModifiers, mergeBonuses, GameModifiers, MULTIPLICATIVE_KEYS, ModifierSource } from './useActiveModifiers';
import { useTutorialManager } from './useTutorialManager';
import { useCheckpointSnapshots } from './useCheckpointSnapshots';
import { useRunSave, RunSave, type BetweenMapsSave } from './useRunSave';
import type { StoreDealt } from '@/ui/screens/shopModel';
import { useHallOfFame } from './useHallOfFame';
import { creditExtraContinues, type ExtraContinuesMark } from '@/lib/extraContinues';
import { aheadThroughMaps, RunRankInfo } from '@/lib/runLedger';
import { setRunSeedText, getRunRng, todayKey, dailySeedText } from '@/lib/runRng';
import { useCertificateManager, getLoadedCertBonuses, getLoadedCertStartingLevel } from './useCertificateManager';
import { useMetaProgression } from './useMetaProgression';
import { loadBallTypes } from '@/lib/ballTypes';
import { loadFenceTypes } from '@/lib/fences';
import { loadBugs } from "@/lib/bugs";
import { GameFeature, getFeature, featuresUnlockedAtLevel, loadFeatures } from '@/lib/features';
import { performTotalReset } from '@/lib/totalReset';
import { loadAbilities, getAllAbilities, rollCappedAbilityReward } from '@/lib/abilities';
import { computeActiveTagSets, ownedTagCounts, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { computeBuildIdentity, RunRecap } from '@/lib/buildRecap';
import { isOnboardingMap } from '@/lib/onboardingMap';
import { loadMapMutators } from '@/lib/mapMutators';
import { loadMapObjectives } from '@/lib/mapObjectives';
import { UpgradeConfig } from '@/types/upgrade';
import { loadCapstones, getCapstones, capstoneDueAfter, drawCapstoneOffers, CAPSTONE_OFFER_COUNT } from '@/lib/capstones';
import type { BetweenMapPlan } from '@/ui/screens/pipelineModel';
import { CapstoneConfig } from '@/types/capstone';
import {
  loadOffers, getOffer, getOfferCatalogue, rollSprintDeal, shopLeanOf, offerModifierLayers, pickLivesDelta,
  allOffers, type DealtOffer,
} from '@/lib/sprintOffers';
import { getForcedSprintOffer, getForcedJackpot, isSprintAlwaysOn } from '@/lib/devFlags';
import { SPRINT_PLANNING_ENABLED } from '@/lib/sprintPlanning';
import { storeInterest, desperationMultiplier } from '@/lib/offerPerks';
import { runwayBonuses, spendChunks, spendBoons, spendChunkCap, SPEND_CHUNK_HOURS } from '@/lib/treasury';
import { inflationForLevel } from '@/lib/upgradePricing';
import { useAchievementManager } from './useAchievementManager';
import { useScreenNavigation } from './useScreenNavigation';
import { GameResult, LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';
import { analytics } from '@/lib/analytics';
import { baseStartingLives, isInfiniteLivesEnabled, debugMutatorId, forcedTilts } from '@/lib/devFlags';
import { hasAnyMapTuning } from '@/lib/mapTuning';
import { TenureOffer, TENURE_OFFER_COUNT, tenureSteps, rollTenureOffers, isContinuation } from '@/lib/tenure';
import { fenceSlotsFrom } from "@/lib/fenceOwnership";
import { devFenceSlots } from "@/lib/devFlags";
import { computeScalingBonuses, scalingReadouts } from '@/lib/upgradeScaling';
import { registerRunFlush, installRunFlushListeners } from '@/lib/runSaveFlush';
import { replenishAbilityCharges, heldAbilityIds } from '@/lib/abilityReplenish';
import { MAX_ABILITY_SLOTS } from '@/lib/abilities';
import { mapContextOf, type RunContext } from '@/lib/upgradeConditions';
import { liveUpgradeIds } from '@/lib/upgradeMigration';

/**
 * Drop one debug query param, keeping the rest. Replacing the whole search
 * string would also drop any other param riding along with the level jump.
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

export const NORMAL_LIVES = 3;
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
/** Completing this level grants 1 free Continue (once per run). */
const FREE_CONTINUE_LEVEL = 20;
/** War Chest ceiling: banked overtime never slows balls by more than this. */
const MAX_BANKED_SLOW = 0.08;
/**
 * Hours of bank that earn one War Chest step.
 *
 * Named rather than inlined because it is an HOURS figure living in code: it
 * was a bare `/ 50` and the modifier key still read `per50h`, so deflating the
 * economy would have quartered War Chest's strength with nothing in the diff
 * to notice it. 13 is a quarter of the old 50, which keeps a given bank buying
 * the slowdown it always did.
 */
const BANKED_SLOW_STEP_HOURS = 13;

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

  /**
   * A run is booting: every catalogue is being fetched before the first map.
   *
   * `isLoadingLevels || isLoadingUpgrades` alone was not enough. A run start
   * awaits ELEVEN catalogues in one Promise.all, and those two are only the
   * first pair to resolve - so the menu's spinner stopped while nine fetches
   * were still in flight and the navigation was still waiting on them. The
   * player got a normal-looking button and a pause with nothing happening,
   * which is the "brief pause before the game starts" that was reported.
   */
  const [bootingRun, setBootingRun] = useState(false);
  const isLoading = isLoadingLevels || isLoadingUpgrades || bootingRun;
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
  // Retainers bought in the store's ability slot. Kept apart from
  // ownedUpgradeIds deliberately: an ability is not an upgrade, and letting one
  // into that list would feed it to tag weighting, the upgrade graph, the
  // certificate chase and the save migration, none of which know what it is.
  const [retainedAbilityIds, setRetainedAbilityIds] = useState<string[]>([]);
  // The ability handed over free on this store visit (Open Source Contribution),
  // so the shop can say what arrived. Null on a visit that granted nothing.
  const [freeAbilityGrant, setFreeAbilityGrant] = useState<string | null>(null);
  // Every ability EARNED this run, including ones already spent. A replenishing
  // ability (abilities.yml `replenishTo`) is keyed on this rather than on the
  // live stack, so spending your last Shockwave does not end the replenishment.
  const everHeldAbilityIdsRef = useRef<string[]>([]);

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

  /**
   * Sprint Planning (SPRINT_PLANNING_PLAN.md): the three cards dealt before
   * map 1, already resolved. When the previous run earned Tenure (issue #75),
   * its chain is the boon card. Dealt fresh per run, so a retry is a new draw.
   */
  const [pendingSprint, setPendingSprint] = useState<{ cards: DealtOffer[] } | null>(null);
  /**
   * A taken offer whose prize is a choice (Pick a Junior, Headhunted): the
   * chains the player picks one of on the next screen.
   */
  const [pendingChainPick, setPendingChainPick] = useState<{ offerId: string; choices: TenureOffer[] } | null>(null);

  // Capstone ("Promotion"): the once-per-run exclusive perk, drafted 1-of-3
  // at the first map end at/past the trigger level. Permanent for the run;
  // cleared only on run resets.
  const [capstoneOffers, setCapstoneOffers] = useState<CapstoneConfig[]>([]);
  // What this store visit put on its shelf, kept for the run save (a run
  // resumed in the store reopens the same shelf). Cleared per visit.
  const [storeDealt, setStoreDealt] = useState<StoreDealt | null>(null);
  // Procurement's interest this visit paid, for the store's treasury strip.
  const [storeInterestPaid, setStoreInterestPaid] = useState(0);
  const handleShopDealt = useCallback((dealt: StoreDealt) => setStoreDealt(dealt), []);
  // A resumed run saved between maps, waiting for its level sequence to settle
  // before it is routed back to the stage it was saved on.
  const [resumeBetween, setResumeBetween] = useState<{ at: number; between: BetweenMapsSave } | null>(null);
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
  // Run-start intro: the first map of a run opens with the longer boot reveal
  // (GameCanvas runStartIntro). Armed by every fresh-run path, disarmed by the
  // first completed level so mid-run maps get the short one.
  const [runStartIntroPending, setRunStartIntroPending] = useState(false);
  // When a round is left without the locks the store requires, we still open the
  // store but show it "closed" (see UpgradeShop `closed`) rather than skipping it.
  const [storeClosed, setStoreClosed] = useState(false);
  // Locks made this round vs. required (for the closed-store "X/Y" banner, #67).
  const [storeLockProgress, setStoreLockProgress] = useState<{ have: number; need: number }>({ have: 0, need: 1 });

  // The offer this run took at Sprint Planning (null: skipped, or none dealt).
  const [takenOfferId, setTakenOfferId] = useState<string | null>(null);

  // Snapshot of the just-finalized run for the result screen (finalizeRun
  // resets the live counters, so the result screen can't read those).
  const [lastRunSummary, setLastRunSummary] = useState<{ levelsCompleted: number; hoursAwarded: number } | null>(null);

  // Sprint Planning offers this run unlocked (shown on the result screen).
  const [lastRunOfferUnlocks, setLastRunOfferUnlocks] = useState<string[]>([]);

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
    isLoaded: certsLoaded,
  } = useCertificateManager({ onHourEarned: handleCertificateHourEarned });

  const {
    shouldShowFence,
    shouldShowStore,
    shouldShowCertStore,
    shouldShowMover,
    shouldShowTopBar,
    shouldShowBottomBar,
    shouldShowDaily,
    shouldShowTimeLimit,
    markOnboardingSeen,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
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
  // the #1 run's per-map trajectory, which the end-of-run epitaph reads.
  const { topRuns, bestRunTrajectory, monthlyBests, dailyBests, dailyStreak, bestScore, recordRun } = useHallOfFame();
  // Cumulative overtime after each completed map of the CURRENT run. A ref
  // because it's appended inside handleLevelComplete's synchronous flow and
  // persisted via the run-save snapshot (also refreshed per render).
  const runTrajectoryRef = useRef<number[]>([]);
  // Debug starts (?level= / forceLevel) never file on the ledger.
  const recordEligibleRef = useRef(true);

  /**
   * Keep a run off the solo ladder.
   *
   * Called by the pair session at the start of a two-player run
   * (TWO_PLAYER_PLAN.md). A pair cuts roughly twice as fast, so pair runs would
   * take over the records within an evening and the solo ladder would stop
   * measuring solo play, which is the one thing it is for. Records for pairs
   * are a separate ladder and a separate decision; until then they simply do
   * not file.
   */
  const markRunIneligible = useCallback(() => {
    recordEligibleRef.current = false;
  }, []);

  /**
   * Whether the run in progress was started in 2-Player mode.
   *
   * Such a run belongs to the pair. It is saved under the pair's own key on
   * both phones (usePairRunSave) and offered again from the 2-Player screen,
   * and it must never become the welcome screen's Continue: that button would
   * drop one player alone into a run two people were building, under a seed
   * and turn order that only mean anything with the partner there. So a pair
   * run neither writes the solo save nor clears it; whatever solo run the
   * player had parked before pairing is still there when they come back.
   *
   * Set for the whole run, including after "carry on alone": the run was
   * still born in a pair. Decided at the START of every run, by whichever
   * entry point starts it: the pair arms `pairStartPendingRef` just before it
   * calls in, and every start consumes it, so a solo start (New Game,
   * Continue, the Daily, the level picker) always lands on false.
   */
  const pairRunRef = useRef(false);
  const pairStartPendingRef = useRef(false);
  const beginPairRun = useCallback(() => { pairStartPendingRef.current = true; }, []);
  // Where the just-finished run landed on the ladder (for the result screen).
  const [lastRunRank, setLastRunRank] = useState<(RunRankInfo & { aheadThroughMaps: number | null; monthBest: boolean; dayBest?: boolean; dailyStreak?: number }) | null>(null);
  // Daily Stand-up (HIGHSCORES.md Phase D): non-null = this run is the seeded
  // daily for that "YYYY-MM-DD" key. Mirrored in a ref for the filing path.
  const [dailyKey, setDailyKey] = useState<string | null>(null);
  const dailyKeyRef = useRef<string | null>(null);

  const {
    stats: metaStats,
    isLoaded: metaLoaded,
    metArchetypes,
    encounteredBallTypeIds,
    recordLevelReached,
    recordRunEnded,
    recordRunUpgrades,
    lastRunUpgradeIds,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordPushBonusBanked,
    recordArchetypeMet,
    recordBallTypeEncountered,
    unlockFeature,
    isFeatureUnlocked,
    resetProgression,
  } = useMetaProgression();

  // Sprint Planning is a feature unlock (features.yml): the very first run goes
  // straight into the map, and the draft starts with the run after the one
  // that cleared its unlock level. Admin can force it on (devFlags).
  const sprintUnlocked = isFeatureUnlocked('sprintPlanning');

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
  /**
   * The welcome menu has everything it reads at startup: the lifetime stats
   * and unlocks, the certificate store, and the back-fill below, which can
   * add buttons a render after the stats arrive. Until then the menu is still
   * changing shape, so the startup splash holds (TapToStartGate). Set in the
   * same effect as the back-fill's unlocks, so the render that reports ready
   * is the render that already shows them.
   */
  const [menuDataReady, setMenuDataReady] = useState(false);
  useEffect(() => {
    if (featureReconcileDoneRef.current || !metaLoaded || !certsLoaded) return;
    featureReconcileDoneRef.current = true;
    setMenuDataReady(true);
    // Reached level 5+ => cleared level 5 => achievements were available.
    if (metaStats.highestLevelReached >= 5) unlockFeature('achievements');
    // Already past Sprint Planning's unlock level: no modal for something the
    // player has effectively already earned.
    const sprintLevel = getFeature('sprintPlanning')?.unlockLevel;
    if (sprintLevel !== undefined && metaStats.highestLevelReached > sprintLevel) unlockFeature('sprintPlanning');
    const hadCertificates =
      totalCertificateHours > 0 ||
      unlockedCertIds.length > 0 ||
      Object.keys(certLevelsOwned).length > 0;
    if (hadCertificates) unlockFeature('certificates');
  }, [metaLoaded, certsLoaded, metaStats.highestLevelReached, totalCertificateHours, unlockedCertIds, certLevelsOwned, unlockFeature]);

  const {
    achievements,
    completedIds: completedAchievementIds,
    activatedIds: activatedAchievementIds,
    bonusModifiers: achievementBonuses,
    checkAndComplete: checkAndCompleteAchievements,
    activateAchievement,
  } = useAchievementManager();

  /** The Sprint Planning offer this run took (null when it skipped). */
  const runOffer = useMemo(() => getOffer(takenOfferId) ?? null, [takenOfferId]);
  /** Its Specialisation's lean on the shop, when it is one. */
  const shopLean = useMemo(() => shopLeanOf(runOffer), [runOffer]);

  /**
   * The taken offer, folded into the same bonus map the achievements and
   * certificates use: its price for the whole run, its modifiers while they
   * last (a `forMaps` boon stops after the run's first N maps).
   */
  const offerBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const layer of offerModifierLayers(runOffer, runLevelsCompleted)) {
      bonuses = mergeBonuses(bonuses, layer as Partial<Record<keyof GameModifiers, number>>);
    }
    return bonuses;
  }, [runOffer, runLevelsCompleted]);

  // Set bonuses: free modifier bundles active while the player owns enough
  // upgrades of a tag (tagSets block in upgrades.yml). A Specialisation counts
  // toward its own tag's set.
  const activeTagSets = useMemo(
    () => computeActiveTagSets(ownedUpgradeIds, upgrades, tagSets,
      shopLean ? { tag: shopLean.tag, amount: shopLean.countsTowardSet } : null),
    [ownedUpgradeIds, upgrades, tagSets, shopLean]
  );

  // A set firing is meeting the archetype: it unlocks that tag's
  // Specialisation for later runs, and the result screen says so.
  useEffect(() => {
    for (const set of activeTagSets) {
      if (!recordArchetypeMet(set.tag)) continue;
      const unlocked = allOffers(getOfferCatalogue())
        .filter(o => o.unlock?.kind === 'archetypeMet' && o.unlock.tag === set.tag)
        .map(o => o.name);
      if (unlocked.length > 0) setLastRunOfferUnlocks(prev => [...prev, ...unlocked.filter(n => !prev.includes(n))]);
    }
  }, [activeTagSets, recordArchetypeMet]);
  const tagSetBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const s of activeTagSets) {
      bonuses = mergeBonuses(bonuses, s.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    return bonuses;
  }, [activeTagSets]);

  /**
   * The fence types in the player's slots (FENCE_TYPES_PLAN.md step 7).
   *
   * Three sources, one list. Certificates come FIRST because they are
   * account-scoped: the drill is in the bar from map one for a player who owns
   * it, and putting it first also means a run that then buys three more never
   * pushes it out. Upgrade grants follow in catalogue order, and the dev flag
   * last, as an override for testing a loadout without shopping for it.
   *
   * fenceSlotsFrom does the deduping, the cap and the unknown-id filtering, so
   * none of the three economies has to know what a slot is.
   */
  const fenceSlotIds = useMemo(() => {
    const fromCerts = certificates.flatMap(c =>
      (c.levels ?? [])
        .slice(0, certLevelsOwned[c.id] ?? 0)
        .filter(l => l.effect.type === "grantsFenceType")
        .map(l => l.effect.fenceType ?? ""),
    );
    const fromUpgrades = ownedUpgradeIds
      .map(id => upgrades.find(u => u.id === id)?.grantsFenceType ?? "")
      .filter(Boolean);
    return fenceSlotsFrom([...fromCerts, ...fromUpgrades, ...devFenceSlots()]);
  }, [certificates, certLevelsOwned, ownedUpgradeIds, upgrades]);

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
      mergeBonuses(mergeBonuses(achievementBonuses, certBonuses), offerBonuses),
      mergeBonuses(
        mergeBonuses(tagSetBonuses, scalingBonuses),
        capstone?.modifiers as Partial<Record<keyof GameModifiers, number>> | undefined,
      ),
    ),
    [achievementBonuses, certBonuses, offerBonuses, tagSetBonuses, scalingBonuses, capstone]
  );

  // Two-pass modifier resolution: the base pass aggregates every static source;
  // a second pass folds in run-state-dependent effects that READ base values
  // (War Chest keys off bankedSlowPerStep + the bank; Clean Release off the
  // under-par carry). Both fold through the same merge rules as everything else.
  /**
   * The run as it stands, for upgrades that only pay in a situation.
   *
   * Rebuilt when the map or the run state changes, and NOT per frame: a
   * modifier set that shifted mid-map would mean a fence started under one rule
   * finishing under another, and the HUD drifting while the player watched.
   */
  const runContext = useMemo<RunContext>(() => ({
    level: currentLevelIndex + 1,
    lives: livesAtLevelStart,
    banked: totalScore,
    map: mapContextOf(currentLevel),
  }), [currentLevelIndex, livesAtLevelStart, totalScore, currentLevel]);

  /**
   * The run as it will stand on the NEXT map, for the shop.
   *
   * The shop sits between maps, and `runContext` still describes the one just
   * finished. A card that says "live" about the map you already played is worse
   * than saying nothing: the player buys on the strength of it and the number
   * never appears. So the shop asks about the map it is selling into.
   *
   * Null past the final level, which reads as "no map known" and shows every
   * condition as unmet rather than falsely promising one.
   */
  const nextRunContext = useMemo<RunContext | null>(() => {
    const next = levels[currentLevelIndex + 1];
    if (!next) return null;
    return {
      level: currentLevelIndex + 2,
      lives: currentLives,
      banked: totalScore,
      map: mapContextOf(next),
    };
  }, [levels, currentLevelIndex, currentLives, totalScore]);

  const baseModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, mergedBonuses, runContext);
  const dynamicBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    if (baseModifiers.bankedSlowPerStep > 0 && totalScore > 0) {
      const reduction = Math.min(MAX_BANKED_SLOW, Math.floor(totalScore / BANKED_SLOW_STEP_HOURS) * baseModifiers.bankedSlowPerStep);
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
    // Growth (Sprint Planning): a map started below three lives pays more.
    // livesAtLevelStart, not currentLives, so the rate is fixed for the map.
    const desperation = desperationMultiplier(livesAtLevelStart, baseModifiers.scoreBonusPerMissingLife);
    if (desperation > 1) bonuses = mergeBonuses(bonuses, { scoreMultiplier: desperation });
    // Warm Cache: fence growth snowballs with each map cleared this run.
    // Translate the per-cleared-map coefficient into a fenceGenerationSpeedMultiplier
    // boost, capped so a deep run can't run away with it.
    if (baseModifiers.fenceSpeedPerMapCleared > 0 && runLevelsCompleted > 0) {
      const rampMaps = Math.min(runLevelsCompleted, WARM_CACHE_RAMP_CAP);
      bonuses = mergeBonuses(bonuses, {
        fenceGenerationSpeedMultiplier: 1 + baseModifiers.fenceSpeedPerMapCleared * rampMaps,
      });
    }
    return bonuses;
  }, [baseModifiers, totalScore, carryInstantFences, carrySpendFences, carrySpendFenceSpeed, carrySpendCapture, runLevelsCompleted, livesAtLevelStart]);
  const finalBonuses = useMemo(
    () => mergeBonuses(mergedBonuses, dynamicBonuses),
    [mergedBonuses, dynamicBonuses]
  );
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, finalBonuses, runContext);

  // Mid-run extraContinues grants (Insurance Policy set bonus): when the
  // aggregated value rises past what this run was already paid, credit the
  // difference to the live counter (lib/extraContinues.ts has the rule and
  // the bug it fixes). A run start or a restored save re-baselines: the
  // mark goes back to null and the epoch makes the effect run even when the
  // value itself did not change.
  const extraContinuesSeen = useRef<ExtraContinuesMark>(null);
  const [extraContinuesEpoch, setExtraContinuesEpoch] = useState(0);
  useEffect(() => {
    const { credit, mark } = creditExtraContinues(extraContinuesSeen.current, activeModifiers.extraContinues);
    extraContinuesSeen.current = mark;
    if (credit > 0) {
      setContinuesRemaining(c => c + credit);
    }
  }, [activeModifiers.extraContinues, extraContinuesEpoch]);

  // Owned-tag tally for the build readout (HUD + shop chips).
  const tagCounts = useMemo(() => ownedTagCounts(ownedUpgradeIds, upgrades), [ownedUpgradeIds, upgrades]);
  const tagSetThreshold = tagSets?.threshold ?? DEFAULT_TAG_SET_THRESHOLD;

  // Per-source breakdown of what feeds activeModifiers, so the bottom-bar panel
  // can attribute each active modifier to the upgrade/cert/achievement/offer
  // that produced it.
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

    if (runOffer && offerBonuses) {
      sources.push({ kind: 'offer', id: runOffer.id, name: runOffer.name, modifiers: offerBonuses as Record<string, number> });
    }

    for (const s of activeTagSets) {
      sources.push({ kind: 'tagSet', id: s.tag, name: s.name, modifiers: s.modifiers });
    }

    if (capstone) {
      sources.push({ kind: 'capstone', id: capstone.id, name: capstone.name, modifiers: capstone.modifiers });
    }

    return sources;
  }, [ownedUpgradeIds, upgrades, certificates, certLevelsOwned, achievements, activatedAchievementIds, runOffer, offerBonuses, activeTagSets, capstone]);

  const certSourceIds = useMemo(
    () => new Set(certificates.map(c => c.sourceUpgradeId).filter((id): id is string => id != null)),
    [certificates]
  );

  /**
   * Clear every piece of run-scoped state. Shared by every run-reset path
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
    setRetainedAbilityIds([]);
    everHeldAbilityIdsRef.current = [];
    setCarrySpendFences(0);
    setCarrySpendFenceSpeed(0);
    setCarrySpendCapture(0);
    setCarryFreeShopItems(0);
    spentThisShopVisitRef.current = 0;
    setPendingSprint(null);
    setPendingChainPick(null);
    setCapstone(null);
    setPendingLevelScore(null);
    lastDeliveredCompletionRef.current = null;
    setRunStartIntroPending(true);
    setStoreClosed(false);
    setStoreInterestPaid(0);
    setShowLevelComplete(false);
    setCumulativeLockedBalls(0);
    setTakenOfferId(null);
    setLastRunSummary(null);
    setLastRunOfferUnlocks([]);
    runTrajectoryRef.current = [];
    recordEligibleRef.current = true;
    setLastRunRank(null);
    resetRunProgress();
  }, [resetRunProgress]);

  // Latest run snapshot, refreshed every render, so the save effect can fire
  // exactly once per map entry (keyed on the map-entry signals below) while the
  // payload always reflects the settled post-advance state. Reading from a ref
  // avoids re-saving on every mid-map life/score change.
  const runSnapshotRef = useRef<Omit<RunSave, 'version' | 'savedAt'> | null>(null);
  // Where between two maps the run stands, if it does (set further down, once
  // the between-map plan exists); merged into every save.
  const betweenMapsRef = useRef<BetweenMapsSave | null>(null);
  const currentRunSave = useCallback((): Omit<RunSave, 'version' | 'savedAt'> | null => {
    const snap = runSnapshotRef.current;
    if (!snap) return null;
    const between = betweenMapsRef.current;
    return between ? { ...snap, betweenMaps: between } : snap;
  }, []);
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
    capstoneId: capstone?.id ?? null,
    takenOfferId,
    runTrajectory: runTrajectoryRef.current,
    recordEligible: recordEligibleRef.current,
    dailyKey,
    abilityCharges,
    heldAbilityIds: everHeldAbilityIdsRef.current,
    retainedAbilityIds,
  };

  // Persist the run whenever a new map begins (map advance or a Continue-revive
  // remount). Keyed only on the map-entry signals; the payload is read from the
  // ref so this writes once per map, not on every in-map state change.
  useEffect(() => {
    if (nav.currentScreen !== 'game') return;
    const snap = currentRunSave();
    if (!snap || snap.levelSequenceIds.length === 0) return;
    if (pairRunRef.current) return; // the pair keeps its own save
    saveRun(snap);
  }, [nav.currentScreen, currentLevelIndex, gameInstanceKey, saveRun, currentRunSave]);

  /**
   * Also persist when the page is hidden or torn down, and when the error
   * boundary catches a crash.
   *
   * Per-map writes are the right granularity for the map, but they leave
   * everything BETWEEN maps unsaved: upgrades bought, a draft taken. On a phone that window is very reachable - clear a
   * map, open the shop, get distracted, the OS reclaims the tab - and you come
   * back to the map's start with the purchases gone, having paid for them.
   */
  useEffect(() => {
    registerRunFlush(() => {
      const snap = currentRunSave();
      if (!snap || snap.levelSequenceIds.length === 0) return;
      if (pairRunRef.current) return; // the pair keeps its own save
      saveRun(snap);
    });
    const uninstall = installRunFlushListeners();
    return () => { uninstall(); registerRunFlush(null); };
  }, [saveRun, currentRunSave]);

  /** Leave any seeded-run context: normal runs roll Math.random again. */
  const clearDailyMode = useCallback(() => {
    setRunSeedText(null);
    dailyKeyRef.current = null;
    setDailyKey(null);
  }, []);

  /**
   * Deal the Sprint Planning cards. Shared by every run-start path.
   *
   * Tenure (issue #75) rides in the boon slot when the previous run earned it.
   * It used to be a screen of its own before the loadout draft, and it fired
   * from New Game only at first: Play Again and Restart skipped it, so the
   * button right under the score of the run that had just earned a head start
   * was the one path that lost it. Every path comes through here now.
   *
   * Seeded runs pass `seeded`: the Daily deals from its seed and never offers
   * Tenure (a per-player head start would make one shared seed incomparable).
   */
  const dealSprint = useCallback((opts: { seeded: boolean }): DealtOffer[] => {
    let tenure: { chain: TenureOffer; earnedAtLevel: number; continued: boolean } | null = null;
    const tenureDepth = metaStats.lastRunDepth;
    if (!opts.seeded && tenureSteps(tenureDepth) > 0) {
      // getLoadedUpgrades(), not the `upgrades` state: on the New Game path this
      // closure was created before loadUpgrades() ran, so the state read here
      // would be stale. The depth sets how much is granted; lastRunShopLevel
      // limits what may be granted to what the run could actually have bought.
      // The first offer is the one guaranteed to continue the last run's build.
      const chain = rollTenureOffers(getLoadedUpgrades(), tenureDepth, Math.random,
        TENURE_OFFER_COUNT, lastRunUpgradeIds, metaStats.lastRunShopLevel)[0];
      if (chain) tenure = { chain, earnedAtLevel: tenureDepth, continued: isContinuation(chain, lastRunUpgradeIds) };
    }
    return rollSprintDeal({
      catalogue: getOfferCatalogue(),
      upgrades: getLoadedUpgrades(),
      unlock: { highestLevelReached: metaStats.highestLevelReached, metArchetypes },
      rng: opts.seeded ? getRunRng('sprint') : Math.random,
      tenure,
      force: { offerId: getForcedSprintOffer(), jackpot: getForcedJackpot() },
    });
  }, [metaStats.lastRunDepth, metaStats.lastRunShopLevel, metaStats.highestLevelReached, lastRunUpgradeIds, metArchetypes]);

  /**
   * The last step of starting a run: Sprint Planning when it is unlocked (or
   * Tenure is owed, which is the boon card), otherwise straight into the map.
   * `wantsDraft` is false for the debug jump and a pair run (both phones must
   * start from the same state, and the host's run is the one that counts).
   */
  const enterRun = useCallback((wantsDraft: boolean, opts: { seeded?: boolean } = {}) => {
    const seeded = opts.seeded ?? false;
    const tenureOwed = !seeded && tenureSteps(metaStats.lastRunDepth) > 0;
    const draftOn = SPRINT_PLANNING_ENABLED && wantsDraft && (sprintUnlocked || tenureOwed || isSprintAlwaysOn());
    const cards = draftOn ? dealSprint({ seeded }) : [];
    if (cards.length > 0) {
      setPendingSprint({ cards });
      nav.goToRunDraft();
    } else nav.startGame();
  }, [metaStats.lastRunDepth, sprintUnlocked, dealSprint, nav.goToRunDraft, nav.startGame]);

  const handleStartGame = useCallback(async (forceLevel?: number, skipDraft?: boolean, runSeed?: string) => {
    // Whose run this is, decided first (see pairRunRef).
    pairRunRef.current = pairStartPendingRef.current;
    pairStartPendingRef.current = false;
    // A normal run must never inherit a previous daily's seed: disarm BEFORE
    // loading, because loadLevels() already rolls the level lineup.
    clearDailyMode();
    // A pair run brings its own seed, and must keep it. Both phones deal the
    // board, the spawns and every roll during play from it; cleared here, each
    // phone fell back to Math.random and the two boards split at the first roll.
    if (runSeed) {
      setRunSeedText(runSeed);
    }
    // The offer catalogue backs the run-start draft, but a load failure
    // should not hard-gate starting a run.
    // Held across the WHOLE fetch, not just until the first pair land.
    setBootingRun(true);
    let levelsSuccess = false, upgradesSuccess = false;
    try {
      [levelsSuccess, upgradesSuccess] = await Promise.all([
        loadLevels(),
        loadUpgrades(),
        loadCertificates(),
        // Sprint Planning offers (offers.yml). Failure keeps the baked catalogue.
        loadOffers(),
        // Ball catalogue (balls.yml). Failure falls back to built-in defaults, so
        // it does not gate starting a run, same treatment as the offers.
        loadBallTypes(),
        loadAbilities(),
        // Fence types (fences.yml). Failure keeps the build-time catalogue.
        loadFenceTypes(),
        // Bug pool (bugs.yml), same deal: a failed fetch leaves the baked-in
        // catalogue standing rather than a board that quietly grows no bugs.
        loadBugs(),
        loadFeatures(),
        // Capstone pool (capstones.yml). Failure just skips the Promotion draft.
        loadCapstones(),
        // Map mutator pool (mapMutators.yml). Failure just plays maps unmutated.
        loadMapMutators(),
        // Map objective pool (objectives.yml). Failure just plays maps without a goal.
        loadMapObjectives(),
      ]);
    } finally {
      // finally, so a catalogue that rejects cannot leave the menu
      // spinning forever with no way back.
      setBootingRun(false);
    }

    if (levelsSuccess && upgradesSuccess) {
      resetRunScopedState();
      // New Game discards any prior save; the fresh run re-saves on its first
      // map. Not a pair's new game: the solo run parked before pairing stays.
      if (!pairRunRef.current) clearRun();

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
      // A fresh run: whatever extraContinues reads now is the baseline, not a grant.
      extraContinuesSeen.current = null;
      setExtraContinuesEpoch(e => e + 1);
      setPendingDeathResult(null);

      // Admin "Infinite lives" and live map tuning both make a run
      // unrepresentative in exactly the way the ?level= jump does, so they get
      // the same treatment: play it, but never let highscores / Employee of the
      // Month / Records learn from it.
      if (isInfiniteLivesEnabled() || hasAnyMapTuning() || debugMutatorId() || forcedTilts() || getForcedSprintOffer() || getForcedJackpot()) {
        recordEligibleRef.current = false;
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

      // The debug jump and a pair run go straight into the map (see enterRun).
      enterRun(!skipDraft && !pairRunRef.current);
    }
  }, [loadLevels, loadUpgrades, loadCertificates, setLevelIndex, resetToFirstLevel, resetRunScopedState, clearRun, clearDailyMode, enterRun]);

  /**
   * Daily Stand-up (HIGHSCORES.md Phase D): start today's seeded run. The seed
   * is armed BEFORE the catalogues load (loadLevels rolls the level lineup),
   * so every player on today's key is served the same variants, drafts, shops,
   * obstacles and pickups. Always starts at level 1 (no cert Head Start): it
   * is a shared run, and scores go on the daily ledger as well as the
   * all-time one.
   */
  const handleStartDaily = useCallback(async () => {
    // Whose run this is, decided first (see pairRunRef).
    pairRunRef.current = pairStartPendingRef.current;
    pairStartPendingRef.current = false;
    const key = todayKey();
    setRunSeedText(dailySeedText(key));
    dailyKeyRef.current = key;
    setDailyKey(key);

    // Held across the WHOLE fetch, not just until the first pair land.
    setBootingRun(true);
    let levelsSuccess = false, upgradesSuccess = false;
    try {
      [levelsSuccess, upgradesSuccess] = await Promise.all([
        loadLevels(),
        loadUpgrades(),
        loadCertificates(),
        loadOffers(),
        loadBallTypes(),
        loadAbilities(),
        loadFenceTypes(),
        // Bug pool (bugs.yml), same deal: a failed fetch leaves the baked-in
        // catalogue standing rather than a board that quietly grows no bugs.
        loadBugs(),
        loadFeatures(),
        loadCapstones(),
        loadMapMutators(),
        loadMapObjectives(),
      ]);
    } finally {
      // finally, so a catalogue that rejects cannot leave the menu
      // spinning forever with no way back.
      setBootingRun(false);
    }
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
    // A fresh run: whatever extraContinues reads now is the baseline, not a grant.
    extraContinuesSeen.current = null;
    setExtraContinuesEpoch(e => e + 1);
    setPendingDeathResult(null);

    resetToFirstLevel(); // same seeded lineup for everyone, from level 1

    analytics.runStarted({ mode: 'daily', daily: true });

    // The Daily deals Sprint Planning from its seed, so everyone sees the same
    // three cards (the pick is theirs), and never offers Tenure. A pair run
    // skips the draft, as it does everywhere.
    enterRun(!pairRunRef.current, { seeded: true });
  }, [loadLevels, loadUpgrades, loadCertificates, resetRunScopedState, clearRun, resetToFirstLevel, clearDailyMode, enterRun]);

  /**
   * Resume a saved run from the welcome screen. Loads the catalogues (same as a
   * fresh start), then restores every run-scoped field from the save and drops
   * the player at the start of the map they were on. Capstones are
   * re-hydrated from the loaded pools by id; the exact level variants are
   * restored via restoreSequence so the resumed maps match what was saved.
   */
  /**
   * Resume a run from a record, whoever is holding it.
   *
   * Split out of handleContinueRun so a PAIR can resume too
   * (TWO_PLAYER_PLAN.md step 6b): a pair save lives under its own key, and on
   * the guest's phone it arrives over the wire rather than out of storage, so
   * "read the solo save and resume it" is the one thing it cannot do. Same
   * path otherwise, down to the seed being armed before the loads.
   */
  /**
   * Put the run into exactly the state a record describes.
   *
   * Split out of resumeRunFrom so a PAIR can do it at the start of EVERY map
   * (TWO_PLAYER_PLAN.md step 6). The host owns the run; whatever the guest's
   * own copy of the shop, the drafts or the score did between maps is
   * overwritten by the host's, because two devices computing their own
   * modifiers is two different games sharing a seed, and the difference shows
   * up as physics rather than as a number on a screen.
   *
   * Everything here is state-setting. The catalogue loads and the navigation
   * stay with the callers, because a mid-run sync needs neither: the
   * catalogues are already in memory and the guest is already on the board.
   */
  const applyRunRecord = useCallback((save: RunSave) => {
    setTotalScore(save.totalScore);
    // Through the alias map: a checkpoint written before two upgrades were
    // merged still names the retired ids, and dropping them would silently
    // strip effects the player had already bought.
    setOwnedUpgradeIds(liveUpgradeIds(save.ownedUpgradeIds));
    setCurrentLives(save.currentLives);
    setLivesAtLevelStart(save.livesAtLevelStart);
    setContinuesRemaining(save.continuesRemaining);
    // The save's count already includes every Continue its upgrades granted;
    // restoring those upgrades must not credit them a second time.
    extraContinuesSeen.current = null;
    setExtraContinuesEpoch(e => e + 1);
    setCumulativeLockedBalls(save.cumulativeLockedBalls);
    setCarryInstantFences(save.carryInstantFences);
    setAbilityCharges(save.abilityCharges ?? {});
    setRetainedAbilityIds(save.retainedAbilityIds ?? []);
    // A run saved before `heldAbilityIds` existed has no record, so seed from
    // the charges it is carrying: what you hold is proof you earned it.
    everHeldAbilityIdsRef.current = heldAbilityIds(save.abilityCharges ?? {}, save.heldAbilityIds ?? []);
    setCarrySpendFences(save.carrySpendFences);
    setCarrySpendFenceSpeed(save.carrySpendFenceSpeed);
    setCarrySpendCapture(save.carrySpendCapture ?? 0);
    setCarryFreeShopItems(save.carryFreeShopItems ?? 0);
    spentThisShopVisitRef.current = 0;
    // Saves written before Sprint Planning carry `draftedLoadoutIds` instead,
    // ids the offers catalogue does not know: they resume with no offer.
    setTakenOfferId(save.takenOfferId ?? null);
    setCapstone(save.capstoneId ? getCapstones().find(c => c.id === save.capstoneId) ?? null : null);

    // Resuming mid-run: the short boot, no leftover overlays/offers.
    setRunStartIntroPending(false);
    setStoreClosed(false);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setPendingDeathResult(null);
    lastDeliveredCompletionRef.current = null;

    // Records: the resumed run keeps its trajectory and eligibility (saves
    // written before Phase A default to eligible with an empty trajectory).
    runTrajectoryRef.current = save.runTrajectory ?? [];
    recordEligibleRef.current = save.recordEligible ?? true;
    setLastRunRank(null);

    restoreRunProgress(save.runLevelsCompleted);
    restoreSequence(save.levelSequenceIds, save.currentLevelIndex);
  }, [restoreRunProgress, restoreSequence]);

  const resumeRunFrom = useCallback(async (save: RunSave, runSeed?: string) => {
    // Whose run this is, decided first (see pairRunRef).
    pairRunRef.current = pairStartPendingRef.current;
    pairStartPendingRef.current = false;

    // Restore the run's seeded context (or lack of it) BEFORE loading: the
    // shops/drafts/pickups ahead must keep rolling from the daily seed. A pair
    // run passes its own seed, for the same reason as handleStartGame.
    const savedDaily = save.dailyKey ?? null;
    setRunSeedText(runSeed ?? (savedDaily ? dailySeedText(savedDaily) : null));
    dailyKeyRef.current = savedDaily;
    setDailyKey(savedDaily);

    // Held across the WHOLE fetch, not just until the first pair land.
    setBootingRun(true);
    let levelsSuccess = false, upgradesSuccess = false;
    try {
      [levelsSuccess, upgradesSuccess] = await Promise.all([
        loadLevels(),
        loadUpgrades(),
        loadCertificates(),
        loadOffers(),
        loadBallTypes(),
        loadAbilities(),
        loadFenceTypes(),
        // Bug pool (bugs.yml), same deal: a failed fetch leaves the baked-in
        // catalogue standing rather than a board that quietly grows no bugs.
        loadBugs(),
        loadFeatures(),
        loadCapstones(),
        loadMapMutators(),
        loadMapObjectives(),
      ]);
    } finally {
      // finally, so a catalogue that rejects cannot leave the menu
      // spinning forever with no way back.
      setBootingRun(false);
    }
    if (!levelsSuccess || !upgradesSuccess) return;

    applyRunRecord(save);
    analytics.runStarted({ mode: 'resume', daily: savedDaily !== null });
    if (save.betweenMaps) {
      // Saved after the map was won: back to the stage it was saved on, with
      // the map's results the store reads, once the sequence has settled.
      setPendingLevelScore(save.betweenMaps.levelScore);
      setResumeBetween({ at: save.currentLevelIndex, between: save.betweenMaps });
    } else {
      nav.goToGame();
    }
  }, [loadLevels, loadUpgrades, loadCertificates, applyRunRecord, nav.goToGame]);


  const handleContinueRun = useCallback(async () => {
    const save = readRun();
    if (!save) return;
    await resumeRunFrom(save);
  }, [readRun, resumeRunFrom]);

  // End-of-run build recap: name the build from its archetype lean.
  const captureRunRecap = useCallback(() => {
    const identity = computeBuildIdentity(tagCounts);
    setLastRunRecap({
      ...identity,
      tagCounts: Object.fromEntries(tagCounts),
      capstoneId: capstone?.id ?? null,
      capstoneName: capstone?.name ?? null,
    });
  }, [tagCounts, capstone]);

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
      primaryTag: identity.primary,
      secondaryTag: identity.secondary,
      capstoneId: capstone?.id ?? null,
      capstoneName: capstone?.name ?? null,
      loadoutIds: takenOfferId ? [takenOfferId] : [],
      savedAt: Date.now(),
    }, trajectory, dailyKeyRef.current);
    setLastRunRank({ ...info, aheadThroughMaps: epitaph });
  }, [bestRunTrajectory, bestScore, tagCounts, capstone, takenOfferId, recordRun]);

  const finalizeAndShowResult = useCallback((result: GameResult) => {
    const levelsCompleted = runLevelsCompleted;
    analytics.runEnded({
      isWin: result.isWin,
      levelsCompleted,
      totalScore,
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
    captureRunRecap();
    fileRunOnLedger(totalScore);
    // The run is over: no Continue on the welcome screen. A pair run never
    // held that slot, and the solo run parked in it is not the one that ended.
    if (!pairRunRef.current) clearRun();
    nav.endGame({ ...result, totalScore });
  }, [nav.endGame, totalScore, finalizeRun, runLevelsCompleted, activeModifiers.extraCertificateHours, captureRunRecap, fileRunOnLedger, clearRun, recordRunEnded, recordRunUpgrades, ownedUpgradeIds, currentLevelIndex]);

  /**
   * The last map is won: the run is over, as a win. Banked and filed through
   * the same path a loss takes (Tenure, certificate hours, the ledger), with
   * the final map's results on the result screen.
   */
  const handleFinishRun = useCallback(() => {
    finalizeAndShowResult({
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
    });
    setPendingLevelScore(null);
  }, [finalizeAndShowResult, pendingLevelScore, currentLevel, currentLevelIndex, totalScore]);

  /**
   * Hand over upgrades the run did not buy (a Tenure chain, a gamble's prize),
   * with any life they carry, which a purchase would have added too.
   *
   * A chain is granted WHOLE, not just its top tier, because upgrade modifiers
   * compound: handing over only the Principal would make the 30-level Tenure
   * reward weaker than the 20-level one.
   */
  const grantUpgrades = useCallback((granted: readonly UpgradeConfig[], extraLives = 0) => {
    const ids = granted.map(u => u.id);
    setOwnedUpgradeIds(prev => [...prev, ...ids.filter(id => !prev.includes(id))]);
    if (extraLives !== 0) {
      setCurrentLives(l => Math.max(1, l + extraLives));
      setLivesAtLevelStart(l => Math.max(1, l + extraLives));
    }
  }, []);

  /**
   * Sprint Planning confirmed: take card `index` (null on skip). The pick
   * applies once (lives, banked hours, granted upgrades); the offer's modifiers
   * then ride the modifier pipeline for as long as they last. A prize that is a
   * choice goes to the chain pick before the map.
   */
  const handleSprintPick = useCallback((index: number | null) => {
    const card = index === null ? null : pendingSprint?.cards[index] ?? null;
    setPendingSprint(null);
    analytics.offerSelected({
      offerId: card?.offer.id ?? null,
      pool: card?.offer.pool ?? null,
      grantedIds: card?.grants.map(u => u.id) ?? [],
    });
    if (!card) {
      setTakenOfferId(null);
      nav.startGame();
      return;
    }
    setTakenOfferId(card.offer.id);
    grantUpgrades(card.grants, pickLivesDelta(card.offer, card.grants));
    if (card.offer.overtime) setTotalScore(t => t + card.offer.overtime!);
    if (card.choices && card.choices.length > 0) {
      setPendingChainPick({ offerId: card.offer.id, choices: card.choices });
      nav.goToChainPick();
      return;
    }
    nav.startGame();
  }, [pendingSprint, grantUpgrades, nav.goToChainPick, nav.startGame]);

  /** The chain picked for a choose prize (Pick a Junior, Headhunted). */
  const handleChainPick = useCallback((headId: string) => {
    const pick = pendingChainPick?.choices.find(c => c.headId === headId);
    if (pick) grantUpgrades(pick.upgrades, pick.upgrades.reduce((n, u) => n + (typeof u.modifiers?.extraLives === 'number' ? u.modifiers.extraLives : 0), 0));
    setPendingChainPick(null);
    nav.startGame();
  }, [pendingChainPick, grantUpgrades, nav.startGame]);

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
    }
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost]);

  // A smashed chest granted one charge of an ability (issue #38): bank it
  // run-wide so it persists into every later map this run.
  const handleGrantAbility = useCallback((abilityId: string) => {
    // Remember it was EARNED, separately from the stack: spending the last
    // charge must not make a replenishing ability stop replenishing.
    if (!everHeldAbilityIdsRef.current.includes(abilityId)) {
      everHeldAbilityIdsRef.current = [...everHeldAbilityIdsRef.current, abilityId];
    }
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
    // whatever screen came next - re-running the shop phase and showing
    // a second Promotion draft. The ref resets with each new run.
    if (lastDeliveredCompletionRef.current === currentLevelNum) return;
    lastDeliveredCompletionRef.current = currentLevelNum;
    setRunStartIntroPending(false); // the run is underway: later maps get the short boot
    // The onboarding map (first run only) has served its purpose the moment it
    // is cleared: every later run opens on the real level-1 map instead.
    if (isOnboardingMap(currentLevel)) markOnboardingSeen();
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    incrementRunLevel(1);

    // Loyalty bonus: completing level FREE_CONTINUE_LEVEL awards a free
    // Continue (runs start with none; the dedupe ref above keeps this to one
    // grant per run).
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
      pushBonusesBanked: metaStats.pushBonusesBanked + (bankedPush ? 1 : 0),
      // Only written when a run ENDS, so these are carried through unchanged.
      lastRunDepth: metaStats.lastRunDepth,
      lastRunShopLevel: metaStats.lastRunShopLevel,
    };
    checkAndCompleteAchievements(projectedStats);

    // Feature unlocks (features.ts): completing certain levels reveals a new
    // system. Level 5 unlocks achievements. armFeatureUnlock queues the
    // "Feature Unlocked" modal (surfaced when leaving the level-complete
    // overlay). (Certificates unlock on an event, not a level - see
    // handleCertificateHourEarned.)
    for (const feature of featuresUnlockedAtLevel(currentLevelNum)) {
      armFeatureUnlock(feature.id);
    }

    const levelOvertime = scoreData.levelScore;

    analytics.levelCompleted({
      level: currentLevelNum,
      overtime: levelOvertime,
      perfect: currentLives >= livesAtLevelStart,
      daily: dailyKeyRef.current !== null,
    });


    // Extend this run's trajectory (the ledger stores it, and the result
    // screen's "ahead through N maps" epitaph reads it).
    const cumulative = totalScore + levelOvertime;
    runTrajectoryRef.current = [...runTrajectoryRef.current, cumulative];

    // Functional, not `totalScore + levelOvertime`. Every other writer of this
    // state already is (a purchase), and a
    // plain read-then-write here would silently discard anything that landed in
    // the same React batch. The wallet is the one number a player counts.
    setTotalScore(prev => prev + levelOvertime);
    setPendingLevelScore({
      ...scoreData, tierMultiplier: 1,
    });
    setShowLevelComplete(true);

    if (scoreData.lockedBallsCount && scoreData.lockedBallsCount > 0) {
      setCumulativeLockedBalls(prev => prev + scoreData.lockedBallsCount!);
    }

    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, currentLevel, markOnboardingSeen, recordLevelReached, recordFencesDrawn, recordPerfectLevel, recordPushBonusBanked, currentLives, livesAtLevelStart, incrementRunLevel, activeModifiers.underParInstantFence, checkAndCompleteAchievements, metaStats, isLastLevel, armFeatureUnlock]);

  /**
   * Post-shop bookkeeping shared by the shop's Continue button and the
   * lock-gated skip: save the level-picker checkpoint on 5th levels, surface
   * any pending cert unlocks, clear the pending score, then advance and play.
   * `bankedThisTick` is hours added to the bank in the same handler (the
   * store's interest on a skipped visit), which `totalScore` cannot see yet.
   */
  const finishShopPhase = useCallback((bankedThisTick = 0) => {
    const nextLevelNumber = currentLevelIndex + 2;
    if (nextLevelNumber % 5 === 0) {
      saveRunCheckpoint({ level: nextLevelNumber, totalScore: totalScore + bankedThisTick, ownedUpgradeIds, lives: currentLives, savedAt: Date.now() });
    }
    const pendingUnlocks = takePendingUnlocks();
    if (pendingUnlocks.length > 0) setPendingCertUnlocks(pendingUnlocks);
    setShopUnlockedCerts([]);
    setPendingLevelScore(null);
    setStoreDealt(null);
    advanceToNextLevel();
    nav.goToGame();
  }, [currentLevelIndex, saveRunCheckpoint, totalScore, ownedUpgradeIds, currentLives, takePendingUnlocks, advanceToNextLevel, nav.goToGame]);

  /**
   * Open this level's shop (or skip past it), the ordinary end of an ordinary
   * level.
   *
   * Extracted because the Promotion draft now sits in FRONT of it: the perk
   * changes what is worth buying, so it has to be picked first, and both routes
   * have to land in the same place afterwards.
   */
  // Destructured rather than reached through `nav` inside the callback. The
  // navigation functions are useCallback(..., []) and so permanently stable,
  // but `nav` itself is a fresh object every render, and a dep array listing
  // `nav.goToX` is a member expression the exhaustive-deps rule cannot verify.
  // Pulling them out satisfies the rule with no extra re-creation, and CI
  // lints with --max-warnings, so a new warning is a broken build rather than
  // a note.
  const { goToUpgradeShop, goToCapstoneDraft, goToGame } = nav;

  /**
   * Everything that happens on arriving at the store, whether or not the
   * player then looks at the shelf: the lock toll decides open or closed, the
   * bank's interest is paid, and a free ability arrives. A skipped store is an
   * arrival with nothing bought, so it keeps the interest and the ability; it
   * would be a strange perk that paid only those who window-shop. Returns the
   * interest, which the bank shows only on the next render.
   */
  const arriveAtStore = useCallback((): number => {
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
    const closed = locksThisRound < locksRequired;
    setStoreDealt(null); // a new visit: the shelf is dealt fresh
    setStoreClosed(closed);
    // Procurement (Sprint Planning): interest on the bank, on arrival. Paid
    // closed or open: it is the bank's, not the shelf's.
    const interest = storeInterest(totalScore, activeModifiers.shopInterestPercent);
    if (interest > 0) setTotalScore(t => t + interest);
    setStoreInterestPaid(interest);
    setStoreLockProgress({ have: locksThisRound, need: locksRequired });

    // Open Source Contribution: the ability slot is gone from the shelf, and a
    // random ability arrives free on every visit instead. A CLOSED store grants
    // nothing - closed is closed, and a free ability every time you fail the
    // lock toll would be the cheapest way to stop locking.
    if (!closed && (activeModifiers.freeAbilityPerStore ?? 0) > 0) {
      const held = heldAbilityIds(abilityCharges, everHeldAbilityIdsRef.current);
      const rolled = rollCappedAbilityReward(
        undefined,
        currentLevelIndex + 1,
        getRunRng(`shop:${currentLevelIndex + 1}:freeAbility`),
        held,
        MAX_ABILITY_SLOTS,
      );
      if (rolled) {
        setAbilityCharges(prev => ({ ...prev, [rolled]: (prev[rolled] ?? 0) + 1 }));
        everHeldAbilityIdsRef.current = heldAbilityIds({ [rolled]: 1 }, everHeldAbilityIdsRef.current);
        setFreeAbilityGrant(rolled);
      }
    } else {
      setFreeAbilityGrant(null);
    }
    return interest;
  }, [pendingLevelScore, currentLevel, activeModifiers.storeLockRelief, activeModifiers.freeAbilityPerStore, activeModifiers.shopInterestPercent, totalScore, abilityCharges, currentLevelIndex]);

  const proceedToShop = useCallback(() => {
    arriveAtStore();
    goToUpgradeShop();
  }, [arriveAtStore, goToUpgradeShop]);

  /**
   * The Promotion, on a level of its own.
   *
   * Offered after an ORDINARY level and before that level's shop, rather than
   * spliced into the (since removed) assignment phase, where it used to arrive
   * fourth in a queue of five reward screens. Returns true when it took the wheel.
   */
  const offerCapstoneIfDue = useCallback((): boolean => {
    if (capstone) return false;
    const pool = getCapstones();
    if (pool.length === 0) return false;
    if (!capstoneDueAfter(currentLevelIndex + 1)) return false;
    setCapstoneOffers(drawCapstoneOffers(pool, CAPSTONE_OFFER_COUNT, getRunRng(`capstones:${currentLevelIndex + 1}`)));
    goToCapstoneDraft();
    return true;
  }, [capstone, currentLevelIndex, goToCapstoneDraft]);

  /**
   * What stands between the map just won and the next (UI_REDO_PLAN.md, the
   * between-map pipeline): whether a Promotion is due, whether the store
   * opens, whether this was the last map. Debrief, Promotion and Store each
   * draw every stage in one strip, so all three must agree.
   *
   * Live while the debrief is up, then frozen: picking the Promotion sets
   * `capstone`, and a live plan would drop the Promotion stage from the strip
   * on the very next screen, which is the store the player reached through it.
   */
  const liveBetweenMapPlan = useMemo<BetweenMapPlan>(() => ({
    clearedLevel: currentLevelIndex + 1,
    promotion: !capstone && getCapstones().length > 0 && capstoneDueAfter(currentLevelIndex + 1),
    store: true,
    last: isLastLevel,
  }), [currentLevelIndex, capstone, isLastLevel]);
  const [frozenBetweenMapPlan, setFrozenBetweenMapPlan] = useState<BetweenMapPlan | null>(null);
  useEffect(() => {
    if (showLevelComplete) {
      setFrozenBetweenMapPlan(liveBetweenMapPlan);
    }
  }, [showLevelComplete, liveBetweenMapPlan]);
  const betweenMapPlan = showLevelComplete ? liveBetweenMapPlan : (frozenBetweenMapPlan ?? liveBetweenMapPlan);

  /**
   * Save after every finished map, and at each stage after it.
   *
   * "Always make a save after a finished map, so that if you close the game in
   * the store view, that is where you continue next." The map-start save alone
   * left everything between maps to the page-hide flush, which wrote the
   * finished map's index with its hours already banked, so a resume replayed
   * the map it had just paid for. Now the save says it is between maps and
   * which stage, with what that stage dealt (the Promotion's offers, the
   * store's shelf), and a resume goes back to it.
   */
  const betweenStage: BetweenMapsSave['stage'] | null = !pendingLevelScore ? null
    : nav.currentScreen === 'upgradeShop' ? 'store'
    : nav.currentScreen === 'capstoneDraft' ? 'promotion'
    : showLevelComplete ? 'debrief'
    : null;
  betweenMapsRef.current = betweenStage && pendingLevelScore ? {
    stage: betweenStage,
    levelScore: pendingLevelScore,
    plan: betweenMapPlan,
    capstoneOfferIds: betweenStage === 'promotion' ? capstoneOffers.map(c => c.id) : undefined,
    store: betweenStage === 'store'
      ? { closed: storeClosed, lockProgress: storeLockProgress, freeAbilityGrant, dealt: storeDealt }
      : undefined,
  } : null;
  useEffect(() => {
    if (!betweenStage) return;
    if (pairRunRef.current) return; // the pair keeps its own save
    const snap = currentRunSave();
    if (!snap || snap.levelSequenceIds.length === 0) return;
    saveRun(snap);
  }, [betweenStage, storeDealt, capstoneOffers, saveRun, currentRunSave]);

  /** Closing the map's card, whichever way the player goes on from it. */
  const leaveDebrief = useCallback(() => {
    setShowLevelComplete(false);
    setPendingCertUnlocks([]);
    // Features unlocked this round; show the first "Feature Unlocked" modal now
    // (it overlays whatever screen we navigate to next). Dismissing advances the
    // queue, so multiple unlocks (e.g. achievements + certificates at level 5)
    // show one after another.
    if (pendingFeatureUnlocksRef.current.length > 0) {
      setUnlockedFeature(pendingFeatureUnlocksRef.current.shift()!);
    }
  }, []);

  const handleContinueFromOverlay = useCallback(() => {
    leaveDebrief();
    if (isLastLevel) {
      // Beat the final level: the run is won, and that is the end of it.
      handleFinishRun();
    } else if (!offerCapstoneIfDue()) {
      proceedToShop();
    }
  }, [leaveDebrief, isLastLevel, offerCapstoneIfDue, proceedToShop, handleFinishRun]);

  /**
   * A run saved between maps, routed back to the stage it was saved on once
   * its level sequence has settled (restoreSequence lands a render later). The
   * store reopens as it was dealt, with its toll and its free grant as they
   * stood, and never rolls a second free ability; the Promotion reopens on the
   * same three offers. A save from the map's card goes on to whatever comes
   * after the card, exactly as its Continue would have.
   */
  useEffect(() => {
    if (!resumeBetween || !pendingLevelScore) return;
    if (levels.length === 0 || currentLevelIndex !== resumeBetween.at) return;
    const { between } = resumeBetween;
    setResumeBetween(null);
    // The map is banked: no stale completion may score it again.
    lastDeliveredCompletionRef.current = resumeBetween.at + 1;
    if (between.plan) setFrozenBetweenMapPlan(between.plan);
    if (between.stage === 'store' && between.store) {
      setStoreClosed(between.store.closed);
      setStoreLockProgress(between.store.lockProgress);
      setFreeAbilityGrant(between.store.freeAbilityGrant);
      setStoreDealt(between.store.dealt);
      setStoreInterestPaid(0); // paid on the original arrival, already in the bank
      goToUpgradeShop();
      return;
    }
    if (between.stage === 'promotion' && between.capstoneOfferIds?.length) {
      const pool = getCapstones();
      const offers = between.capstoneOfferIds.flatMap(id => pool.filter(c => c.id === id));
      if (offers.length > 0) {
        setCapstoneOffers(offers);
        goToCapstoneDraft();
        return;
      }
    }
    if (isLastLevel) handleFinishRun();
    else if (!offerCapstoneIfDue()) proceedToShop();
  }, [resumeBetween, pendingLevelScore, levels.length, currentLevelIndex, isLastLevel, offerCapstoneIfDue, proceedToShop, goToUpgradeShop, goToCapstoneDraft, handleFinishRun]);

  const handleDismissFeatureUnlocked = useCallback(() => {
    // Advance to the next queued unlock, or close if none remain.
    setUnlockedFeature(pendingFeatureUnlocksRef.current.shift() ?? null);
  }, []);

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

  /**
   * Buy an ability retainer from the store's ability slot.
   *
   * Separate from handlePurchaseUpgrade because the two buy different kinds of
   * thing: this one spends hours and grants an ABILITY, recorded as held (so
   * it counts against the slot cap exactly like a chest-won one) and as
   * retained (so it comes back every map). It deliberately does not touch
   * ownedUpgradeIds, so nothing downstream mistakes it for an upgrade.
   */
  const handlePurchaseAbility = useCallback((abilityId: string, price: number) => {
    setTotalScore(prev => prev - price);
    spentThisShopVisitRef.current += price;
    setRetainedAbilityIds(prev => prev.includes(abilityId) ? prev : [...prev, abilityId]);
    // The first charge arrives now rather than at the next map start, so the
    // purchase is visible in the bar the moment the shop closes.
    setAbilityCharges(prev => ({ ...prev, [abilityId]: Math.max(1, prev[abilityId] ?? 0) }));
    everHeldAbilityIdsRef.current = heldAbilityIds({ [abilityId]: 1 }, everHeldAbilityIdsRef.current);
  }, []);

  /**
   * Out of the store and on to the next map. `sawShelf` is false for a store
   * skipped from the map's card: nothing was bought, and a free-item voucher
   * is kept, since the free offer it pays for was never on screen.
   */
  const leaveStore = useCallback((sawShelf: boolean, bankedThisTick = 0) => {
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
    if (sawShelf && !storeClosed && carryFreeShopItems > 0) {
      setCarryFreeShopItems(n => Math.max(0, n - 1));
    }

    finishShopPhase(bankedThisTick);
  }, [currentLevelIndex, activeModifiers, finishShopPhase, storeClosed, carryFreeShopItems]);

  const handleContinueFromShop = useCallback(() => {
    leaveStore(true);
  }, [leaveStore]);

  /**
   * The map's card, straight on to the next map: the store is optional.
   *
   * Only offered when the store is the next stage (the card hides the button
   * otherwise); should it be reached anyway, a due Promotion or the run's end
   * still comes first, exactly as Continue would have it.
   */
  const handleSkipStoreFromOverlay = useCallback(() => {
    leaveDebrief();
    if (isLastLevel) {
      handleFinishRun();
      return;
    }
    if (offerCapstoneIfDue()) {
      return;
    }
    const interest = arriveAtStore();
    leaveStore(false, interest);
  }, [leaveDebrief, isLastLevel, handleFinishRun, offerCapstoneIfDue, arriveAtStore, leaveStore]);

  /** Capstone draft pick: permanent for the run, then on to the shop. */
  const handleSelectCapstone = useCallback((pick: CapstoneConfig) => {
    analytics.capstoneSelected({ capstoneId: pick.id });
    setCapstone(pick);
    // Into this level's shop. The draft interrupted an ordinary level, so the
    // level has to finish the ordinary way - and the perk is now in hand while
    // the player decides what to buy.
    proceedToShop();
  }, [proceedToShop]);

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
    // A fresh run: whatever extraContinues reads now is the baseline, not a grant.
    extraContinuesSeen.current = null;
    setExtraContinuesEpoch(e => e + 1);
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

    enterRun(true);
  }, [resetToFirstLevel, setLevelIndex, resetRunScopedState, clearRunCheckpoints, clearDailyMode, enterRun]);

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
    // A fresh run: whatever extraContinues reads now is the baseline, not a grant.
    extraContinuesSeen.current = null;
    setExtraContinuesEpoch(e => e + 1);
    setPendingDeathResult(null);

    resetToFirstLevel();
    enterRun(true);
  }, [resetToFirstLevel, resetRunScopedState, clearRunCheckpoints, clearDailyMode, enterRun]);

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

  const handleOpenOffers = useCallback(async () => {
    // Fresh YAML when entering from the welcome screen (the baked one is there regardless).
    await loadOffers();
    nav.goToOffers();
  }, [nav.goToOffers]);

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
    // Abort the run in progress too. The reload inside performTotalReset would
    // normally take care of this, but it is not guaranteed to happen (a
    // Capacitor webview or a host that blocks reload), and a reset that leaves
    // the player mid-map with their progression deleted underneath them is
    // worse than either outcome on its own. Doing it here also means the
    // in-memory state is already clean if the reload never lands.
    clearRun();
    resetRunScopedState();
    nav.goToWelcome();
    performTotalReset();
  }, [resetCertData, resetProgression, clearRun, resetRunScopedState, nav.goToWelcome]);

  // Load the ball catalogue (balls.yml) once on mount so the Tutorial reflects
  // edits even before a run starts. handleStartGame reloads it per run.
  useEffect(() => { loadBallTypes(); loadAbilities(); loadFenceTypes(); loadBugs(); }, []);

  // Replenishing abilities (abilities.yml `replenishTo`, today just Shockwave):
  // every map opens topped up to the authored floor for anything the player has
  // EARNED this run. Keyed on the level index so it re-tops each new map;
  // idempotent and never lowers a bigger stack, so chest-earned charges pile on
  // top rather than being trimmed back.
  //
  // The trigger is HAVING the ability, not the level-10 'panicShockwave'
  // feature. That feature did the same job but was armed by beating the first
  // boss, while Shockwave itself drops from chests at level 4 - so a player who
  // found it early spent their charge, watched it not return for five maps, and
  // reasonably concluded it did not replenish. The feature is still honoured, so
  // a player who reached level 10 without ever finding one still gets it.
  useEffect(() => {
    setAbilityCharges(prev => replenishAbilityCharges(
      prev,
      heldAbilityIds(prev, everHeldAbilityIdsRef.current),
      getAllAbilities(),
      isFeatureUnlocked('panicShockwave') ? ['shockwave'] : [],
      retainedAbilityIds,
    ));
  }, [currentLevelIndex, isFeatureUnlocked, setAbilityCharges, retainedAbilityIds]);

  // Sync completed achievements into cert manager for achievement-locked certs
  useEffect(() => {
    if (completedAchievementIds.length > 0) {
      checkAchievementUnlocks(completedAchievementIds);
    }
  }, [completedAchievementIds, checkAchievementUnlocks]);

  // Auto-start when a ?level= debug jump is present.
  const levelQueryHandled = useRef(false);
  useEffect(() => {
    if (levelQueryHandled.current) return;
    const levelParam = new URLSearchParams(window.location.search).get('level');
    const wantsJump = levelParam != null && parseInt(levelParam, 10) > 0;
    if (wantsJump) {
      levelQueryHandled.current = true;
      handleStartGame(undefined, true); // debug jump skips the loadout draft
    }
  }, [handleStartGame]);

  return {
    // Sprint Planning (with Tenure as its boon card, issue #75)
    pendingSprint,
    handleSprintPick,
    pendingChainPick,
    handleChainPick,
    runOffer,
    shopLean,
    sprintUnlocked,
    menuDataReady,
    metArchetypes,
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
    fenceSlotIds,
    showLevelComplete,
    betweenMapPlan,
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
    shouldShowDaily,
    shouldShowTimeLimit,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
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
    encounteredBallTypeIds,
    recordBallTypeEncountered,
    runHoursAwarded,
    runLevelsCompleted,
    lastRunHoursAwarded: lastRunSummary?.hoursAwarded ?? 0,
    lastRunLevelsCompleted: lastRunSummary?.levelsCompleted ?? 0,
    lastRunOfferUnlocks,
    lastRunRecap,
    // Head Start certificates: the level a fresh run begins at (1 = none).
    // The result screen uses it to label Play Again as "Continue from level N".
    certStartingLevel: getCertStartingLevel(),
    /** What build scaling is paying right now, per upgrade (upgradeScaling.ts). */
    scalingReadouts: scalingDetail,
    isFeatureUnlocked,
    unlockedFeature,
    // Continue (per-run revive)
    continuesRemaining,
    gameInstanceKey,
    runStartIntroPending,
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
    // The map after this one (null past the final level).
    nextLevel: levels[currentLevelIndex + 1] ?? null,
    // What the shop's condition chips are judged against.
    nextRunContext,
    // The map being played, for anything asking whether a conditional upgrade
    // is live right now rather than on the next map.
    runContext,
    // Capstone ("Promotion")
    capstoneOffers,
    storeDealt,
    storeInterestPaid,
    handleShopDealt,
    capstone,
    handleSelectCapstone,
    // Run persistence (Continue / New Game on the welcome screen)
    hasSavedRun,
    savedRun,
    handleContinueRun,
    /** Resume a run from a record (the pair save; see TWO_PLAYER_PLAN step 6b). */
    resumeRunFrom,
    markRunIneligible,
    /** The next run started is a pair's: kept off the solo save (see pairRunRef). */
    beginPairRun,
    /**
     * Put the run into the state a record describes, without reloading the
     * catalogues or navigating. What a pair's guest does at the start of every
     * map, so the host's run is the only one either device is playing.
     */
    applyRunRecord,
    /**
     * The run as it stands, for anyone who needs to persist it somewhere else.
     *
     * A pair keeps its own copy of this on BOTH phones, under its own key, so
     * one player clearing their data does not end the run for the other. Read
     * through a getter rather than handed out as state: it is the same ref the
     * per-map write above reads, so the two cannot disagree about what "now"
     * is.
     */
    readRunSnapshot: () => runSnapshotRef.current,
    // Records (HIGHSCORES.md Phase A/B/C/D)
    lastRunRank,
    topRuns,
    monthlyBests,
    // Daily Stand-up
    dailyKey,
    dailyBests,
    dailyStreak,
    handleStartDaily,
    // Callbacks
    handleStartGame,
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
    handleSkipStoreFromOverlay,
    handleDismissFeatureUnlocked,
    handlePurchaseUpgrade,
    handlePurchaseAbility,
    retainedAbilityIds,
    freeAbilityGrant,
    // For the store's ability slot. `heldAbilityIdsNow` folds the ref into the
    // render so the shop can roll against it on mount; nothing re-reads it
    // mid-visit, which is what keeps the shelf still.
    heldAbilityIdsNow: heldAbilityIds(abilityCharges, everHeldAbilityIdsRef.current),
    abilitySlots: MAX_ABILITY_SLOTS,
    mapsRemaining: Math.max(0, totalLevels - (currentLevelIndex + 1)),
    handleContinueFromShop,
    handlePurchaseCertLevel,
    handlePlayAgain,
    handleRestartRun,
    handleBackToWelcome,
    handleOpenCertificateStore,
    handleOpenOffers,
    handleReEnableAllTutorials,
    handleTotalReset,
  };
}

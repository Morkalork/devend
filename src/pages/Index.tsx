/**
 * Index — the app's only page; renders whichever screen is active.
 *
 * Two hooks drive everything:
 *   - useScreenNavigation: which full-screen view is visible
 *   - useGameSession:      all game/run state, passed to each screen as props
 *
 * Screens slide left/right with framer-motion based on SCREEN_ORDER.
 * Admin screens are lazy-loaded and only available in dev builds.
 */
import { lazy, Suspense, useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useScreenNavigation } from '@/hooks/useScreenNavigation';
import { useGameSession } from '@/hooks/useGameSession';
import { useMenuHighlights } from '@/hooks/useMenuHighlights';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { DoorDraftScreen } from '@/components/game/DoorDraftScreen';
import { CapstoneDraftScreen } from '@/components/game/CapstoneDraftScreen';
import { RunDraftScreen } from '@/components/game/RunDraftScreen';
import { ContinuePrompt } from '@/components/game/ContinuePrompt';
import { AscensionDraftScreen } from '@/components/game/AscensionDraftScreen';
import { CertificateStore } from '@/components/game/CertificateStore';
import { LoadoutGalleryScreen } from '@/components/game/LoadoutGalleryScreen';
import { FeatureUnlockedModal } from '@/components/game/FeatureUnlockedModal';
import { AchievementsScreen } from '@/components/game/AchievementsScreen';
import { HallOfFameScreen } from '@/components/game/HallOfFameScreen';
import { TapToStartGate } from '@/components/game/TapToStartGate';
import { playMainMusic } from '@/lib/gameMusic';
import { todayKey, previousDayKey } from '@/lib/runRng';

const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));
const PlaygroundScreen = lazy(() => import('@/components/admin/PlaygroundScreen').then(m => ({ default: m.PlaygroundScreen })));

// Top-level menu screens that play the shared main.mp3 loop. Gameplay music is
// driven per-band by GameScreen; in-run interludes (result, shops, drafts) are
// intentionally left out so the current band track keeps playing through them.
const MENU_MUSIC_SCREENS = new Set(['welcome', 'tutorial', 'options', 'achievements', 'loadouts', 'hallOfFame']);

const Index = () => {
  const navigation = useScreenNavigation();
  const session = useGameSession(navigation);

  const displayLevel = session.currentLevelIndex + 1;

  return (
    <AccentColorProvider currentLevel={displayLevel}>
      <IndexContent navigation={navigation} session={session} />
    </AccentColorProvider>
  );
};

type Navigation = ReturnType<typeof useScreenNavigation>;
type Session = ReturnType<typeof useGameSession>;

function IndexContent({ navigation, session }: { navigation: Navigation; session: Session }) {
  const { t } = useTranslation();
  const { accentHex } = useAccentColor();
  // Admin is on automatically in local dev; on the deployed build it's unlocked
  // by a secret gesture (tap the welcome-screen ball 10 times), so the Playground
  // is reachable on dev without shipping an admin button to real players.
  const [adminUnlocked, setAdminUnlocked] = useState(import.meta.env.DEV);
  const handleSecretAdminUnlock = useCallback(() => {
    setAdminUnlocked(true);
    navigation.goToAdmin();
  }, [navigation]);
  // Daily Stand-up is hidden for now (design still being thought through). Flip
  // this to true to bring the welcome-menu button, its intro modal and its
  // first-time highlight back; the underlying feature is otherwise intact.
  const SHOW_DAILY_STANDUP = false;

  // Play the main-menu loop on menu screens. Blocked by autoplay on the very
  // first screen until a gesture, which gameMusic resumes automatically.
  useEffect(() => {
    if (MENU_MUSIC_SCREENS.has(navigation.currentScreen)) playMainMusic();
  }, [navigation.currentScreen]);

  // First-time menu highlights (gold ring + NEW badge on welcome buttons).
  // Each trigger marks a "first" the player hasn't acknowledged by tapping yet.
  const menuHighlights = useMenuHighlights(
    {
      newGame: true,
      records: session.topRuns.length > 0,
      certificates: session.totalCertificateHours > 0,
      achievements: session.completedAchievementIds.length > 0,
      daily: SHOW_DAILY_STANDUP && session.topRuns.length > 0,
    },
    // Prior progress = existing install; seeds already-passed firsts as seen.
    session.hasSavedRun ||
      session.topRuns.length > 0 ||
      session.totalCertificateHours > 0 ||
      session.completedAchievementIds.length > 0,
  );

  // The Performance Review is reachable from the welcome screen AND the result
  // screen; its Back button returns to wherever it was opened from.
  const hallReturnRef = useRef<'welcome' | 'result'>('welcome');
  const openHallFrom = (origin: 'welcome' | 'result') => {
    hallReturnRef.current = origin;
    navigation.goToHallOfFame();
  };
  const handleHallBack = () => {
    if (hallReturnRef.current === 'result' && navigation.lastResult) navigation.navigateTo('result');
    else navigation.goToWelcome();
  };

  const SCREEN_ORDER: Record<string, number> = {
    welcome: 0, tutorial: 1, options: 1, achievements: 1, loadouts: 1, hallOfFame: 1,
    game: 2, upgradeShop: 3, certificateStore: 3, runDraft: 3, ascensionDraft: 3, result: 4,
  };
  const prevScreenRef = useRef(navigation.currentScreen);
  const transitionDirRef = useRef(1);
  if (prevScreenRef.current !== navigation.currentScreen) {
    const prevOrder = SCREEN_ORDER[prevScreenRef.current] ?? 0;
    const currOrder = SCREEN_ORDER[navigation.currentScreen] ?? 0;
    transitionDirRef.current = currOrder >= prevOrder ? 1 : -1;
    prevScreenRef.current = navigation.currentScreen;
  }
  const slideVariants = {
    enter:  (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
    center: { x: 0 },
    exit:   (d: number) => ({ x: d < 0 ? '100%' : '-100%' }),
  };

  return (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', height: '100dvh', width: '100%' }}>
        <AnimatePresence mode="wait" custom={transitionDirRef.current}>
          <motion.div
            key={navigation.currentScreen}
            custom={transitionDirRef.current}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              willChange: 'transform',
              position: 'relative',
              width: '100%',
              height: '100dvh',
              // Issue #36: every view scrolls when its content overflows — the
              // game view is the sole exception and must never scroll. Scrollbar
              // chrome is hidden globally (see index.css), so this only adds the
              // ability to scroll, never a visible bar.
              overflowX: 'hidden',
              overflowY: navigation.currentScreen === 'game' ? 'hidden' : 'auto',
            }}
          >
            {navigation.currentScreen === 'welcome' && (
              <WelcomeScreen
                onStartGame={() => session.handleStartGame()}
                onContinue={session.hasSavedRun ? session.handleContinueRun : undefined}
                onTutorial={navigation.goToTutorial}
                onOptions={navigation.goToOptions}
                onOpenCertificateStore={
                  session.isFeatureUnlocked('certificates') ? session.handleOpenCertificateStore : undefined
                }
                onLoadouts={session.loadoutsIntroduced ? session.handleOpenLoadouts : undefined}
                onHallOfFame={session.topRuns.length > 0 ? () => openHallFrom('welcome') : undefined}
                onDaily={SHOW_DAILY_STANDUP ? () => session.handleStartDaily() : undefined}
                showDailyIntro={session.shouldShowDaily}
                onDailyIntroSeen={session.markDailySeen}
                // A streak is only shown while alive: attended today, or
                // yesterday with today still open.
                dailyStreak={
                  session.dailyStreak.lastKey === todayKey() || session.dailyStreak.lastKey === previousDayKey(todayKey())
                    ? session.dailyStreak.count
                    : 0
                }
                dailyDoneToday={session.dailyBests[todayKey()] !== undefined}
                onAchievements={session.isFeatureUnlocked('achievements') ? () => navigation.goToAchievements() : undefined}
                onAdmin={adminUnlocked ? navigation.goToAdmin : undefined}
                onSecretUnlock={adminUnlocked ? undefined : handleSecretAdminUnlock}
                isLoading={session.isLoading}
                error={session.error}
                accentColor={accentHex}
                totalCertificateHours={session.totalCertificateHours}
                completedAchievementCount={session.completedAchievementIds.length}
                highlights={menuHighlights.highlights}
                onHighlightSeen={menuHighlights.acknowledge}
              />
            )}
            {navigation.currentScreen === 'tutorial' && (
              <TutorialScreen
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
                encounteredBallTypeIds={session.encounteredBallTypeIds}
              />
            )}
            {navigation.currentScreen === 'options' && (
              <OptionsScreen
                onBack={navigation.goToWelcome}
                onReEnableTutorials={() => {
                  session.handleReEnableAllTutorials();
                  menuHighlights.resetHighlights();
                }}
                onResetCertificates={session.handleResetCertificates}
                hasCertificates={Object.keys(session.certLevelsOwned).length > 0 || session.totalCertificateHours > 0}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'game' && session.currentLevel && !session.showLevelComplete && (
              <GameScreen
                // Bumping gameInstanceKey (spending a Continue) remounts this so
                // the current level re-inits fresh with score + upgrades intact.
                key={`game-${session.gameInstanceKey}`}
                level={session.currentLevel}
                levelNumber={session.currentLevelIndex + 1}
                totalLevels={session.totalLevels}
                totalScore={session.totalScore}
                ownedUpgradeIds={session.ownedUpgradeIds}
                upgrades={session.upgrades}
                lives={session.currentLives}
                continuesRemaining={session.continuesRemaining}
                onLivesChange={session.handleLivesChange}
                onGrantAbility={session.handleGrantAbility}
                onSpendAbility={session.handleSpendAbility}
                abilityCharges={session.abilityCharges}
                onGameEnd={session.handleGameEnd}
                onLevelComplete={session.handleLevelComplete}
                onBallTypeLocked={session.recordBallTypeEncountered}
                onMainMenu={session.handleBackToWelcome}
                onRestart={session.handlePlayAgain}
                showInGameTutorial={session.showInGameTutorial}
                onFenceSeen={session.markFenceSeen}
                showMoverTutorial={session.showMoverTutorial}
                onMoverTutorialSeen={session.markMoverSeen}
                showTopBarTutorial={session.showTopBarTutorial}
                onTopBarTutorialSeen={session.markTopBarSeen}
                showBottomBarTutorial={session.showBottomBarTutorial}
                onBottomBarTutorialSeen={session.markBottomBarSeen}
                showTimeLimitTutorial={session.shouldShowTimeLimit}
                onTimeLimitTutorialSeen={session.markTimeLimitSeen}
                accentColor={accentHex}
                certificateProgress={session.certificateProgress}
                achievementBonuses={session.achievementBonuses}
                activeModifiers={session.activeModifiers}
                modifierSources={session.modifierSources}
                tagSetThreshold={session.tagSetThreshold}
                cumulativeLockedBalls={session.cumulativeLockedBalls}
                ascensionDepth={session.ascensionDepth}
                mapHighscores={session.mapHighscores}
                runPaceDelta={session.levelPace?.delta ?? null}
                activeDoor={session.activeDoor}
                capstone={session.capstone}
                activeLoadouts={session.activeLoadouts}
                fenceDurability={session.fenceDurability}
                introAssemble={session.introAssemblePending}
              />
            )}
            {navigation.currentScreen === 'runDraft' && (
              <RunDraftScreen
                loadouts={session.availableLoadouts}
                draftedLoadoutIds={session.draftedLoadoutIds}
                onConfirm={session.handleConfirmLoadout}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'upgradeShop' && (
              <UpgradeShop
                playerPoints={session.totalScore}
                upgrades={session.upgrades.filter(u => !u.ascensionOnly || session.ascensionDepth > 0)}
                ownedUpgradeIds={session.ownedUpgradeIds}
                completedLevel={session.currentLevelIndex + 1}
                isLocked={session.isUpgradeLocked}
                onPurchase={session.handlePurchaseUpgrade}
                onContinue={session.handleContinueFromShop}
                accentColor={accentHex}
                extraShopItems={session.activeModifiers.extraShopItems}
                shopRestockCount={session.activeModifiers.shopRestockCount}
                shopDiscountMultiplier={session.activeModifiers.shopDiscountMultiplier}
                showTutorial={session.shouldShowStore}
                onTutorialDismiss={session.markStoreSeen}
                newlyUnlockedCerts={session.shopUnlockedCerts}
                tagSetThreshold={session.tagSetThreshold}
                freeCheapestOffer={session.activeModifiers.freeCheapestOffer > 0 || session.carryFreeShopItems > 0}
                activeModifiers={session.activeModifiers}
                closed={session.storeClosed}
              />
            )}
            {navigation.currentScreen === 'capstoneDraft' && (
              <CapstoneDraftScreen
                offers={session.capstoneOffers}
                onSelect={session.handleSelectCapstone}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'doorDraft' && session.nextLevel && (
              <DoorDraftScreen
                nextLevel={session.nextLevel}
                offers={session.doorOffers}
                onSelect={session.handleSelectDoor}
                previousContract={session.lastContractSummary}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'ascensionDraft' && (
              <AscensionDraftScreen
                loadouts={session.loadouts}
                draftedLoadoutIds={session.draftedLoadoutIds}
                ascensionDepth={session.ascensionDepth}
                totalScore={session.totalScore}
                onAscend={session.handleAscend}
                onRetire={session.handleRetire}
                accentColor={accentHex}
                showTutorial={session.shouldShowAscension}
                onTutorialDismiss={session.markAscensionSeen}
              />
            )}
            {navigation.currentScreen === 'result' && navigation.lastResult && (
              <ResultScreen
                result={navigation.lastResult}
                onMainMenu={navigation.goToWelcome}
                onPlayAgain={session.handlePlayAgain}
                onRestart={session.handleRestartRun}
                checkpointLevel={session.certStartingLevel}
                accentColor={accentHex}
                runHoursAwarded={session.lastRunHoursAwarded}
                runLevelsCompleted={session.lastRunLevelsCompleted}
                newlyUnlockedLoadouts={session.lastRunLoadoutUnlocks}
                runRecap={session.lastRunRecap}
                runRank={session.lastRunRank}
                dailyKey={session.dailyKey}
                onRecords={session.topRuns.length > 0 ? () => openHallFrom('result') : undefined}
              />
            )}
            {navigation.currentScreen === 'certificateStore' && (
              <CertificateStore
                certificates={session.certificates}
                totalCertificateHours={session.totalCertificateHours}
                certLevelsOwned={session.certLevelsOwned}
                unlockedCertIds={session.unlockedCertIds}
                maxTierCounts={session.maxTierCounts}
                onPurchaseCertLevel={session.handlePurchaseCertLevel}
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
                showTutorial={session.shouldShowCertStore}
                onTutorialDismiss={session.markCertStoreSeen}
                upgrades={session.upgrades}
                achievements={session.achievements}
                metaStats={session.metaStats}
                lifetimeHoursSpent={session.lifetimeHoursSpent}
              />
            )}
            {navigation.currentScreen === 'loadouts' && (
              <LoadoutGalleryScreen
                loadouts={session.loadouts}
                wonLoadoutIds={session.wonLoadoutIds}
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'hallOfFame' && (
              <HallOfFameScreen
                topRuns={session.topRuns}
                monthlyBests={session.monthlyBests}
                dailyBests={session.dailyBests}
                dailyStreak={session.dailyStreak}
                archetypeBests={session.archetypeBests}
                mapHighscores={session.mapHighscores}
                metaStats={session.metaStats}
                onBack={handleHallBack}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'achievements' && (
              <AchievementsScreen
                achievements={session.achievements}
                completedIds={session.completedAchievementIds}
                activatedIds={session.activatedAchievementIds}
                metaStats={session.metaStats}
                onActivate={session.activateAchievement}
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
              />
            )}

            {adminUnlocked && navigation.currentScreen === 'admin' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <AdminScreen onBack={navigation.goToWelcome} onMapBuilder={navigation.goToMapBuilder} onAnimationTest={navigation.goToAnimationTest} />
              </Suspense>
            )}
            {adminUnlocked && navigation.currentScreen === 'mapBuilder' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <MapBuilder onBack={navigation.goToAdmin} />
              </Suspense>
            )}
            {adminUnlocked && navigation.currentScreen === 'animationTest' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <PlaygroundScreen onBack={navigation.goToAdmin} accentColor={accentHex} />
              </Suspense>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {session.showLevelComplete && session.pendingLevelScore && (
        <LevelCompleteOverlay
          scoreData={session.pendingLevelScore}
          totalScore={session.totalScore}
          onContinue={session.handleContinueFromOverlay}
          accentColor={accentHex}
          newlyUnlockedCerts={session.pendingCertUnlocks}
          pace={session.levelPace}
        />
      )}

      <AnimatePresence>
        {session.pendingDeathResult && (
          <ContinuePrompt
            key="continue-prompt"
            continuesRemaining={session.continuesRemaining}
            onSpend={session.handleSpendContinue}
            onDecline={session.handleDeclineContinue}
            accentColor={accentHex}
          />
        )}
      </AnimatePresence>

      <FeatureUnlockedModal
        feature={session.unlockedFeature}
        onDismiss={session.handleDismissFeatureUnlocked}
      />

      <TapToStartGate accentColor={accentHex} />
    </>
  );
}

export default Index;

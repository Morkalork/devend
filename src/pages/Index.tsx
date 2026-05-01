import { lazy, Suspense, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameState } from '@/hooks/useGameState';
import { useGameSession } from '@/hooks/useGameSession';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { AugmentStore } from '@/components/game/AugmentStore';
import { AchievementsScreen } from '@/components/game/AchievementsScreen';

const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));
const PlaygroundScreen = lazy(() => import('@/components/admin/PlaygroundScreen').then(m => ({ default: m.PlaygroundScreen })));

const Index = () => {
  const navigation = useGameState();
  const session = useGameSession(navigation);

  const displayLevel = navigation.currentScreen === 'game'
    ? session.currentLevelIndex + 1
    : session.checkpointStartLevel;

  return (
    <AccentColorProvider currentLevel={displayLevel}>
      <IndexContent navigation={navigation} session={session} />
    </AccentColorProvider>
  );
};

type Navigation = ReturnType<typeof useGameState>;
type Session = ReturnType<typeof useGameSession>;

function IndexContent({ navigation, session }: { navigation: Navigation; session: Session }) {
  const { accentHex } = useAccentColor();
  const isAdminEnabled = import.meta.env.DEV || new URLSearchParams(window.location.search).get('admin') === 'true';

  const SCREEN_ORDER: Record<string, number> = {
    welcome: 0, tutorial: 1, options: 1, achievements: 1,
    game: 2, upgradeShop: 3, augmentStore: 3, result: 4,
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
            style={{ willChange: 'transform', position: 'relative', width: '100%', height: '100dvh' }}
          >
            {navigation.currentScreen === 'welcome' && (
              <WelcomeScreen
                onStartGame={() => session.handleStartGame()}
                onStartFromLevel={
                  session.checkpointStartLevel > 1 && session.checkpointRemaining > 0
                    ? (level) => session.handleStartGame(level)
                    : undefined
                }
                onTutorial={navigation.goToTutorial}
                onOptions={navigation.goToOptions}
                onAugments={
                  Object.values(session.maxTierCounts).some(c => c > 0) ||
                  session.unlockedCertIds.length > 0 ||
                  Object.keys(session.certLevelsOwned).length > 0
                    ? session.handleAugmentsFromWelcome
                    : undefined
                }
                onAchievements={() => navigation.goToAchievements()}
                onAdmin={isAdminEnabled ? navigation.goToAdmin : undefined}
                isLoading={session.isLoading}
                error={session.error}
                accentColor={accentHex}
                checkpointLevel={session.checkpointStartLevel}
                checkpointRemainingMs={session.checkpointRemaining}
                totalAugmentPoints={session.totalAugmentPoints}
                completedAchievementCount={session.completedAchievementIds.length}
              />
            )}
            {navigation.currentScreen === 'tutorial' && (
              <TutorialScreen onBack={navigation.goToWelcome} accentColor={accentHex} />
            )}
            {navigation.currentScreen === 'options' && (
              <OptionsScreen
                onBack={navigation.goToWelcome}
                onReEnableTutorials={session.handleReEnableAllTutorials}
                onResetAugments={session.handleResetAugments}
                hasAugments={Object.keys(session.certLevelsOwned).length > 0 || session.totalAugmentPoints > 0}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'game' && session.currentLevel && !session.showLevelComplete && (
              <GameScreen
                level={session.currentLevel}
                levelNumber={session.currentLevelIndex + 1}
                totalLevels={session.totalLevels}
                totalScore={session.totalScore}
                ownedUpgradeIds={session.ownedUpgradeIds}
                upgrades={session.upgrades}
                lives={session.currentLives}
                onLivesChange={session.handleLivesChange}
                onGameEnd={session.handleGameEnd}
                onLevelComplete={session.handleLevelComplete}
                onMainMenu={session.handleBackToWelcome}
                onRestart={session.handlePlayAgain}
                showInGameTutorial={session.showInGameTutorial && session.currentLevelIndex === 0}
                onFenceSeen={session.markFenceSeen}
                showMoverTutorial={session.showMoverTutorial}
                onMoverTutorialSeen={session.markMoverSeen}
                accentColor={accentHex}
                augmentProgress={session.augmentProgress}
                achievementBonuses={session.achievementBonuses}
                activeModifiers={session.activeModifiers}
                cumulativeLockedBalls={session.cumulativeLockedBalls}
              />
            )}
            {navigation.currentScreen === 'upgradeShop' && (
              <UpgradeShop
                playerPoints={session.totalScore}
                upgrades={session.upgrades}
                ownedUpgradeIds={session.ownedUpgradeIds}
                completedLevel={session.currentLevelIndex + 1}
                canPurchase={session.canPurchaseUpgrade}
                isLocked={session.isUpgradeLocked}
                onPurchase={session.handlePurchaseUpgrade}
                onContinue={session.handleContinueFromShop}
                accentColor={accentHex}
                extraShopItems={session.activeModifiers.extraShopItems}
                showTutorial={session.shouldShowStore}
                onTutorialDismiss={session.markStoreSeen}
                newlyUnlockedCerts={session.shopUnlockedCerts}
              />
            )}
            {navigation.currentScreen === 'result' && navigation.lastResult && (
              <ResultScreen
                result={navigation.lastResult}
                onMainMenu={navigation.goToWelcome}
                accentColor={accentHex}
                runPointsAwarded={session.runPointsAwarded}
                runLevelsCompleted={session.runLevelsCompleted}
              />
            )}
            {navigation.currentScreen === 'augmentStore' && (
              <AugmentStore
                certificates={session.certificates}
                totalAugmentPoints={session.totalAugmentPoints}
                certLevelsOwned={session.certLevelsOwned}
                unlockedCertIds={session.unlockedCertIds}
                maxTierCounts={session.maxTierCounts}
                onPurchaseCertLevel={session.handlePurchaseCertLevel}
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
                showTutorial={session.shouldShowAugment}
                onTutorialDismiss={session.markAugmentSeen}
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

            {isAdminEnabled && navigation.currentScreen === 'admin' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
                <AdminScreen onBack={navigation.goToWelcome} onMapBuilder={navigation.goToMapBuilder} onAnimationTest={navigation.goToAnimationTest} />
              </Suspense>
            )}
            {isAdminEnabled && navigation.currentScreen === 'mapBuilder' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
                <MapBuilder onBack={navigation.goToAdmin} />
              </Suspense>
            )}
            {isAdminEnabled && navigation.currentScreen === 'animationTest' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
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
        />
      )}
    </>
  );
}

export default Index;

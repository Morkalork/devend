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
import type { GameScreen as GameScreenName } from '@/types/game';
import { useZoomGuard } from '@/hooks/useZoomGuard';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useScreenNavigation } from '@/hooks/useScreenNavigation';
import { useGameSession } from '@/hooks/useGameSession';
import { usePairSession } from '@/hooks/usePairSession';
import type { PairedSession } from '@/components/game/PairLobby';
import { useMenuHighlights } from '@/hooks/useMenuHighlights';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { GameErrorBoundary } from '@/components/GameErrorBoundary';
import { flushRunSave } from '@/lib/runSaveFlush';
import { adminOnHere } from '@/lib/adminAccess';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { DoorDraftScreen } from '@/components/game/DoorDraftScreen';
import { CapstoneDraftScreen } from '@/components/game/CapstoneDraftScreen';
import { TierDraftScreen } from '@/components/game/TierDraftScreen';
import { REWARD_GOLD } from '@/components/game/rewardTheme';
import { AssignmentSummaryScreen } from '@/components/game/AssignmentSummaryScreen';
import { RunDraftScreen } from '@/components/game/RunDraftScreen';
import { TenureDraftScreen } from '@/components/game/TenureDraftScreen';
import { ContinuePrompt } from '@/components/game/ContinuePrompt';
import { AscensionDraftScreen } from '@/components/game/AscensionDraftScreen';
import { CertificateStore } from '@/components/game/CertificateStore';
import { LoadoutGalleryScreen } from '@/components/game/LoadoutGalleryScreen';
import { FeatureUnlockedModal } from '@/components/game/FeatureUnlockedModal';
import { AchievementsScreen } from '@/components/game/AchievementsScreen';
import { HallOfFameScreen } from '@/components/game/HallOfFameScreen';
import { JukeboxScreen } from '@/components/game/JukeboxScreen';
import { TapToStartGate } from '@/components/game/TapToStartGate';
import { playMainMusic, stopMusic } from '@/lib/gameMusic';
import { loadMusicCatalogue, getMusicCatalogue } from '@/lib/musicCatalogue';
import type { MusicCatalogue } from '@/types/music';
import { backActionForScreen } from '@/lib/screenBack';
import { todayKey, previousDayKey } from '@/lib/runRng';
/**
 * The screens that show a live board, and must not be resized under the player.
 *
 * Kept beside the style that reads it rather than shared with zoomGuard's own
 * list: that one answers "is a drag here always gameplay", this one answers "is
 * a board being played on here", and they agree today by coincidence of the
 * same three screens rather than because one implies the other.
 */
// `GameScreenName`, aliased: the bare name is the component in this file.
const BOARD_SCREENS: GameScreenName[] = ['game', 'tutorial', 'pairLoopback'];

const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));
const PlaygroundScreen = lazy(() => import('@/components/admin/PlaygroundScreen').then(m => ({ default: m.PlaygroundScreen })));
const UpgradeAtlasScreen = lazy(() => import('@/components/admin/UpgradeAtlasScreen').then(m => ({ default: m.UpgradeAtlasScreen })));
const PairLoopbackPanel = lazy(() => import('@/components/admin/PairLoopbackPanel').then(m => ({ default: m.PairLoopbackPanel })));
const PairLobby = lazy(() => import('@/components/game/PairLobby').then(m => ({ default: m.PairLobby })));
const PairDecision = lazy(() => import('@/components/game/PairDecision').then(m => ({ default: m.PairDecision })));
const PairMismatchNotice = lazy(() => import('@/components/game/PairMismatchNotice').then(m => ({ default: m.PairMismatchNotice })));
const PairGuestGate = lazy(() => import('@/components/game/PairGuestGate').then(m => ({ default: m.PairGuestGate })));
const PairLinkBanner = lazy(() => import('@/components/game/PairLinkBanner').then(m => ({ default: m.PairLinkBanner })));
const NearbyDiagnosticsPanel = lazy(() => import('@/components/admin/NearbyDiagnosticsPanel').then(m => ({ default: m.NearbyDiagnosticsPanel })));

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
  /**
   * Two-player (TWO_PLAYER_PLAN.md).
   *
   * `paired` is the live link the lobby produced; `pair` is everything that
   * hangs off it, including the lockstep the game loop reads its ticks from.
   * Both are null in solo play, which is why nothing below the lobby has to
   * ask whether a second player exists.
   */
  const [paired, setPaired] = useState<PairedSession | null>(null);
  const pair = usePairSession(paired);

  const leavePair = useCallback(() => {
    pair.end();
    setPaired(null);
    navigation.goToWelcome();
  }, [pair, navigation]);

  // The host has settled Continue or New and both devices hold the run: start
  // the map. A resumed run goes through the same path the solo Continue uses.
  const pairRunState = pair.runState;
  const pairPhase = pair.phase;
  useEffect(() => {
    if (pairPhase !== 'playing' || !pairRunState) return;
    // The pair's seed goes in with it: starting a run clears the seed, and a
    // pair run that lost it dealt and rolled everything separately per phone.
    // A pair's run, and only the pair's: it lives in the pair save and never
    // becomes the welcome screen's Continue (useGameSession, pairRunRef).
    session.beginPairRun();
    if (pairRunState.resumed && pairRunState.run) session.resumeRunFrom(pairRunState.run, pairRunState.seed);
    else session.handleStartGame(undefined, undefined, pairRunState.seed);
    // handleStartGame/handleResumeSavedRun are stable session actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairPhase, pairRunState]);

  // A pair keeps its own copy of the run on BOTH phones, written on the same
  // signal the solo save uses: a new map beginning. On the host that write is
  // also a publication: the guest takes the host's run as the only run.
  const pairRecordMap = pair.recordMap;
  // Which map was last recorded, so the write (and on the host, the publish)
  // happens once per map even if this effect re-runs. A re-publish is not
  // harmless: the guest adopts every copy it receives, and each adoption
  // rebuilds its modifiers and re-arms the map's Acceptance Criteria.
  const recordedMapRef = useRef<string | null>(null);
  useEffect(() => {
    if (pairPhase !== 'playing' || navigation.currentScreen !== 'game') {
      // Leaving the board (a retry, the shop) re-arms it, as before: a map
      // entered again is recorded again, it just is not recorded twice in a row.
      recordedMapRef.current = null;
      return;
    }
    const mapKey = `${pairRunState?.seed ?? ''}:${session.currentLevelIndex}`;
    if (recordedMapRef.current === mapKey) return;
    const snap = session.readRunSnapshot();
    if (!snap || snap.levelSequenceIds.length === 0) return;
    recordedMapRef.current = mapKey;
    pairRecordMap({ ...snap, version: 1, savedAt: Date.now() });
    // Keyed on the map, like the solo write: the payload is read fresh, so
    // this fires once per map rather than on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairPhase, navigation.currentScreen, session.currentLevelIndex, pairRecordMap, pairRunState]);

  /**
   * The guest takes the host's run at the start of every map.
   *
   * The run used to sync once, at the Continue-or-New decision, and never
   * again. That is enough for map one and wrong from map two: between maps the
   * two phones walked their own shop, their own drafts and their own
   * assignment screens, so they arrived at the next board with different
   * upgrades, computed different modifiers, and played two different games off
   * one seed. Whatever this phone did in between is overwritten, because the
   * host owns the run.
   */
  /**
   * Both phones say what they are about to play under, at each map start.
   *
   * Certificates, achievements and loadout bonuses come from each phone's own
   * storage and none of them travel in the run record, so two players with
   * different unlocks would compute different fence speeds and lock thresholds
   * before either of them touched the board. That is not a drift the hashes
   * can repair, because the cause is not on the board.
   */
  const declareModifiers = pair.declareModifiers;
  const activeModifiers = session.activeModifiers;
  useEffect(() => {
    if (pairPhase !== 'playing' || navigation.currentScreen !== 'game') return;
    declareModifiers(session.currentLevelIndex, activeModifiers as unknown as Record<string, unknown>);
  }, [pairPhase, navigation.currentScreen, session.currentLevelIndex, activeModifiers, declareModifiers]);

  /**
   * What the host is deciding right now, for the guest's gate.
   *
   * Null means nothing is: either this device IS the host, or it is on the
   * board where both players act. Everything else in the run is a decision
   * about one run, which one device has to own.
   */
  const guestGate: "shopping" | "deciding" | "pushing" | "continuing" | null =
    pair.phase !== 'playing' || pair.isHost
      ? null
      : session.pendingDeathResult
        ? "continuing"
        : navigation.currentScreen === 'upgradeShop'
          ? "shopping"
          : navigation.currentScreen !== 'game'
            ? "deciding"
            // The map-won card sits over the game screen rather than replacing
            // it, so the screen check above never saw it and the guest was
            // offered the host's Next Level button.
            : session.showLevelComplete
              ? "deciding"
              : null;

  /**
   * A pair run never files on the solo ladder.
   *
   * Two players cut roughly twice as fast, so within an evening the records
   * would stop measuring solo play, which is the only thing they are for.
   * Armed once, when the run starts, rather than at banking time: by then the
   * run is over and a missed call means a record that should not exist.
   */
  const markRunIneligible = session.markRunIneligible;
  useEffect(() => {
    if (pairPhase !== 'playing') return;
    markRunIneligible();
  }, [pairPhase, markRunIneligible]);

  const pairAdopt = pair.adopt;
  const applyRunRecord = session.applyRunRecord;
  const adoptedAtRef = useRef(0);
  useEffect(() => {
    if (!pairAdopt || pair.isHost) return;
    if (pairAdopt.at === adoptedAtRef.current) return;
    adoptedAtRef.current = pairAdopt.at;
    applyRunRecord(pairAdopt.run);
    navigation.goToGame();
  }, [pairAdopt, pair.isHost, applyRunRecord, navigation]);

  const { t } = useTranslation();
  const { accentHex } = useAccentColor();
  // Browser zoom off everywhere the game is PLAYED, on for the admin tools that
  // manage zoom themselves. Mounted here rather than on the game screen because
  // it has to be the default: a pinch that lands on the shop or a draft card is
  // the same accident with the same un-undoable result. See lib/zoomGuard.
  // Returns whether a zoom got through anyway and would not go back (see
  // lib/viewportZoom): the game screen pauses the map on it rather than letting
  // the balls play on behind a view the player cannot read.
  const viewportZoomStuck = useZoomGuard(navigation.currentScreen);
  // Admin is on automatically where the game is being BUILT rather than played:
  // the local dev server, and the staging deploy. Everywhere else it is still
  // unlocked by the secret gesture (tap the welcome-screen ball 10 times), so no
  // admin button ships to a real player. See lib/adminAccess for why this asks
  // the host - and for the Capacitor trap that makes "localhost" the wrong
  // question.
  const [adminUnlocked, setAdminUnlocked] = useState(adminOnHere);
  const handleSecretAdminUnlock = useCallback(() => {
    setAdminUnlocked(true);
    navigation.goToAdmin();
  }, [navigation]);
  // Daily Stand-up is hidden for now (design still being thought through). Flip
  // this to true to bring the welcome-menu button, its intro modal and its
  // first-time highlight back; the underlying feature is otherwise intact.
  const SHOW_DAILY_STANDUP = false;

  // The music catalogue backs the Jukebox and nothing else, so it is loaded
  // here rather than with the run catalogues in useGameSession: those load when
  // a run starts, and this button has to work before one ever has. A failed
  // load leaves it null, which hides the button rather than opening an empty
  // screen.
  const [musicCatalogue, setMusicCatalogue] = useState<MusicCatalogue | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMusicCatalogue().then((ok) => {
      if (ok && !cancelled) setMusicCatalogue(getMusicCatalogue());
    });
    return () => { cancelled = true; };
  }, []);

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
  const handleHallBack = useCallback(() => {
    if (hallReturnRef.current === 'result' && navigation.lastResult) navigation.navigateTo('result');
    else navigation.goToWelcome();
  }, [navigation]);

  // ── BACK-command handling (Android back gesture / browser back) ────────────
  // The app is a screen state-machine with no per-screen history, so a raw back
  // would pop the page and exit the game. We keep a history "guard" entry and,
  // on popstate, route the back INTO the game (see backActionForScreen). Works
  // in both a browser and the Capacitor WebView (both drive the hardware back
  // through window history).
  const gameBackRef = useRef<(() => void) | null>(null);
  const guardArmedRef = useRef(false);
  const armBackGuard = useCallback(() => {
    window.history.pushState({ devendBackGuard: true }, '');
    guardArmedRef.current = true;
  }, []);

  // Returns true if the back was handled internally (so the guard is re-armed);
  // false only on the root screen, where the next back is allowed to exit.
  const handleBack = useCallback((): boolean => {
    switch (backActionForScreen(navigation.currentScreen)) {
      case 'exit':
        return false;
      case 'welcome':
        navigation.goToWelcome();
        return true;
      case 'admin':
        navigation.goToAdmin();
        return true;
      case 'hall':
        handleHallBack();
        return true;
      case 'game':
        gameBackRef.current?.();
        return true;
      case 'consume':
        return true;
    }
  }, [navigation, handleHallBack]);
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;

  useEffect(() => {
    armBackGuard();
    const onPopState = () => {
      guardArmedRef.current = false;        // the guard entry was just consumed
      if (handleBackRef.current()) armBackGuard();
      // else (root): leave it un-armed so a second back actually exits.
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-arm the guard whenever we navigate off the root, so back keeps being
  // intercepted after the player leaves (or returns to) the main menu.
  useEffect(() => {
    if (navigation.currentScreen !== 'welcome' && !guardArmedRef.current) armBackGuard();
  }, [navigation.currentScreen, armBackGuard]);

  const SCREEN_ORDER: Record<string, number> = {
    welcome: 0, tutorial: 1, options: 1, achievements: 1, loadouts: 1, hallOfFame: 1, jukebox: 1,
    // tenureDraft sits just before runDraft: it is picked first so a free
    // upgrade chain can steer the loadout choice.
    tenureDraft: 2, game: 2, upgradeShop: 3, certificateStore: 3, runDraft: 3,
    ascensionDraft: 3, result: 4,
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
              // `svh` on a screen showing a board, `dvh` everywhere else.
              //
              // `dvh` is DEFINED to move as the mobile URL bar collapses and
              // expands, which is exactly what you want for a page that
              // scrolls and exactly what you do not want under a game: the
              // resize reaches GameCanvas, which rebuilds `boardRect` from the
              // container, and the board changes size while a fence is being
              // drawn on it. Reported repeatedly as "the gameboard is zooming
              // out", and it is not the browser's zoom at all.
              //
              // `svh` is the SMALL viewport height - the size with the bar
              // showing - and it does not move. The board is then laid out
              // once and stays put; the cost is a strip of unused space when
              // the bar is hidden, which is a far better trade than a board
              // that resizes mid-cut. GameCanvas holds any resize that still
              // arrives (lib/boardResizeHold) for the causes this cannot
              // reach, such as an orientation change.
              height: BOARD_SCREENS.includes(navigation.currentScreen) ? '100svh' : '100dvh',
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
                savedRunAscension={session.savedRun?.ascensionDepth ?? 0}
                onTutorial={navigation.goToTutorial}
                onOptions={navigation.goToOptions}
                onOpenCertificateStore={
                  session.isFeatureUnlocked('certificates') ? session.handleOpenCertificateStore : undefined
                }
                onLoadouts={session.loadoutsIntroduced ? session.handleOpenLoadouts : undefined}
                onHallOfFame={session.topRuns.length > 0 ? () => openHallFrom('welcome') : undefined}
                onDaily={SHOW_DAILY_STANDUP ? () => session.handleStartDaily() : undefined}
                onTwoPlayer={navigation.goToPairLobby}
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
                onJukebox={musicCatalogue ? navigation.goToJukebox : undefined}
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
                onTotalReset={session.handleTotalReset}
                accentColor={accentHex}
              />
            )}
            {/* The game screen gets its own boundary so a crash on the board
                costs the MAP, not the app: the run is saved to the current map
                and you land back on the menu able to resume. The outer
                boundary in App is the backstop for everything else. */}
            {navigation.currentScreen === 'game' && session.currentLevel && !session.showLevelComplete && (
              <GameErrorBoundary
                scope="game"
                onCrash={flushRunSave}
                onRecover={navigation.goToWelcome}
              >
              <GameScreen
                viewportZoomStuck={viewportZoomStuck}
                lockstep={pair.lockstep}
                isPairGuest={pair.phase === 'playing' && !pair.isHost}
                pairPartnerName={pair.remoteName}
                pairBanner={
                  pair.phase === 'playing' && (pair.stalled || pair.dropped)
                    ? (
                        <Suspense fallback={null}>
                          <PairLinkBanner
                            stalled={pair.stalled}
                            dropped={pair.dropped}
                            remoteName={pair.remoteName}
                            onRepair={leavePair}
                            onContinueSolo={pair.continueSolo}
                          />
                        </Suspense>
                      )
                    : undefined
                }
                // Bumping gameInstanceKey (spending a Continue) remounts this so
                // the current level re-inits fresh with score + upgrades intact.
                key={`game-${session.gameInstanceKey}`}
                backRef={gameBackRef}
                level={session.currentLevel}
                adminMode={adminUnlocked}
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
                abilitySlots={session.ascensionRules.abilitySlots}
                fenceSlotIds={session.fenceSlotIds}
                onGameEnd={session.handleGameEnd}
                onMapTimedOut={session.handleMapTimedOut}
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
                activeDoor={session.activeDoor}
                blockResults={session.blockResults}
                capstone={session.capstone}
                activeLoadouts={session.activeLoadouts}
                fenceDurability={session.fenceDurability}
                ascensionLadder={session.ascensionLadder}
                scalingReadouts={session.scalingReadouts}
                everyMapMutated={session.ascensionRules.everyMapMutated}
                pickupLifetimeFactor={session.ascensionRules.pickupLifetimeFactor}
                introAssemble={session.introAssemblePending}
              />
              </GameErrorBoundary>
            )}
            {navigation.currentScreen === 'tenureDraft' && session.pendingTenure && (
              <TenureDraftScreen
                offers={session.pendingTenure.offers}
                earnedAtLevel={session.pendingTenure.earnedAtLevel}
                lastRunUpgradeIds={session.pendingTenure.lastRunUpgradeIds}
                onConfirm={session.handleTenurePicked}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'runDraft' && (
              <RunDraftScreen
                loadouts={session.availableLoadouts}
                draftedLoadoutIds={session.draftedLoadoutIds}
                onConfirm={session.handleConfirmLoadout}
                onBack={session.handleBackToWelcome}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'upgradeShop' && (
              <UpgradeShop
                runContext={session.nextRunContext}
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
                certificates={session.certificates}
                // What the fence bar already holds, so the shelf stops offering
                // a fence type the bar has no room for. Same list the bar is
                // drawn from; a second derivation here would be free to
                // disagree with what the player is looking at.
                heldFenceTypeIds={session.fenceSlotIds}
                maxTierCounts={session.maxTierCounts}
                unlockedCertIds={session.unlockedCertIds}
                tagSetThreshold={session.tagSetThreshold}
                freeCheapestOffer={session.activeModifiers.freeCheapestOffer > 0 || session.carryFreeShopItems > 0}
                activeModifiers={session.activeModifiers}
                closed={session.storeClosed}
                locksHave={session.storeLockProgress.have}
                locksNeed={session.storeLockProgress.need}
                heldAbilityIds={session.heldAbilityIdsNow}
                abilitySlots={session.abilitySlots}
                mapsRemaining={session.mapsRemaining}
                // Open Source Contribution trades the slot away for a free
                // ability on arrival, so the shelf loses its ability card.
                abilityOfferCount={session.activeModifiers.freeAbilityPerStore > 0
                  ? 0
                  : 1 + Math.max(0, Math.round(session.activeModifiers.extraAbilityOffers))}
                onPurchaseAbility={session.handlePurchaseAbility}
                freeAbilityGrant={session.freeAbilityGrant}
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
                onSkip={session.handleSkipAssignment}
                accentColor={accentHex}
              />
            )}
            {navigation.currentScreen === 'assignmentSummary' && session.activeDoor && session.lastContractSummary && (
              <AssignmentSummaryScreen
                assignment={session.activeDoor}
                results={session.blockResults}
                blockStats={session.lastContractSummary}
                rewardLabel={session.lastContractSummary.rewardLabel ?? null}
                nextIsUpgradePick={!!session.pendingTierDraft}
                onContinue={session.handleContinueFromSummary}
              />
            )}
            {navigation.currentScreen === 'tierDraft' && session.pendingTierDraft && (
              <TierDraftScreen
                offers={session.pendingTierDraft.offers}
                tier={session.pendingTierDraft.tier}
                onSelect={session.handleSelectTierUpgrade}
                /* Gold, not the run accent: this screen is the second half of
                   the Assignment Complete summary, whose reward button is gold,
                   and two screens in one handover have to look like one thing.
                   The accent is also the player's own colour and gets re-skinned
                   red on boss maps, neither of which a reward should follow. */
                accentColor={REWARD_GOLD}
              />
            )}
            {navigation.currentScreen === 'ascensionDraft' && (
              <AscensionDraftScreen
                loadouts={session.loadouts}
                draftedLoadoutIds={session.draftedLoadoutIds}
                ascensionDepth={session.ascensionDepth}
                ladder={session.ascensionLadder}
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
            {navigation.currentScreen === 'jukebox' && musicCatalogue && (
              <JukeboxScreen
                catalogue={musicCatalogue}
                onBack={navigation.goToWelcome}
                accentColor={accentHex}
                // The jukebox owns the speakers while it is open: the menu loop
                // playing under a track the player chose is just two songs.
                onEnter={stopMusic}
                onExit={playMainMusic}
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
                <AdminScreen
                  onBack={navigation.goToWelcome}
                  onMapBuilder={navigation.goToMapBuilder}
                  onAnimationTest={navigation.goToAnimationTest}
                  onUpgradeAtlas={navigation.goToUpgradeAtlas}
                  onPairLoopback={navigation.goToPairLoopback}
                  onNearbyDiagnostics={navigation.goToNearbyDiagnostics}
                />
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
            {adminUnlocked && navigation.currentScreen === 'upgradeAtlas' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <UpgradeAtlasScreen onBack={navigation.goToAdmin} />
              </Suspense>
            )}
            {navigation.currentScreen === 'pairLobby' && pair.phase === 'idle' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <PairLobby
                  onBack={navigation.goToWelcome}
                  onPaired={setPaired}
                />
              </Suspense>
            )}
            {navigation.currentScreen === 'pairLobby' && pair.phase === 'deciding' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <PairDecision
                  isHost={pair.isHost}
                  remoteName={pair.remoteName}
                  mine={pair.offeredSave?.mine ?? null}
                  theirs={pair.offeredSave?.theirs ?? null}
                  onContinue={pair.chooseContinue}
                  onNew={pair.chooseNew}
                  onLeave={leavePair}
                />
              </Suspense>
            )}
            {adminUnlocked && navigation.currentScreen === 'nearbyDiagnostics' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <NearbyDiagnosticsPanel onBack={navigation.goToAdmin} />
              </Suspense>
            )}
            {adminUnlocked && navigation.currentScreen === 'pairLoopback' && (
              <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">{t('common.loading')}</div>}>
                <PairLoopbackPanel onBack={navigation.goToAdmin} />
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

      {pair.modifierMismatch && (
        <Suspense fallback={null}>
          <PairMismatchNotice remoteName={pair.remoteName} onLeave={leavePair} />
        </Suspense>
      )}

      {guestGate && (
        <Suspense fallback={null}>
          <PairGuestGate what={guestGate} remoteName={pair.remoteName} />
        </Suspense>
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

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
import { lazy, Suspense, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import type { GameScreen as GameScreenName } from '@/types/game';
import { useZoomGuard } from '@/hooks/useZoomGuard';
import { useTranslation } from 'react-i18next';
import { useScreenNavigation } from '@/hooks/useScreenNavigation';
import { useGameSession } from '@/hooks/useGameSession';
import { usePairSession } from '@/hooks/usePairSession';
import type { PairedSession } from '@/lib/net/transport';
import { useMenuHighlights } from '@/hooks/useMenuHighlights';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/ui/screens/WelcomeScreen';
import { TutorialScreen } from '@/ui/screens/TutorialScreen';
import { OptionsScreen } from '@/ui/screens/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { GameErrorBoundary } from '@/components/GameErrorBoundary';
import { flushRunSave } from '@/lib/runSaveFlush';
import { adminOnHere } from '@/lib/adminAccess';
import { CanvasUiRoot } from '@/ui/CanvasUiRoot';
import { CanvasLayer } from '@/ui/CanvasLayer';
import { startScreenSlide } from '@/ui/screenSlide';
import { CRTBackground } from '@/components/game/CRTBackground';
import { ResultScreen } from '@/ui/screens/ResultScreen';
import { LevelCompleteOverlay } from '@/ui/screens/LevelCompleteOverlay';
import { SPRINT_PLANNING_ENABLED } from '@/lib/sprintPlanning';
import { isFullDebrief } from '@/ui/screens/debriefMode';
import { UpgradeShop } from '@/ui/screens/UpgradeShop';
import { CapstoneDraftScreen } from '@/ui/screens/CapstoneDraftScreen';
import { RunDraftScreen } from '@/ui/screens/RunDraftScreen';
import { ChainPickScreen } from '@/ui/screens/ChainPickScreen';
import { ContinuePrompt } from '@/ui/screens/ContinuePrompt';
import { CertificateStore } from '@/ui/screens/CertificateStore';
import { OffersScreen } from '@/ui/screens/OffersScreen';
import { getOffer, getOfferCatalogue } from '@/lib/sprintOffers';
import { FeatureUnlockedModal } from '@/ui/game/FeatureUnlockedModal';
import { PairMismatchNotice } from '@/ui/game/PairMismatchNotice';
import { PairGuestGate } from '@/ui/game/PairGuestGate';
import { PairLinkBanner } from '@/ui/game/PairLinkBanner';
import { AchievementsScreen } from '@/ui/screens/AchievementsScreen';
import { HallOfFameScreen } from '@/ui/screens/HallOfFameScreen';
import { JukeboxScreen } from '@/ui/screens/JukeboxScreen';
import { TapToStartGate } from '@/ui/screens/TapToStartGate';
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
/** Admin's own tools: DOM screens with no canvas interface at all. */
const DOM_ONLY_SCREENS: GameScreenName[] = ['admin', 'mapBuilder', 'upgradeAtlas', 'nearbyDiagnostics', 'pairLoopback'];
/**
 * Screens that draw their own background: the game (its CRT runs paused with
 * the map) and the admin tools. Every other screen is a canvas screen over the
 * one shared CRT backdrop, which stays DOM: it is decorative and takes no
 * touches, so it has no part in the zoom problem the canvas exists to end.
 */
const OWN_BACKGROUND_SCREENS: GameScreenName[] = [...DOM_ONLY_SCREENS, 'game', 'animationTest', 'pairLobby'];

const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));
const PlaygroundScreen = lazy(() => import('@/components/admin/PlaygroundScreen').then(m => ({ default: m.PlaygroundScreen })));
const UpgradeAtlasScreen = lazy(() => import('@/components/admin/UpgradeAtlasScreen').then(m => ({ default: m.UpgradeAtlasScreen })));
const PairLoopbackPanel = lazy(() => import('@/components/admin/PairLoopbackPanel').then(m => ({ default: m.PairLoopbackPanel })));
const PairLobby = lazy(() => import('@/ui/screens/PairLobby').then(m => ({ default: m.PairLobby })));
const PairDecision = lazy(() => import('@/ui/screens/PairDecision').then(m => ({ default: m.PairDecision })));
const NearbyDiagnosticsPanel = lazy(() => import('@/components/admin/NearbyDiagnosticsPanel').then(m => ({ default: m.NearbyDiagnosticsPanel })));

// Top-level menu screens that play the shared main.mp3 loop. Gameplay music is
// driven per-band by GameScreen; in-run interludes (result, shops, drafts) are
// intentionally left out so the current band track keeps playing through them.
const MENU_MUSIC_SCREENS = new Set(['welcome', 'tutorial', 'options', 'achievements', 'offers', 'hallOfFame']);

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
   * two phones walked their own shop and their own drafts, so they arrived at the next board with different
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
    welcome: 0, tutorial: 1, options: 1, achievements: 1, offers: 1, hallOfFame: 1, jukebox: 1,
    // The chain pick follows Sprint Planning (runDraft), so it slides on from it.
    game: 2, upgradeShop: 3, certificateStore: 3, runDraft: 3, chainPick: 4,
    result: 4,
  };
  // The slide to the new screen happens on the interface canvas (ui/screenSlide):
  // deeper into a run comes in from the right, back towards the menu from the
  // left. Not to or from a board screen, whose board is a DOM canvas the slide
  // cannot carry (those have the boot reveal and the shatter instead).
  const prevScreenRef = useRef(navigation.currentScreen);
  useLayoutEffect(() => {
    const prev = prevScreenRef.current;
    const next = navigation.currentScreen;
    if (prev === next) return;
    prevScreenRef.current = next;
    if (BOARD_SCREENS.includes(prev) || BOARD_SCREENS.includes(next)) return;
    const prevOrder = SCREEN_ORDER[prev] ?? 0;
    const currOrder = SCREEN_ORDER[next] ?? 0;
    startScreenSlide(currOrder >= prevOrder ? 1 : -1);
  });

  return (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', height: '100dvh', width: '100%' }}>
        {/* Keyed by screen, so each screen mounts fresh as it did under the old
            slide. Nothing here moves: the slide is the canvas's. */}
        <div
            key={navigation.currentScreen}
            style={{
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
              <CanvasLayer id="screen-WelcomeScreen" z={10}>
                <WelcomeScreen
                  onStartGame={() => session.handleStartGame()}
                  onContinue={session.hasSavedRun ? session.handleContinueRun : undefined}
                  onTutorial={navigation.goToTutorial}
                  onOptions={navigation.goToOptions}
                  onOpenCertificateStore={
                    session.isFeatureUnlocked('certificates') ? session.handleOpenCertificateStore : undefined
                  }
                  // The Sprint Planning collection, once the draft itself is unlocked.
                  onOffers={SPRINT_PLANNING_ENABLED && session.sprintUnlocked ? session.handleOpenOffers : undefined}
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
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'tutorial' && (
              <CanvasLayer id="screen-TutorialScreen" z={10}>
                <TutorialScreen
                  onBack={navigation.goToWelcome}
                  accentColor={accentHex}
                  encounteredBallTypeIds={session.encounteredBallTypeIds}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'options' && (
              <CanvasLayer id="screen-OptionsScreen" z={10}>
                <OptionsScreen
                  onBack={navigation.goToWelcome}
                  onReEnableTutorials={() => {
                    session.handleReEnableAllTutorials();
                    menuHighlights.resetHighlights();
                  }}
                  onTotalReset={session.handleTotalReset}
                  accentColor={accentHex}
                />
              </CanvasLayer>
            )}
            {/* The game screen gets its own boundary so a crash on the board
                costs the MAP, not the app: the run is saved to the current map
                and you land back on the menu able to resume. The outer
                boundary in App is the backstop for everything else. */}
            {/* The ticket Debrief opens over the finished board, so the board
                stays mounted under it; the full Debrief (Admin) replaces it. */}
            {navigation.currentScreen === 'game' && session.currentLevel && (!session.showLevelComplete || !isFullDebrief()) && (
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
                        <PairLinkBanner
                          stalled={pair.stalled}
                          dropped={pair.dropped}
                          remoteName={pair.remoteName}
                          onRepair={leavePair}
                          onContinueSolo={pair.continueSolo}
                        />
                      )
                    : undefined
                }
                // Bumping gameInstanceKey (spending a Continue) remounts this so
                // the current level re-inits fresh with score + upgrades intact.
                // The level too: with the board kept under the ticket, a skipped
                // store goes straight to the next map without unmounting this.
                key={`game-${session.gameInstanceKey}-${session.currentLevelIndex}`}
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
                abilitySlots={session.abilitySlots}
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
                capstone={session.capstone}
                runOffer={session.runOffer}
                scalingReadouts={session.scalingReadouts}
                runStartIntro={session.runStartIntroPending}
              />
              </GameErrorBoundary>
            )}
            {navigation.currentScreen === 'runDraft' && session.pendingSprint && (
              <CanvasLayer id="screen-RunDraftScreen" z={10}>
                <RunDraftScreen
                  cards={session.pendingSprint.cards}
                  onConfirm={session.handleSprintPick}
                  onBack={session.handleBackToWelcome}
                  accentColor={accentHex}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'chainPick' && session.pendingChainPick && (
              <CanvasLayer id="screen-ChainPickScreen" z={10}>
                <ChainPickScreen
                  offer={getOffer(session.pendingChainPick.offerId) ?? { id: session.pendingChainPick.offerId, name: '' }}
                  choices={session.pendingChainPick.choices}
                  onConfirm={session.handleChainPick}
                  accentColor={accentHex}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'upgradeShop' && (
              <CanvasLayer id="screen-UpgradeShop" z={10}>
                <UpgradeShop
                  runContext={session.nextRunContext}
                  playerPoints={session.totalScore}
                  upgrades={session.upgrades}
                  ownedUpgradeIds={session.ownedUpgradeIds}
                  completedLevel={session.currentLevelIndex + 1}
                  isLocked={session.isUpgradeLocked}
                  onPurchase={session.handlePurchaseUpgrade}
                  onContinue={session.handleContinueFromShop}
                  accentColor={accentHex}
                  pipeline={session.betweenMapPlan}
                  // The shelf as dealt, kept with the run save: a run closed in
                  // the store reopens this shelf rather than a new roll.
                  dealt={session.storeDealt}
                  onDealt={session.handleShopDealt}
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
                  // The run's Specialisation leans the shelf toward its tag.
                  lean={session.shopLean}
                  interestPaid={session.storeInterestPaid}
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
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'capstoneDraft' && (
              <CanvasLayer id="screen-CapstoneDraftScreen" z={10}>
                <CapstoneDraftScreen
                  offers={session.capstoneOffers}
                  onSelect={session.handleSelectCapstone}
                  accentColor={accentHex}
                  pipeline={session.betweenMapPlan}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'result' && navigation.lastResult && (
              <CanvasLayer id="screen-ResultScreen" z={10}>
                <ResultScreen
                  result={navigation.lastResult}
                  onMainMenu={navigation.goToWelcome}
                  onPlayAgain={session.handlePlayAgain}
                  onRestart={session.handleRestartRun}
                  checkpointLevel={session.certStartingLevel}
                  accentColor={accentHex}
                  runHoursAwarded={session.lastRunHoursAwarded}
                  runLevelsCompleted={session.lastRunLevelsCompleted}
                  newlyUnlockedOffers={session.lastRunOfferUnlocks}
                  runRecap={session.lastRunRecap}
                  runRank={session.lastRunRank}
                  dailyKey={session.dailyKey}
                  onRecords={session.topRuns.length > 0 ? () => openHallFrom('result') : undefined}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'certificateStore' && (
              <CanvasLayer id="screen-CertificateStore" z={10}>
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
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'offers' && (
              <CanvasLayer id="screen-OffersScreen" z={10}>
                <OffersScreen
                  catalogue={getOfferCatalogue()}
                  unlock={{ highestLevelReached: session.metaStats.highestLevelReached, metArchetypes: session.metArchetypes }}
                  onBack={navigation.goToWelcome}
                  accentColor={accentHex}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'hallOfFame' && (
              <CanvasLayer id="screen-HallOfFameScreen" z={10}>
                <HallOfFameScreen
                  topRuns={session.topRuns}
                  monthlyBests={session.monthlyBests}
                  dailyBests={session.dailyBests}
                  dailyStreak={session.dailyStreak}
                  metaStats={session.metaStats}
                  onBack={handleHallBack}
                  accentColor={accentHex}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'jukebox' && musicCatalogue && (
              <CanvasLayer id="screen-JukeboxScreen" z={10}>
                <JukeboxScreen
                  catalogue={musicCatalogue}
                  onBack={navigation.goToWelcome}
                  accentColor={accentHex}
                  // The jukebox owns the speakers while it is open: the menu loop
                  // playing under a track the player chose is just two songs.
                  onEnter={stopMusic}
                  onExit={playMainMusic}
                />
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'achievements' && (
              <CanvasLayer id="screen-AchievementsScreen" z={10}>
                <AchievementsScreen
                  achievements={session.achievements}
                  completedIds={session.completedAchievementIds}
                  activatedIds={session.activatedAchievementIds}
                  metaStats={session.metaStats}
                  onActivate={session.activateAchievement}
                  onBack={navigation.goToWelcome}
                  accentColor={accentHex}
                />
              </CanvasLayer>
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
              <CanvasLayer id="screen-PairLobby" z={10}>
                <Suspense fallback={null}>
                  <PairLobby
                    onBack={navigation.goToWelcome}
                    onPaired={setPaired}
                  />
                </Suspense>
              </CanvasLayer>
            )}
            {navigation.currentScreen === 'pairLobby' && pair.phase === 'deciding' && (
              <CanvasLayer id="screen-PairDecision" z={10}>
                <Suspense fallback={null}>
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
              </CanvasLayer>
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
          </div>
      </div>

      {/* The shared backdrop for every canvas screen (OWN_BACKGROUND_SCREENS
          draw their own). Under the interface canvas, over nothing. */}
      {!OWN_BACKGROUND_SCREENS.includes(navigation.currentScreen) && <CRTBackground accentColor={accentHex} />}

      {/* App-wide overlays, over whichever screen is up. None of them locks the
          page itself: the screen beneath does, except in the admin Playground,
          whose DOM controls must keep scrolling. */}
      <CanvasLayer id="level-complete" z={30} lock={false}>
        {session.showLevelComplete && session.pendingLevelScore && (
          <LevelCompleteOverlay
            scoreData={session.pendingLevelScore}
            totalScore={session.totalScore}
            onContinue={session.handleContinueFromOverlay}
            onSkipStore={session.handleSkipStoreFromOverlay}
            accentColor={accentHex}
            newlyUnlockedCerts={session.pendingCertUnlocks}
            pipeline={session.betweenMapPlan}
          />
        )}
      </CanvasLayer>

      <CanvasLayer id="continue-prompt" z={40} lock={false}>
        {session.pendingDeathResult && (
          <ContinuePrompt
            continuesRemaining={session.continuesRemaining}
            onSpend={session.handleSpendContinue}
            onDecline={session.handleDeclineContinue}
            accentColor={accentHex}
          />
        )}
      </CanvasLayer>

      <CanvasLayer id="pair-overlays" z={50} lock={false}>
        {guestGate && <PairGuestGate what={guestGate} remoteName={pair.remoteName} />}
        {pair.modifierMismatch && <PairMismatchNotice remoteName={pair.remoteName} onLeave={leavePair} />}
      </CanvasLayer>

      <CanvasLayer id="feature-unlocked" z={60} lock={false}>
        <FeatureUnlockedModal
          feature={session.unlockedFeature}
          onDismiss={session.handleDismissFeatureUnlocked}
        />
      </CanvasLayer>

      <CanvasLayer id="tap-to-start" z={100} lock={false}>
        <TapToStartGate accentColor={accentHex} />
      </CanvasLayer>

      {/* The interface canvas (CANVAS_UI_PLAN.md): one for every screen but
          the DOM admin tools. Screens draw on it through <CanvasLayer>. */}
      {!DOM_ONLY_SCREENS.includes(navigation.currentScreen) && <CanvasUiRoot />}
    </>
  );
}

export default Index;

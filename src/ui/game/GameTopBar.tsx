/**
 * GameTopBar: the compact status bar above the board (canvas port of
 * components/game/GameTopBar.tsx). Level, lives, the goal tracker and, with
 * the Benchmarking certificate, highscore progress. Tapping either row (or
 * swiping down on it) opens TopBarDetailsPanel, which holds the run's build,
 * upgrades, assignment and attributes.
 *
 * Exactly topBarHeight(showHighscoreBar) tall and the screen's full width,
 * whatever it shows: the board below is laid out against that height once and
 * must never move after it appears (hudMetrics.ts). The parent places it at
 * the top of the screen.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Target, ChevronDown, RotateCcw, TrendingUp, Gauge } from "lucide-react";
import { everyRequirementMet, goalAtRisk, type Goal } from "@/lib/goalTracker";
import {
  COLOR, Icon, Label, Modal, ProgressBar, RADIUS, ScrollView, TEXT, View,
  HOLD_MS, hex, tint, useTween, useUiScreen,
} from "../kit/ui";
import { HUD, topBarHeight } from "./hudMetrics";
import { GoalChip } from "./GoalChip";
import { ScreenOverlay } from "./bottomOverlay";
import { StatFlash } from "./TopBarFlash";
import { useTapOrSwipeDown } from "./topBarGestures";
import { filledIcon } from "./topBarIcons";
import { HEART_PULSE_MS, highscoreBar, spaceDetail as spaceDetailOf } from "./topBarModel";

interface CertificateHourProgress {
  levelsCompleted: number;
  levelsToNextHour: number;
  progressInCurrentHour: number;
  hoursEarned: number;
  levelsPerHour: number;
}

interface GameTopBarProps {
  levelNumber: number;
  cutsUsed: number;
  parCuts: number;
  lives: number;
  continuesRemaining?: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  threadLockRequired?: number;
  /**
   * Every goal this map has, with live progress, in authored order: the win
   * clauses, plus the space and lock readouts on maps that do not require them,
   * plus the fence budget. See lib/goalTracker.ts for what the tiers mean.
   */
  goals?: Goal[];
  /** Balls still in play; at one, an outstanding gate becomes a warning. */
  ballsInPlay?: number;
  /** Opens the "How to win" text, which carries the full wording. */
  onExplainWin?: () => void;
  /** Scope Creep speed boost in percent (0 = inactive, chip hidden). */
  scopeCreepPercent?: number;
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  // Map highscore progress (#45): shown only with the Benchmarking certificate and
  // when this map has a stored highscore. current = live projected score.
  showHighscoreBar?: boolean;
  highscoreCurrent?: number;
  highscoreTarget?: number;
  /** Opens the Specs panel (TopBarDetailsPanel). */
  onExpand?: () => void;
}

/** rgba(0, 10, 5, 0.9): both rows' ground. */
const BAR_BG = tint(0x000a05, 0.9);
const SCOPE_CREEP = 0xff6b6b;
const RECORD = 0xffd54a;
const CHASING = 0xffb020;

export function GameTopBar({
  levelNumber,
  lives,
  continuesRemaining = 0,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  goals,
  ballsInPlay = 99,
  onExplainWin,
  scopeCreepPercent = 0,
  accentColor = "#00ff88",
  showHighscoreBar = false,
  highscoreCurrent = 0,
  highscoreTarget = 0,
  onExpand,
}: GameTopBarProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  // One answer to "is this map won", shared by every chip that claims it.
  const winMet = everyRequirementMet(goals ?? []);
  // Tap either row, or swipe down on it: both open Specs (topBarGestures.ts).
  const gesture = useTapOrSwipeDown(onExpand);

  // Space readout hold-detail: exact remaining/cleared numbers behind the
  // CLEAR / "% to go" chip (handy mid Push Your Luck, when the chip just says
  // CLEAR but the board is still shrinking).
  const [spaceDetail, setSpaceDetail] = useState(false);
  const spaceHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSpaceHold = () => {
    if (spaceHoldTimer.current) { clearTimeout(spaceHoldTimer.current); spaceHoldTimer.current = null; }
  };
  const startSpaceHold = () => {
    cancelSpaceHold();
    spaceHoldTimer.current = setTimeout(() => setSpaceDetail(true), HOLD_MS);
  };
  useEffect(() => cancelSpaceHold, []);

  // ── Per-stat flash keys (each increment replays the flash) ───────────────
  const [spaceFlashKey, setSpaceFlashKey] = useState(0);
  const [livesFlashKey, setLivesFlashKey] = useState(0);
  const [locksFlashKey, setLocksFlashKey] = useState(0);
  const [creepFlashKey, setCreepFlashKey] = useState(0);
  const prevSpaceRef = useRef(spaceRemaining);
  const prevLivesRef = useRef(lives);
  const prevLocksRef = useRef(lockedBalls);
  const prevCreepRef = useRef(scopeCreepPercent);
  const flash = useCallback((set: Dispatch<SetStateAction<number>>) => set(k => k + 1), []);
  useEffect(() => {
    if (spaceRemaining < prevSpaceRef.current) flash(setSpaceFlashKey);
    prevSpaceRef.current = spaceRemaining;
  }, [spaceRemaining, flash]);
  useEffect(() => {
    if (lives < prevLivesRef.current) flash(setLivesFlashKey);
    prevLivesRef.current = lives;
  }, [lives, flash]);
  useEffect(() => {
    if (lockedBalls > prevLocksRef.current) flash(setLocksFlashKey);
    prevLocksRef.current = lockedBalls;
  }, [lockedBalls, flash]);
  useEffect(() => {
    // Each Scope Creep surge pulses the chip so the escalation is felt.
    if (scopeCreepPercent > prevCreepRef.current) flash(setCreepFlashKey);
    prevCreepRef.current = scopeCreepPercent;
  }, [scopeCreepPercent, flash]);

  return (
    <View layout={{ width: screen.width, height: topBarHeight(showHighscoreBar), flexShrink: 0 }}>
      {/* Rows 1 and 2 share one gesture surface: tap or swipe down = Specs. */}
      <layoutContainer layout={{ flexDirection: "column" }} {...gesture}>
        {/* Row 1: level, lives, and the expand chevron */}
        <View layout={{ height: HUD.topRow1, backgroundColor: BAR_BG }}>
          <View layout={{
            flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
            paddingLeft: 12, paddingRight: 12,
          }}>
            {/* Level number */}
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Label text={`LV${levelNumber}`} font="display" size={TEXT.base} weight="700" color={accent} glow={10} />
            </View>

            {/* Lives (+ banked Continues) */}
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* One heart + a counter: a pile of hearts broke the top-bar
                  layout once extra-life upgrades stacked up. */}
              <StatFlash flashKey={livesFlashKey} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <PulsingHeart color={accent} />
                <Label text={String(lives)} font="display" size={TEXT.sm} weight="700" color={accent} />
              </StatFlash>
              {continuesRemaining > 0 && (
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Icon icon={RotateCcw} size={16} color={accent} />
                  <Label text={String(continuesRemaining)} font="display" size={TEXT.sm} weight="700" color={accent} />
                </View>
              )}
            </View>

            {/* Certificate hours have moved off the permanent bar: they are a
                between-run currency rather than map state, and the Specs panel
                already renders them in full. */}

            {/* Expand indicator, only when there is a panel to open */}
            {onExpand && <Icon icon={ChevronDown} size={16} color={accent} alpha={0.5} />}
          </View>
          <View layout={{ height: 1, backgroundColor: tint(accent, 0x33 / 255) }} />
        </View>

        {/* Row 2: the goal tracker.
            One row, one notation: the win spec, in the order the Acceptance
            Criteria modal states it, and the budget after. Scrolls rather than
            wraps: a map can carry four requirements and this is one line on a
            phone. A fixed height, not a content height: the goals arrive a
            commit after the screen mounts, and a row that grew when they did
            pushed the whole board down after it had been placed. */}
        <View layout={{ height: HUD.topRow2, backgroundColor: BAR_BG }}>
          <ScrollView direction="horizontal" layout={{ flex: 1, alignItems: "center", gap: 16, paddingLeft: 12, paddingRight: 12 }}>
            {(goals ?? []).map(g => (
              <GoalChip
                key={g.key}
                goal={g}
                accentColor={accentColor}
                // The space chip says CLEAR for the whole map, so it is told
                // whether the whole map is actually won. See everyRequirementMet.
                winMet={winMet}
                atRisk={goalAtRisk(g, ballsInPlay)}
                flashKey={g.kind === "space" ? spaceFlashKey : g.kind === "locks" ? locksFlashKey : 0}
                // Space keeps its own hold-for-detail readout. Everything else
                // taps straight to "How to win", which carries the wording for
                // every goal on the bar.
                onExplain={g.kind === "space" ? () => setSpaceDetail(true) : onExplainWin}
                onHoldStart={g.kind === "space" ? startSpaceHold : undefined}
                onHoldEnd={g.kind === "space" ? cancelSpaceHold : undefined}
              />
            ))}

            {/* Scope Creep: appears once the anti-stall speed surge kicks in */}
            {scopeCreepPercent > 0 && (
              <View
                label={t("topBar.scopeCreepTitle", { percent: scopeCreepPercent })}
                layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Icon icon={Gauge} size={16} color={SCOPE_CREEP} />
                <StatFlash flashKey={creepFlashKey}>
                  <Label
                    text={t("topBar.scopeCreepValue", { percent: scopeCreepPercent })}
                    font="display" size={TEXT.sm} weight="700" color={SCOPE_CREEP} glow={10}
                  />
                </StatFlash>
              </View>
            )}
          </ScrollView>
          <View layout={{ height: 2, backgroundColor: tint(accent, 0x44 / 255) }} />
        </View>
      </layoutContainer>

      {/* Highscore progress (#45). The row is reserved whenever the bar says it
          shows, so the height never waits on the target arriving. */}
      {showHighscoreBar && (
        <HighscoreRow
          accent={accent}
          spaceRemaining={spaceRemaining}
          spaceRequired={spaceRequired}
          current={highscoreCurrent}
          target={highscoreTarget}
        />
      )}

      {/* The full-width SPECS button used to sit under here; it moved to the
          control row with the other controls. The row taps, the swipe and the
          chevron stay as shortcuts that cost no space. */}

      {/* Hold-detail for the Space readout: exact remaining/cleared numbers.
          Reads live, so during Push Your Luck you can watch the board shrink.
          Its own layer over the whole screen: drawn inside the bar, the bottom
          stack (drawn after the bar) would cover its backdrop and stay
          tappable through it. */}
      {spaceDetail && (
        <ScreenOverlay>
          <SpaceDetailModal
            accent={accent}
            spaceRemaining={spaceRemaining}
            spaceRequired={spaceRequired}
            onClose={() => setSpaceDetail(false)}
          />
        </ScreenOverlay>
      )}
    </View>
  );
}

/** The lives heart, filled and breathing (`animate-pulse-heart`). */
function PulsingHeart({ color }: { color: number }) {
  return (
    <StatFlash breatheMs={HEART_PULSE_MS}>
      <Icon icon={filledIcon(Heart, color)} size={20} color={color} />
    </StatFlash>
  );
}

interface HighscoreRowProps {
  accent: number;
  spaceRemaining: number;
  spaceRequired: number;
  current: number;
  target: number;
}

/**
 * Capture progress toward clearing the map (top bar) over the live projected
 * score against the map highscore (bottom bar).
 */
function HighscoreRow({ accent, spaceRemaining, spaceRequired, current, target }: HighscoreRowProps) {
  const { t } = useTranslation();
  const bar = highscoreBar(spaceRemaining, spaceRequired, current, target);
  // The DOM bars eased their width over 300ms.
  const capture = useTween(bar?.captureFraction ?? 0, 0.3);
  const hs = useTween(bar?.hsFraction ?? 0, 0.3);
  const track = tint(COLOR.white, 0.12);
  return (
    <View layout={{ height: HUD.highscoreRow, paddingTop: 6, paddingLeft: 12, paddingRight: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
      {bar && (
        <>
          <Icon icon={TrendingUp} size={14} color={bar.beat ? RECORD : CHASING} />
          <View layout={{ flex: 1, gap: 4 }}>
            <ProgressBar value={capture} color={accent} track={track} height={4} />
            <ProgressBar value={hs} color={bar.beat ? RECORD : CHASING} track={track} height={4} />
          </View>
          <Label
            text={bar.percent === null ? t("topBar.recordPace") : `${bar.percent}%`}
            font="display" size={10} weight="700"
            color={bar.beat ? RECORD : COLOR.mutedForeground}
            glow={bar.beat ? 8 : undefined}
          />
        </>
      )}
    </View>
  );
}

interface SpaceDetailModalProps {
  accent: number;
  spaceRemaining: number;
  spaceRequired: number;
  onClose: () => void;
}

/** Backdrop tap or the X closes it (the game's standard explainer). */
function SpaceDetailModal({ accent, spaceRemaining, spaceRequired, onClose }: SpaceDetailModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const d = spaceDetailOf(spaceRemaining, spaceRequired);
  return (
    <Modal screen={screen} onClose={onClose} accent={accent} maxWidth={384}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon icon={Target} size={28} color={accent} />
        <View layout={{ flex: 1, gap: 2 }}>
          <Label text={t("topBar.spaceTitle")} size={10} upper letterSpacing={0.5} color={COLOR.mutedForeground} />
          <Label
            text={d.goalMet ? t("topBar.spaceGoalReached") : t("topBar.percentToGo", { percent: d.toGo })}
            size={TEXT.base} weight="700" color={d.goalMet ? accent : COLOR.foreground}
          />
        </View>
      </View>
      <View layout={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <View>
          <Label text={t("topBar.spaceLeft")} size={10} upper letterSpacing={0.5} color={COLOR.mutedForeground} />
          <Label text={`${d.remaining}%`} font="display" size={TEXT["3xl"]} weight="700" color={accent} glow={12} />
        </View>
        <View layout={{ alignItems: "flex-end" }}>
          <Label text={t("topBar.spaceCleared")} size={10} upper letterSpacing={0.5} color={COLOR.mutedForeground} />
          <Label text={`${d.cleared}%`} font="display" size={TEXT["3xl"]} weight="700" color={COLOR.foreground} />
        </View>
      </View>
    </Modal>
  );
}

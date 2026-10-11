/**
 * The play gallery's sample wrappers (play.tsx): placement, another locale,
 * and the samples that keep state, apart so play.tsx exports only entries.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { Goal } from "@/lib/goalTracker";
import { ABILITIES_SEEN_KEY } from "@/lib/abilitySeen";
import type { GameMessage, GameMessageId } from "@/lib/gameMessages";
import { COLOR, Label, TEXT, View, useUiScreen } from "../../kit/ui";
import { GameTopBar } from "../../game/GameTopBar";
import { PlayChips } from "../../game/PlayChips";
import { FenceSlotBar } from "../../game/FenceSlotBar";
import { AbilityBar } from "../../game/AbilityBar";
import { ShipEarlyBar } from "../../game/ShipEarlyBar";
import { GameMessageBar } from "../../game/GameMessageBar";
import { PushExitBar } from "../../game/PushExitBar";
import { ControlsRow } from "../../game/ControlsRow";
import { PlayLayout } from "../../game/PlayLayout";
import { bottomStackHeight, topBarHeight } from "../../game/hudMetrics";
import { ACCENT, BASIC_GOALS, CHARGES, noop } from "./playData";

// ── Placement ──────────────────────────────────────────────────────────────

/** At the bottom edge, full width, as PlayLayout puts the bottom stack. */
export function Bottom({ children }: { children: ReactNode }) {
  const screen = useUiScreen();
  return <View layout={{ position: "absolute", left: 0, bottom: 0, width: screen.width }}>{children}</View>;
}

/** A centred column of samples with a caption over each, for the small pieces. */
export function Samples({ items }: { items: [caption: string, node: ReactNode][] }) {
  const screen = useUiScreen();
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, padding: 16, paddingTop: 48, gap: 14 }}>
      {items.map(([caption, node]) => (
        <View key={caption} layout={{ gap: 4 }}>
          <Label text={caption} size={TEXT.xs} color={COLOR.mutedForeground} />
          {node}
        </View>
      ))}
    </View>
  );
}

/** Full-width pieces stacked down the screen with a gap, to look at several states at once. */
export function Stack({ children }: { children: ReactNode }) {
  const screen = useUiScreen();
  return <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, gap: 10 }}>{children}</View>;
}

/** Draws its children in another locale (Spanish runs longest in this game). */
export function InLocale({ lng, children }: { lng: string; children: ReactNode }) {
  const { i18n } = useTranslation();
  const local = useMemo(() => i18n.cloneInstance({ lng }), [i18n, lng]);
  return <I18nextProvider i18n={local}>{children}</I18nextProvider>;
}

/**
 * Keeps the first-acquire ability explainer from covering the bar: marks the
 * shown abilities seen while mounted, and puts the player's own record back on
 * close, so looking at the gallery never uses up a real explainer.
 */
export function AbilitiesSeen({ ids, children }: { ids: string[]; children: ReactNode }) {
  // In the initialiser, so it lands before the bar's own first-acquire effect.
  const [prev] = useState(() => {
    try {
      const was = localStorage.getItem(ABILITIES_SEEN_KEY);
      localStorage.setItem(ABILITIES_SEEN_KEY, JSON.stringify(ids));
      return was;
    } catch { return null; }
  });
  useEffect(() => () => {
    try {
      if (prev === null) localStorage.removeItem(ABILITIES_SEEN_KEY);
      else localStorage.setItem(ABILITIES_SEEN_KEY, prev);
    } catch { /* storage off: nothing was changed */ }
  }, [prev]);
  return <>{children}</>;
}

// ── Stateful samples ───────────────────────────────────────────────────────

export function TopBarSample(p: { goals: Goal[]; highscore?: boolean; extras?: boolean }) {
  return (
    <GameTopBar
      levelNumber={p.extras ? 24 : 7}
      cutsUsed={3}
      parCuts={8}
      lives={p.extras ? 12 : 3}
      continuesRemaining={p.extras ? 2 : 0}
      spaceRemaining={59}
      spaceRequired={25}
      lockedBalls={1}
      goals={p.goals}
      ballsInPlay={p.extras ? 1 : 3}
      onExplainWin={noop}
      scopeCreepPercent={p.extras ? 35 : 0}
      accentColor={ACCENT}
      ascensionDepth={p.extras ? 3 : 0}
      showHighscoreBar={p.highscore}
      highscoreCurrent={1840}
      highscoreTarget={2600}
      onExpand={noop}
    />
  );
}

export function ControlsSample({ open, admin }: { open: boolean; admin?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(open);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  return (
    <ControlsRow
      accentColor={ACCENT}
      menuOpen={menuOpen}
      onToggleMenu={() => setMenuOpen(o => !o)}
      onCloseMenu={() => setMenuOpen(false)}
      canPause
      isPaused={paused}
      onTogglePause={() => { setMenuOpen(false); setPaused(v => !v); }}
      manualUnread={2}
      onOpenSpecs={noop}
      onOpenWin={noop}
      soundMuted={muted}
      onToggleSound={() => setMuted(m => !m)}
      hasAscensionAnnouncement={!!admin}
      onOpenAscension={noop}
      adminMode={!!admin}
      onOpenTuning={noop}
      onRestart={noop}
      onMainMenu={noop}
    />
  );
}

/**
 * A message held up: the same one re-raised every couple of seconds, as a
 * player retrying an illegal cut would (a new `at`, the same `seq`), so it
 * never expires while it is being looked at.
 */
export function MessageSample({ id }: { id: GameMessageId }) {
  const [msg, setMsg] = useState<GameMessage>(() => ({ id, at: Date.now(), seq: 1 }));
  useEffect(() => {
    const timer = setInterval(() => setMsg(m => ({ ...m, at: Date.now() })), 2000);
    return () => clearInterval(timer);
  }, []);
  return <GameMessageBar message={msg} accentColor={ACCENT} visible />;
}

/** Counts down from the start of the map, a second a second, as the loop does. */
export function ShipEarlySample({ start }: { start: number }) {
  const [seconds, setSeconds] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => (s >= 90 ? start : s + 1)), 1000);
    return () => clearInterval(id);
  }, [start]);
  return <ShipEarlyBar seconds={seconds} ballCount={3} timeLimit={90} visible />;
}

export function FenceSample({ ids, initial }: { ids: string[]; initial: string }) {
  const [selected, setSelected] = useState(initial);
  return (
    <FenceSlotBar slotIds={ids} selectedId={selected} accentColor={ACCENT} onSelect={setSelected} deferAutoInfo />
  );
}

export function AbilitySample({ charges, armed }: { charges: Record<string, number>; armed?: string }) {
  return (
    <AbilitiesSeen ids={Object.keys(charges)}>
      <AbilityBar charges={charges} accentColor={ACCENT} onUse={noop} armedAbilityId={armed ?? null} />
    </AbilitiesSeen>
  );
}

/** The whole play screen's HUD around an empty board, as GameScreen stacks it. */
export function WholeHud({ abilities, pushExit }: { abilities: boolean; pushExit: boolean }) {
  const screen = useUiScreen();
  const top = topBarHeight(false);
  const bottom = bottomStackHeight({ mapComplete: false, hasFenceTypes: true, hasAbilities: abilities, pushExit });
  return (
    <PlayLayout
      topHeight={top}
      top={<TopBarSample goals={BASIC_GOALS} />}
      region={r => (
        <>
          {/* Where the board goes. */}
          <View layout={{
            position: "absolute", left: r.x + 8, top: r.y + 8, width: r.width - 16, height: screen.height - top - bottom - 16,
            borderWidth: 1, borderColor: COLOR.border,
          }} />
          <PlayChips accentColor={ACCENT} top={r.y} freeze={{ left: 2, total: 3 }} derails={null} bands={null} fenceBudget={{ left: 5, total: 9 }} />
        </>
      )}
      bottom={
        <View layout={{ alignSelf: "stretch" }}>
          <FenceSample ids={["ice", "guardrail"]} initial="standard" />
          {abilities && <AbilitySample charges={CHARGES} />}
          <ShipEarlySample start={8} />
          {pushExit && <PushExitBar bonusSoFar={4} onBank={noop} accentColor={ACCENT} />}
          <ControlsSample open={false} />
        </View>
      }
    />
  );
}


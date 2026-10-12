/**
 * Gallery entries: the overlays drawn on and around the board, each over the
 * stand-in board from boardStage.tsx so its position can be judged against
 * the frame.
 */
import i18n from "@/i18n";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { LaunchAim } from "@/lib/launcher";
import type { Vector2 } from "@/types/game";
import type { ScoreDebrief as Debrief } from "@/types/debrief";
import { DEBRIEF_COLORS, debriefDurationMs } from "@/lib/scoreDebrief";
import type { GalleryEntry } from "../galleryTypes";
import { ACCENT, BootDemo, DebriefDemo, PARTNER, Replay, Stage, type FakeBoard } from "./boardStage";
import { BoardAlert } from "../../game/BoardAlert";
import { BoardBoot } from "../../game/BoardBoot";
import { BoardToasts } from "../../game/BoardToasts";
import { DeadlineFrame } from "../../game/DeadlineFrame";
import { InteractiveTutorialOverlay } from "../../game/InteractiveTutorialOverlay";
import { LaunchOverlay } from "../../game/LaunchOverlay";
import { LockDebugOverlay } from "../../game/LockDebugOverlay";
import { PairLinkBanner } from "../../game/PairLinkBanner";
import { PairMismatchNotice } from "../../game/PairMismatchNotice";
import { PairTurnOverlay } from "../../game/PairTurnOverlay";
import { PerfOverlay } from "../../game/PerfOverlay";
import { RubberBandOverlay, type BandTarget } from "../../game/RubberBandOverlay";
import { ScreenFx } from "../../game/ScreenFx";
import { WinGateFrame } from "../../game/WinGateFrame";

const noop = () => {};

/** Balls and a crate scattered over the arena, in world units. */
const BAND_TARGETS: BandTarget[] = [
  { x: 300, y: 320, radius: 14, kind: "ball" },
  { x: 560, y: 380, radius: 14, kind: "ball" },
  { x: 450, y: 600, radius: 14, kind: "ball" },
  { x: 650, y: 650, radius: 22, kind: "object" },
  // Two just ahead of a band pulled down from mid-board, so a drag shows a ring.
  { x: 430, y: 700, radius: 14, kind: "ball" },
  { x: 520, y: 690, radius: 22, kind: "object" },
];

/** A launcher barrel at the bottom of the arena, firing up. */
const BARREL = { x: 430, y: 700, width: 40, height: 120 };
const BARREL_BALL: Vector2 = { x: 450, y: 720 };
const predictUp = (aim: LaunchAim): Vector2[] => [
  BARREL_BALL,
  { x: BARREL_BALL.x + aim.direction.x * 500, y: BARREL_BALL.y + aim.direction.y * 500 },
];

/** A won map's debrief: what scored, in world units, as applyCut would build it. */
const debriefOf = (items: Debrief["items"], notes: Debrief["notes"]): Debrief =>
  ({ items, notes, durationMs: debriefDurationMs(items.length, notes.length) });
const DEBRIEF = debriefOf([
  { kind: "space", box: { x: 560, y: 520, w: 210, h: 180 }, title: { key: "debrief.space" },
    detail: { key: "debrief.spaceDetail", values: { left: 8, target: 15 } }, hours: 6, color: null },
  { kind: "fences", box: { x: 150, y: 140, w: 600, h: 560 }, title: { key: "debrief.fences" },
    detail: { key: "debrief.fencesDetail", values: { used: 4, par: 6 } }, hours: 10, color: DEBRIEF_COLORS.fences },
  { kind: "smash", box: { x: 600, y: 200, w: 70, h: 70 }, title: { key: "debrief.smash" },
    detail: { key: "debrief.smashDetail" }, hours: null, color: DEBRIEF_COLORS.smash },
  { kind: "lock", box: { x: 170, y: 520, w: 150, h: 120 }, title: { key: "debrief.lock" },
    detail: { key: "debrief.lockDetail" }, hours: 12, color: null },
  { kind: "superior", box: { x: 380, y: 260, w: 90, h: 80 }, title: { key: "debrief.superior" },
    detail: { key: "debrief.superiorDetail" }, hours: 24, color: DEBRIEF_COLORS.superior },
], [
  { title: { key: "debrief.shipEarly" }, hours: 9 },
  { title: { key: "debrief.winBonus" }, hours: 5 },
]);
/** A wall of bricks smashed: one tag, a leader to each brick, beside a chest boxed on its own. */
const BRICKS = [0, 1, 2, 3, 4, 5].flatMap(i => [{ x: 250 + i * 64, y: 170, w: 60, h: 22 }, { x: 282 + i * 64, y: 196, w: 60, h: 22 }])
  .filter((_, i) => i % 3 !== 1);
const DEBRIEF_BRICKS = debriefOf([
  { kind: "smash", box: { x: 250, y: 170, w: 412, h: 48 }, members: BRICKS, title: { key: "debrief.smashGroup", values: { n: BRICKS.length } },
    detail: { key: "debrief.smashGroupDetail" }, hours: null, color: DEBRIEF_COLORS.smash },
  { kind: "smash", box: { x: 600, y: 560, w: 110, h: 90 }, title: { key: "debrief.smash" },
    detail: { key: "debrief.smashDetail" }, hours: null, color: DEBRIEF_COLORS.smash },
  { kind: "lock", box: { x: 200, y: 460, w: 160, h: 140 }, title: { key: "debrief.lock" },
    detail: { key: "debrief.lockDetail" }, hours: 14, color: null },
], []);
/** A multi-lock: two balls sealed by one cut, one inside a zone; nothing else scored. */
const DEBRIEF_LOCKS = debriefOf([
  { kind: "zone", box: { x: 200, y: 200, w: 220, h: 200 }, title: { key: "debrief.zone" },
    detail: { key: "debrief.multiDetail", values: { n: 2 } }, hours: 31, color: "#b16cff" },
  { kind: "lock", box: { x: 470, y: 210, w: 230, h: 190 }, title: { key: "debrief.lock" },
    detail: { key: "debrief.multiDetail", values: { n: 2 } }, hours: 18, color: null },
], []);

const region = (b: FakeBoard) => ({ origin: b.origin, width: b.region.width, height: b.region.height });

const toastsBase = (b: FakeBoard) => ({
  origin: b.origin, width: b.size.width, height: b.size.height, boardTopPct: b.boardTopPct, boardFrame: b.frame,
  chestToast: null, beatBanner: null, abilityIconFx: null, armedPrompt: null, bonusPulseKey: 0, screenFlash: "none" as const,
});

export const entries: GalleryEntry[] = [
  { id: "BoardAlert", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={1000}>{k => <BoardAlert urgent seconds={10 - (k % 10)} {...region(b)} />}</Replay>}</Stage>
  ) },
  { id: "BoardAlert-edge", group: "board", render: () => (
    <Stage>{b => <BoardAlert urgent seconds={null} {...region(b)} />}</Stage>
  ) },
  { id: "WinGateFrame", group: "board", render: () => (
    <Stage>{b => <WinGateFrame present outstanding {...region(b)} />}</Stage>
  ) },
  { id: "PairTurnOverlay-yours", group: "board", render: () => (
    <Stage>{b => (
      <Replay everyMs={3000}>{k => (
        <PairTurnOverlay turn={{ view: "yours", seq: k }} partnerName="Ada" myColor={ACCENT} partnerColor={PARTNER} onPass={noop} {...region(b)} />
      )}</Replay>
    )}</Stage>
  ) },
  { id: "PairTurnOverlay-spent", group: "board", render: () => (
    <Stage>{b => (
      <PairTurnOverlay turn={{ view: "yoursSpent", seq: 1 }} partnerName="Ada" myColor={ACCENT} partnerColor={PARTNER} onPass={noop} {...region(b)} />
    )}</Stage>
  ) },
  { id: "PairTurnOverlay-theirs", group: "board", render: () => (
    <Stage>{b => (
      <Replay everyMs={3000}>{k => (
        <PairTurnOverlay turn={{ view: "theirs", seq: k }} partnerName="Bartholomew" myColor={ACCENT} partnerColor={PARTNER} {...region(b)} />
      )}</Replay>
    )}</Stage>
  ) },
  { id: "LockDebugOverlay", group: "board", render: () => (
    <Stage>{b => <LockDebugOverlay visible {...region(b)} />}</Stage>
  ) },
  { id: "DeadlineFrame", group: "board", render: () => (
    <Stage>{b => <DeadlineFrame frame={b.frame} secondsLeft={48} limit={60} origin={b.origin} />}</Stage>
  ) },
  { id: "DeadlineFrame-low", group: "board", render: () => (
    <Stage>{b => <DeadlineFrame frame={b.frame} secondsLeft={8} limit={60} origin={b.origin} />}</Stage>
  ) },
  { id: "DeadlineFrame-milestone", group: "board", render: () => (
    <Stage>{b => (
      <Replay everyMs={2000}>{k => <DeadlineFrame frame={b.frame} secondsLeft={k % 2 ? 30 : 20} limit={60} origin={b.origin} />}</Replay>
    )}</Stage>
  ) },
  // A map opening: the stand-in while the board loads, then the reveal.
  { id: "BoardBoot-waiting", group: "board", render: () => (
    <Stage>{b => <BoardBoot ready={false} runStart={false} accentColor={ACCENT} frame={b.frame} origin={b.origin}
      levelNumber={7} onRevealed={() => {}} />}</Stage>
  ) },
  { id: "BoardBoot", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={4000}>{k => <BootDemo key={k} b={b} runStart={false} waitMs={1500} />}</Replay>}</Stage>
  ) },
  { id: "BoardBoot-runStart", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={5000}>{k => <BootDemo key={k} b={b} runStart waitMs={1500} />}</Replay>}</Stage>
  ) },
  // The map is won: what scored, boxed and tagged, before the board shatters.
  { id: "ScoreDebrief", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={debriefDurationMs(5, 2) + 1500}>{k => <DebriefDemo key={k} b={b} debrief={DEBRIEF} />}</Replay>}</Stage>
  ) },
  { id: "ScoreDebrief-held", group: "board", render: () => (
    <Stage>{b => <DebriefDemo b={b} debrief={DEBRIEF} hold />}</Stage>
  ) },
  { id: "ScoreDebrief-bricks", group: "board", render: () => (
    <Stage>{b => <DebriefDemo b={b} debrief={DEBRIEF_BRICKS} hold />}</Stage>
  ) },
  { id: "ScoreDebrief-locks", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={debriefDurationMs(2, 0) + 1500}>{k => <DebriefDemo key={k} b={b} debrief={DEBRIEF_LOCKS} />}</Replay>}</Stage>
  ) },
  { id: "PerfOverlay", group: "board", render: () => (
    <Stage>{b => <PerfOverlay visible origin={b.origin} />}</Stage>
  ) },
  { id: "InteractiveTutorialOverlay", group: "board", render: () => (
    <Stage>{b => <InteractiveTutorialOverlay tutorialStep="showingHint" isPlayerDragging={false} {...b.canvas} origin={b.origin} />}</Stage>
  ) },
  { id: "InteractiveTutorialOverlay-aimed", group: "board", render: () => (
    <Stage>{b => {
      const { canvasWidth: w, canvasOffsetLeft: l, canvasOffsetTop: t } = b.canvas;
      const at = (u: number) => (u / BOARD_WIDTH) * w;
      return (
        <InteractiveTutorialOverlay tutorialStep="showingHint" isPlayerDragging={false} {...b.canvas} origin={b.origin}
          gesture={{ fromX: l + at(200), fromY: t + at(250), toX: l + at(700), toY: t + at(250) }} />
      );
    }}</Stage>
  ) },
  { id: "RubberBandOverlay", group: "board", render: () => (
    <Stage>{b => (
      <RubberBandOverlay {...b.canvas} origin={b.origin} size={b.size} targets={BAND_TARGETS} onFire={noop} onCancel={noop} />
    )}</Stage>
  ) },
  { id: "LaunchOverlay", group: "board", render: () => (
    <Stage>{b => (
      <LaunchOverlay {...b.canvas} origin={b.origin} size={b.size} ballPosition={BARREL_BALL} loadedCount={3}
        inner={BARREL} facing="up" predict={predictUp} onFire={noop} />
    )}</Stage>
  ) },
  { id: "PairLinkBanner-stalled", group: "board", render: () => (
    <Stage>{b => (
      <PairLinkBanner stalled dropped={false} remoteName="Ada" onRepair={noop} onContinueSolo={noop} region={b.region} />
    )}</Stage>
  ) },
  { id: "PairLinkBanner-dropped", group: "board", render: () => (
    <Stage>{b => (
      <PairLinkBanner stalled={false} dropped remoteName="Ada" onRepair={noop} onContinueSolo={noop} region={b.region} />
    )}</Stage>
  ) },
  { id: "PairMismatchNotice", group: "board", render: () => <PairMismatchNotice remoteName="Ada" onLeave={noop} /> },
  { id: "BoardToasts-chest", group: "board", render: () => (
    <Stage>{b => (
      <Replay everyMs={2000}>{k => (
        <BoardToasts {...toastsBase(b)} chestToast={{ key: k, label: "Coffee Machine", color: "#ffd76b" }} />
      )}</Replay>
    )}</Stage>
  ) },
  { id: "BoardToasts-beat", group: "board", render: () => (
    <Stage>{b => (
      <BoardToasts {...toastsBase(b)} beatBanner={{
        key: 1, announce: "game.beatCrunchTime",
        effects: [{ key: "game.beatEffectBalls", values: { count: 2 } }, { key: "game.beatEffectSpeed", values: { percent: 20 } }],
      }} />
    )}</Stage>
  ) },
  { id: "BoardToasts-ability", group: "board", render: () => (
    <Stage>{b => (
      <Replay everyMs={1500}>{k => (
        <BoardToasts {...toastsBase(b)} abilityIconFx={{ key: k, kind: "freeze", color: "#7fd4ff", xPct: 50, yPct: 45 }} />
      )}</Replay>
    )}</Stage>
  ) },
  { id: "BoardToasts-armed", group: "board", render: () => (
    <Stage>{b => (
      <BoardToasts {...toastsBase(b)} armedPrompt={{ text: "Tap an obstacle to delete it", color: "#ff8fa3" }} />
    )}</Stage>
  ) },
  { id: "BoardToasts-bonus", group: "board", render: () => (
    <Stage>{b => <Replay everyMs={1200}>{k => <BoardToasts {...toastsBase(b)} bonusPulseKey={k} />}</Replay>}</Stage>
  ) },
  { id: "BoardToasts-flash", group: "board", render: () => (
    <Stage>{b => <BoardToasts {...toastsBase(b)} screenFlash="red" />}</Stage>
  ) },
  { id: "ScreenFx-deadline", group: "board", render: () => (
    <Stage>{() => <ScreenFx deadlineUrgent bossPhaseLabel={null} bossDefeated={false} shippedIt={false} />}</Stage>
  ) },
  { id: "ScreenFx-boss", group: "board", render: () => (
    <Stage>{() => <ScreenFx deadlineUrgent={false} bossPhaseLabel={i18n.t("boss.hotfixIncoming")} bossDefeated={false} shippedIt={false} />}</Stage>
  ) },
  { id: "ScreenFx-shipped", group: "board", render: () => (
    <Stage>{() => <ScreenFx deadlineUrgent={false} bossPhaseLabel={null} bossDefeated shippedIt />}</Stage>
  ) },
];

/**
 * Gallery entries: the overlays drawn on and around the board, each over the
 * stand-in board from boardStage.tsx so its position can be judged against
 * the frame.
 */
import i18n from "@/i18n";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { LaunchAim } from "@/lib/launcher";
import type { Vector2 } from "@/types/game";
import type { GalleryEntry } from "../galleryTypes";
import { ACCENT, BootDemo, PARTNER, Replay, Stage, type FakeBoard } from "./boardStage";
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

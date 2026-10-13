/** Gallery entries: modals. */
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import i18n from "@/i18n";
import type { GalleryEntry } from "../galleryTypes";
import { getAllFeatures } from "@/lib/features";
import { getAllFenceTypes, STANDARD_FENCE_ID } from "@/lib/fences";
import { getAllAbilities } from "@/lib/abilities";
import { getMapMutators } from "@/lib/mapMutators";
import { winConditions, winConditionsBody, type Criterion } from "@/lib/winConditions";
import { DEFAULT_MODIFIERS, type GameModifiers, type ModifierSource } from "@/hooks/useActiveModifiers";
import type { MapFailure } from "@/lib/mapFailure";
import type { LevelConfig } from "@/types/level";
import type { UpgradeConfig } from "@/types/upgrade";
import { getOffer } from "@/lib/sprintOffers";
import type { CapstoneConfig } from "@/types/capstone";
import type { ActiveMapObjective } from "@/types/objective";
import { PauseOverlay } from "../../game/PauseOverlay";
import { TutorialOverlay } from "../../game/TutorialOverlay";
import { AcceptanceCriteriaModal } from "../../game/AcceptanceCriteriaModal";
import { BreakArt, CircuitArt, FenceArt, LockArt, MoverArt, PickupArt } from "../../game/TutorialArt";
import { SuperiorLockInfoModal } from "../../game/SuperiorLockInfoModal";
import { LockExplainerModal } from "../../game/LockExplainerModal";
import { BoardEntityInfoModal } from "../../game/BoardEntityInfoModal";
import { MapFailedOverlay } from "../../game/MapFailedOverlay";
import type { AcceptanceRow } from "@/types/game";
import { PushYourLuckOverlay } from "../../game/PushYourLuckOverlay";
import { PairGuestGate } from "../../game/PairGuestGate";
import { FeatureUnlockedModal } from "../../game/FeatureUnlockedModal";
import { TopBarDetailsPanel } from "../../game/TopBarDetailsPanel";
import { MapTuningSample } from "./modalSamples";
import { FenceTypeInfoModal } from "../../game/FenceTypeInfoModal";
import { AbilityInfoModal } from "../../game/AbilityInfoModal";

const t = i18n.t.bind(i18n) as unknown as TFunction;
const noop = () => {};
const ACCENT = "#00ff88";

// ── Sample data ────────────────────────────────────────────────────────────

/** A minimal map: the fields the tuner and the win-conditions body read. */
const LEVEL: LevelConfig = { id: "gallery-sample", level: 4, sizeThreshold: 25, expectedCuts: 6, points: 120 };

const FAILURE: MapFailure = {
  kind: "timeUp",
  unmet: [
    { condition: { kind: "locks", count: 2 }, current: 1, target: 2, met: false, mode: "accumulate" },
    { condition: { kind: "space", threshold: 25 }, current: 41, target: 25, met: false, mode: "accumulate" },
  ],
};

/** The pre-map ticket, marked as a map ran out of time with a lock still owed. */
const FAILED_TICKET: AcceptanceRow[] = [
  { group: "required", text: "Clear 81% of the board.", met: true },
  { group: "required", text: "Lock 2 balls.", met: false },
  { group: "required", text: "Smash 4 of the 10 shards (one touch each).", met: true },
  { group: "fail", text: "The timer runs out (50s).", met: false },
];

const UPGRADES: UpgradeConfig[] = [
  { id: "runtime_optimisation_junior", name: "Runtime Optimisation", tier: "Junior", description: "Reduce ball speed by 5%.", tags: ["safety"], modifiers: { ballSpeedMultiplier: 0.95 } },
  { id: "micro_manager_senior", name: "Micro Manager", tier: "Senior", description: "Each locked ball slows the rest by 4%.", modifiers: { microManagerPerLock: 4 } },
  { id: "pair_programming_principal", name: "Pair Programming With A Very Long Upgrade Name", tier: "Principal", description: "One extra fence can grow at the same time, so two cuts can race across the board together.", modifiers: { additionalConcurrentFences: 1 } },
];

const MODIFIERS: GameModifiers = { ...DEFAULT_MODIFIERS, ballSpeedMultiplier: 0.95, additionalConcurrentFences: 1, microManagerPerLock: 4, extraLives: 1 };

const SOURCES: ModifierSource[] = [
  { kind: "upgrade", id: "runtime_optimisation_junior", name: "Runtime Optimisation", modifiers: { ballSpeedMultiplier: 0.95 } },
  { kind: "upgrade", id: "pair_programming_principal", name: "Pair Programming", modifiers: { additionalConcurrentFences: 1 } },
  { kind: "offer", id: "reliability", name: "Reliability", modifiers: { openingSlowSeconds: 8 } },
];

const OFFER = getOffer("headhunted") ?? null;

const CAPSTONE: CapstoneConfig = {
  id: "gallery-capstone", name: "Tech Lead", description: "Every lock pays 10% more overtime.",
  clarify: "Applies to superior locks too.", modifiers: { scoreMultiplier: 1.1 },
};

const OBJECTIVE: ActiveMapObjective = {
  id: "lockdown", name: "Lockdown", description: "Lock 3 balls on this map.",
  clarify: "Any ball type counts.", kind: "lockCount", params: { count: 3 }, reward: 2,
};

const MUTATOR = getMapMutators()[0] ?? null;

/** The Specs panel with every section filled. A plain function, not a component, so the file exports only `entries`. */
function topBarSample(focus: "mapRule" | null = null) {
  return (
    <TopBarDetailsPanel
      visible focus={focus} onClose={noop}
      levelNumber={4} cutsUsed={7} parCuts={6} lives={2} continuesRemaining={1}
      spaceRemaining={48} spaceRequired={25} lockedBalls={1} threadLockRequired={2}
      ownedUpgrades={UPGRADES} accentColor={ACCENT}
      certificateProgress={{ levelsCompleted: 5, levelsToNextHour: 1, progressInCurrentHour: 2, hoursEarned: 1, levelsPerHour: 3 }}
      microManagerPerLock={4}
      scalingReadouts={[{ upgradeId: "runtime_optimisation_junior", upgradeName: "Runtime Optimisation", tag: "safety", key: "ballSpeedMultiplier", count: 3, effective: 3, steps: 3, amount: -0.06 }]}
      runOffer={OFFER}
      tagCounts={new Map([["safety", 3], ["tempo", 1], ["lock", 2]])} tagSetThreshold={3}
      activeModifiers={MODIFIERS} modifierSources={SOURCES}
      capstone={CAPSTONE} mapMutator={MUTATOR} objective={OBJECTIVE}
      objectiveProgress={{ kind: "lockCount", mode: "accumulate", current: 1, target: 3, met: false }}
    />
  );
}

/** A map with something in every group, from the real strings. */
const RICH_CRITERIA: Criterion[] = [
  { group: "required", text: t("winConditions.clear", { percent: 75 }) },
  { group: "required", text: t("winConditions.underPar", { count: 6 }) },
  { group: "either", text: t("winConditions.allLocked") },
  { group: "optional", text: t("winConditions.areaWin", { target: t("winConditions.targetBall"), area: "CSS", mult: 2 }) },
  { group: "fail", text: t("winConditions.time", { seconds: 90 }) },
  { group: "fail", text: t("winConditions.fences", { count: 10 }) },
];

function tutorial(id: string, graphic: ReactNode, extra: Partial<Parameters<typeof TutorialOverlay>[0]> = {}): GalleryEntry {
  return {
    id, group: "modal",
    render: () => (
      <TutorialOverlay visible onDismiss={noop} accentColor={ACCENT}
        title={t("interactiveTutorial.drawAFence")} body={t("interactiveTutorial.dragInstruction")}
        graphic={graphic} {...extra} />
    ),
  };
}

// ── Entries ────────────────────────────────────────────────────────────────

export const entries: GalleryEntry[] = [
  { id: "PauseOverlay", group: "modal", render: () => <PauseOverlay accentColor={ACCENT} zoomStuck onResume={noop} /> },
  { id: "PauseOverlay-plain", group: "modal", render: () => <PauseOverlay accentColor="#ffb347" zoomStuck={false} onResume={noop} /> },

  tutorial("TutorialOverlay", undefined, { title: t("game.launcherIntroTitle"), body: t("game.launcherIntroBody"), accentColor: "#ffb347" }),
  tutorial("TutorialOverlay-fence", <FenceArt />),
  tutorial("TutorialOverlay-lock", <LockArt />),
  tutorial("TutorialOverlay-mover", <MoverArt />),
  tutorial("TutorialOverlay-break", <BreakArt />),
  tutorial("TutorialOverlay-pickup", <PickupArt />),
  tutorial("TutorialOverlay-circuit", <CircuitArt />, { title: t("game.circuitTutorialTitle"), body: t("game.circuitTutorialBody"), accentColor: "#7fe3d4" }),
  // The pre-map Acceptance Criteria as the map's ticket: every group at once, then a plain map's.
  {
    id: "AcceptanceCriteriaModal", group: "modal",
    render: () => <AcceptanceCriteriaModal criteria={RICH_CRITERIA} levelNumber={14} levelId="lvl-14-gatekeeper" accentColor={ACCENT} onDismiss={noop} />,
  },
  {
    id: "AcceptanceCriteriaModal-plain", group: "modal",
    render: () => <AcceptanceCriteriaModal criteria={winConditions(t, LEVEL, 4, DEFAULT_MODIFIERS)} levelNumber={4} levelId={LEVEL.id} accentColor={ACCENT} onDismiss={noop} />,
  },
  tutorial("TutorialOverlay-list", undefined, { title: t("winConditions.title"), body: winConditionsBody(t, LEVEL, 4, DEFAULT_MODIFIERS), align: "left" }),
  tutorial("TutorialOverlay-spotTop", undefined, { title: t("game.timeLimitTutorialTitle"), body: t("game.timeLimitTutorialBody"), spotlightArea: "top", spotlightHeightPx: 72 }),
  tutorial("TutorialOverlay-spotBottom", undefined, { title: t("game.fenceSlotsTutorialTitle"), body: t("game.fenceSlotsTutorialBody"), spotlightArea: "bottom", spotlightHeightPx: 150 }),

  { id: "SuperiorLockInfoModal", group: "modal", render: () => <SuperiorLockInfoModal onClose={noop} /> },
  { id: "LockExplainerModal", group: "modal", render: () => <LockExplainerModal onClose={noop} /> },

  { id: "BoardEntityInfoModal-mirror", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "mirror" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-dormantBall", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "dormantBall" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-area", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "area", detail: "gate" }} accentColor="#ffb347" onClose={noop} /> },
  { id: "BoardEntityInfoModal-bug", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bugShard", detail: "caffeine" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bugDanger", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bugShard", detail: "bigBang" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bugUnknown", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bugShard" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bombBox", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bombBox" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bombBoxQuiet", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bombBox", detail: "quiet" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bombChestQuiet", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bombChest", detail: "quiet" }} accentColor={ACCENT} onClose={noop} /> },
  { id: "BoardEntityInfoModal-bombShard", group: "modal", render: () => <BoardEntityInfoModal hit={{ kind: "bombShard" }} accentColor={ACCENT} onClose={noop} /> },

  { id: "MapFailedOverlay", group: "modal", render: () => <MapFailedOverlay failure={FAILURE} livesLeft={2} accentColor="#ff2244" onDismiss={noop} /> },
  { id: "MapFailedOverlay-runOver", group: "modal", render: () => <MapFailedOverlay failure={FAILURE} livesLeft={0} runOver accentColor="#ff2244" onDismiss={noop} /> },
  { id: "MapFailedOverlay-ticket", group: "modal", render: () => <MapFailedOverlay failure={FAILURE} acceptance={FAILED_TICKET} levelNumber={9} levelId="level-9" full={false} livesLeft={2} accentColor="#ff2244" onDismiss={noop} /> },
  { id: "MapFailedOverlay-ticketRunOver", group: "modal", render: () => <MapFailedOverlay failure={FAILURE} acceptance={FAILED_TICKET} levelNumber={9} levelId="level-9" full={false} livesLeft={0} runOver accentColor="#ff2244" onDismiss={noop} /> },
  { id: "MapFailedOverlay-full", group: "modal", render: () => <MapFailedOverlay failure={FAILURE} acceptance={FAILED_TICKET} full livesLeft={2} accentColor="#ff2244" onDismiss={noop} /> },
  { id: "MapFailedOverlay-noLines", group: "modal", render: () => <MapFailedOverlay failure={{ kind: "areaUnreachable", unmet: [] }} livesLeft={1} onDismiss={noop} /> },

  { id: "PushYourLuckOverlay", group: "modal", render: () => <PushYourLuckOverlay remainingPercent={18} thresholdPercent={25} basePoints={120} onBank={noop} onPush={noop} /> },
  { id: "PairGuestGate", group: "modal", render: () => <PairGuestGate what="pushing" remoteName="Alex" /> },

  ...getAllFeatures().map((f): GalleryEntry => ({
    id: `FeatureUnlockedModal-${f.id}`, group: "modal",
    render: () => <FeatureUnlockedModal feature={f} onDismiss={noop} />,
  })),

  { id: "TopBarDetailsPanel", group: "modal", render: () => topBarSample() },
  { id: "TopBarDetailsPanel-mapRule", group: "modal", render: () => topBarSample("mapRule") },

  { id: "MapTuningModal", group: "modal", render: () => <MapTuningSample level={LEVEL} /> },

  ...getAllFenceTypes().filter(f => f.id !== STANDARD_FENCE_ID).map((f): GalleryEntry => ({
    id: `FenceTypeInfoModal-${f.id}`, group: "modal",
    render: () => <FenceTypeInfoModal fence={f} onClose={noop} />,
  })),

  ...getAllAbilities().slice(0, 3).map((a): GalleryEntry => ({
    id: `AbilityInfoModal-${a.id}`, group: "modal",
    render: () => <AbilityInfoModal ability={a} onClose={noop} />,
  })),
];

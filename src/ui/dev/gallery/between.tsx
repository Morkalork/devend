/** Gallery entries: the between-map screens (end of map, end of run, shop, drafts). */
import type { GalleryEntry } from "../galleryTypes";
import { hex } from "../../kit/ui";
import type { LevelScoreData, GameResult } from "@/types/game";
import type { Certificate } from "@/types/certificate";
import type { UpgradeConfig } from "@/types/upgrade";
import type { CapstoneConfig } from "@/types/capstone";
import { getOffer, type DealtOffer } from "@/lib/sprintOffers";
import type { TenureOffer } from "@/lib/tenure";
import type { RunRecap } from "@/lib/buildRecap";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { LevelCompleteOverlay } from "../../screens/LevelCompleteOverlay";
import { ResultScreen } from "../../screens/ResultScreen";
import { ContinuePrompt } from "../../screens/ContinuePrompt";
import { UpgradeShop } from "../../screens/UpgradeShop";
import { ChoiceChooserModal, UpgradeDetailModal } from "../../screens/shopParts";
import { ChainPickScreen } from "../../screens/ChainPickScreen";
import { RunDraftScreen } from "../../screens/RunDraftScreen";
import { CapstoneDraftScreen } from "../../screens/CapstoneDraftScreen";
import { PipelineDebriefSample, PipelineStoreSample } from "./pipelineSample";

const ACCENT = "#00ff88";
const noop = () => {};

// ── Fixtures (shapes from public/*.yml; ids are real so the locales resolve) ──

const certs: Certificate[] = [
  { id: "memory-compression", name: "Memory Compression", description: "", unlockType: "upgrade-chain", sourceUpgradeId: "memory_footprint_principal", requiredRuns: 3, levels: [] },
  { id: "compile-cache", name: "Compile Cache", description: "", unlockType: "upgrade-chain", sourceUpgradeId: "fast_compile_principal", requiredRuns: 3, levels: [] },
];

/** A map that paid well and pushed every row of the breakdown onto the card. */
const fullScore: LevelScoreData = {
  levelNumber: 10, levelId: "lvl-10-pipeline", levelName: "Release Deadline", levelPremise: "The one where the release candidate has to be fenced into the syntax box before it ships.", cutCount: 5, expectedCuts: 6, basePoints: 20, levelScore: 96, remainingPercent: 18,
  multipliedBase: 22, mapCeiling: 110, performanceMultiplier: 1, fencesUnderPar: 1, underParBonus: 4, extraPercent: 0.12, spaceBonus: 6, spaceBonusRaw: 6,
  axes: {
    delivery: 18, craft: 14, tempo: 6, thrift: 4, greed: 6, engagement: 5, total: 53,
    ratios: { delivery: 1, craft: 1, tempo: 0.5, thrift: 0.5, greed: 0.6, engagement: 0.5 },
    ceilings: { delivery: 18, craft: 14, tempo: 12, thrift: 8, greed: 10, engagement: 10 },
  },
  lockedBallsCount: 3, superiorLockCount: 3, zoneLockCount: 1, zoneCount: 2, zoneShareWithheld: 0,
  winBonus: 8, winBonusPercent: 10, bouncerOvertime: 3, pickupBonus: 4, qualifiedOvertime: 2, capBonus: 5,
  winReason: "allLocked", alsoClearedSpace: true,
};

/** A rough map: over par, the push failed, the zones skipped, a pair. */
const roughScore: LevelScoreData = {
  levelNumber: 7, levelId: "lvl-07-crossfire", cutCount: 9, expectedCuts: 6, basePoints: 20, levelScore: 31, remainingPercent: 24,
  multipliedBase: 14, mapCeiling: 90, performanceMultiplier: 0.7, fencesOverPar: 3, extraPercent: 0.08, spaceBonus: 0, spaceBonusRaw: 5,
  axes: {
    delivery: 9, craft: 2, tempo: 0, thrift: 0, greed: 4, engagement: 0, total: 15,
    ratios: { delivery: 0.5, craft: 0.15, tempo: 0, thrift: 0, greed: 0.4, engagement: 0 },
    ceilings: { delivery: 18, craft: 14, tempo: 12, thrift: 8, greed: 10, engagement: 0 },
  },
  lockedBallsCount: 2, superiorLockCount: 0, zoneCount: 2, zoneShareWithheld: 4, pushFailed: true, pushBonus: 6, fencesByPlayer: [5, 4],
  winReason: "space",
};

/** The map's Acceptance Criteria, marked, as the ticket Debrief draws them. */
const ticketScore: LevelScoreData = {
  ...fullScore,
  acceptance: [
    { group: "required", text: "Clear 82% of the board.", met: true },
    { group: "required", text: "Smash 4 shards (one touch each).", met: true },
    { group: "required", text: "Lock a ball in the light syntax area (x2 pay).", met: true },
    { group: "optional", text: "Lock a ball in the dark syntax area for x3 pay. Skipping it costs nothing.", met: false },
    { group: "fail", text: "The timer runs out (60s).", met: true },
  ],
};

/** A win by its "or": the goals were not all met, and a fence budget ran close. */
const ticketMissedScore: LevelScoreData = {
  ...roughScore,
  acceptance: [
    { group: "required", text: "Clear 76% of the board.", met: false },
    { group: "required", text: "Lock 2 balls.", met: true },
    { group: "either", text: "Every ball locked", met: true },
    { group: "trade", text: "With only 6 fences, the bonus pocket and a clean clear compete.", met: false },
    { group: "fail", text: "You use all 6 fences without winning.", met: true },
  ],
};

const recap: RunRecap = {
  primary: "lock", secondary: "tempo", tagCounts: { lock: 5, tempo: 3, bank: 2, safety: 1 },
  capstoneId: "stock_options", capstoneName: "Stock Options",
};

const winResult: GameResult = {
  isWin: true, remainingPercent: 12, levelId: "lvl-35-release", levelNumber: 35, completedAllLevels: true, totalScore: 1840,
};

const lossResult: GameResult = {
  isWin: false, remainingPercent: 41, levelId: "lvl-14-gatekeeper", levelNumber: 14, totalScore: 412,
  failure: {
    kind: "timeUp",
    unmet: [
      { condition: { kind: "locks", count: 3 }, current: 1, target: 3, met: false, mode: "accumulate" },
      { condition: { kind: "space", threshold: 25 }, current: 41, target: 25, met: false, mode: "accumulate" },
    ],
  },
};

const up = (u: Partial<UpgradeConfig> & Pick<UpgradeConfig, "id" | "name" | "tier" | "description">): UpgradeConfig => ({ modifiers: {}, unlockLevel: 1, ...u });

/** A catalogue sized so the shelf (5 slots) fills: four open offers and one locked teaser. */
const shopUpgrades: UpgradeConfig[] = [
  up({ id: "fast_compile_junior", name: "Fast Compile", tier: "Junior", cost: 25, tags: ["tempo"], icon: "fast-forward", description: "Increase fence generation speed by 10%." }),
  up({ id: "fast_compile_senior", name: "Fast Compile", tier: "Senior", cost: 34, prerequisites: ["fast_compile_junior"], tags: ["tempo"], description: "Increase fence generation speed by 20%." }),
  up({ id: "memory_footprint_senior", name: "Memory Footprint", tier: "Senior", cost: 34, tags: ["safety"], icon: "memory-stick", description: "Reduce ball size by 10%." }),
  up({ id: "performance_bonus_junior", name: "Performance Bonus", tier: "Junior", cost: 34, tags: ["bank"], icon: "trending-up", description: "Gain 5% more overtime per map." }),
  up({ id: "code_review", name: "Code Review", tier: "Junior", cost: 34, tags: ["lock"], icon: "clipboard-check", description: "A pocket up to 3% over the lock limit still locks its ball." }),
  up({ id: "memory_footprint_principal", name: "Memory Footprint", tier: "Principal", cost: 70, prerequisites: ["memory_footprint_senior"], choiceGroup: "memory_footprint_principal", tags: ["safety"], description: "Reduce ball size by 15%." }),
  up({ id: "memory_footprint_principal_b", name: "Memory Footprint", tier: "Principal", cost: 70, prerequisites: ["memory_footprint_senior"], choiceGroup: "memory_footprint_principal", tags: ["safety"], condition: { kind: "mapHas", feature: "mover" }, description: "On maps with a mover, balls 5% smaller, and the lock threshold widens by 8." }),
  up({ id: "multithreading_principal", name: "Multithreading", tier: "Principal", cost: 62, prerequisites: ["fast_compile_senior"], tags: ["tempo"], icon: "split", description: "Allow one additional fence to be in progress simultaneously." }),
  up({ id: "hot_start_principal", name: "Hot Start", tier: "Principal", cost: 62, prerequisites: ["hot_start_junior"], tags: ["tempo"], icon: "flame", description: "First two fences in each map generate instantly." }),
  up({ id: "hot_start_junior", name: "Hot Start", tier: "Senior", cost: 45, unlockLevel: 99, prerequisites: ["fast_compile_senior"], tags: ["tempo"], description: "First fence in each map generates instantly." }),
];
const shopOwned = ["fast_compile_junior", "fast_compile_senior", "memory_footprint_senior"];
const shopById = new Map(shopUpgrades.map(u => [u.id, u]));
const isLocked = (id: string, owned: string[]) => {
  const u = shopById.get(id);
  return !u || !(u.prerequisites ?? []).every(p => owned.includes(p));
};
const shopMods = { ...DEFAULT_MODIFIERS, spendInstantFencePerChunk: 1, runwayInstantFenceAt: 25, runwayConcurrentFenceAt: 150 };

const shopProps = {
  playerPoints: 120, upgrades: shopUpgrades, ownedUpgradeIds: shopOwned, completedLevel: 10, isLocked,
  onPurchase: noop, onContinue: noop, accentColor: ACCENT, extraShopItems: 2, shopRestockCount: 2, shopDiscountMultiplier: 0.9,
  certificates: certs, maxTierCounts: { memory_footprint_principal: 1 }, activeModifiers: shopMods,
  mapsRemaining: 25, abilityOfferCount: 1, onPurchaseAbility: noop,
};

const tenureOffers: TenureOffer[] = [
  {
    headId: "fast_compile_junior", name: "Fast Compile",
    upgrades: [shopUpgrades[0], shopUpgrades[1]],
  },
  {
    headId: "runtime_optimisation_junior", name: "Runtime Optimisation",
    upgrades: [
      up({ id: "runtime_optimisation_junior", name: "Runtime Optimisation", tier: "Junior", description: "Reduce ball speed by 5%." }),
      up({ id: "runtime_optimisation_senior", name: "Runtime Optimisation", tier: "Senior", description: "Reduce ball speed by 10%." }),
    ],
  },
  {
    headId: "performance_bonus_junior", name: "Performance Bonus",
    upgrades: [shopUpgrades[3]],
  },
];

// Sprint Planning samples, from the real offers.yml so the copy is the shipped copy.
const offer = (id: string) => getOffer(id)!;
const sprintCards: DealtOffer[] = [
  { offer: offer("onboarding_buddy"), grants: [] },
  { offer: offer("reliability"), grants: [] },
  { offer: offer("death_march"), grants: tenureOffers[0].upgrades },
];
const sprintCardsTenure: DealtOffer[] = [
  { offer: offer("tenure"), grants: tenureOffers[0].upgrades, tenure: { earnedAtLevel: 22, continued: true } },
  { offer: offer("containment"), grants: [] },
  { offer: offer("unicorn"), grants: [...tenureOffers[0].upgrades, shopUpgrades[2]] },
];

const capstones: CapstoneConfig[] = [
  { id: "stock_options", name: "Stock Options", tag: "risk", modifiers: {}, description: "The per-map overtime cap rises by 5h for the rest of the run. Big multiplier builds finally pay.", clarify: "Overtime is capped per map, so multipliers past the cap are wasted. This raises the cap by 5h every map. Useless on a low-multiplier build, run-defining on a stacked one." },
  { id: "company_card", name: "Company Card", tag: "bank", modifiers: {}, description: "The cheapest offer in every shop is free.", clarify: "The cheapest upgrade in every shop is free. Over a run that is a lot of saved overtime for the expensive picks. Best if you shop every level." },
  { id: "second_wind", name: "Second Wind", tag: "safety", modifiers: {}, description: "Once per map, a fence survives a ball hit without costing a life.", clarify: "Every map starts with one fence shield: the first ball that would smash a growing fence is absorbed, no life lost. Refreshes each map." },
];

export const entries: GalleryEntry[] = [
  // The UI redo's kit pieces (rail, ledger, tickets), assembled with sample figures (pipelineSample.tsx).
  { id: "Pipeline-debrief", group: "screen", render: () => <PipelineDebriefSample /> },
  { id: "Pipeline-store", group: "screen", render: () => <PipelineStoreSample /> },
  {
    id: "LevelCompleteOverlay", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={fullScore} totalScore={1284} onContinue={noop} accentColor={ACCENT}
      newlyUnlockedCerts={[certs[0]]} />,
  },
  {
    id: "LevelCompleteOverlay-rough", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={roughScore} totalScore={402} onContinue={noop} accentColor={ACCENT} />,
  },
  {
    // The ticket Debrief: the pre-map Acceptance Criteria card, filled in.
    id: "LevelCompleteOverlay-ticket", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={ticketScore} totalScore={1284} onContinue={noop} accentColor={ACCENT} buttonDelay={0}
      full={false} newlyUnlockedCerts={[certs[0]]} />,
  },
  {
    id: "LevelCompleteOverlay-ticketMissed", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={ticketMissedScore} totalScore={402} onContinue={noop} accentColor={ACCENT} buttonDelay={0}
      full={false} />,
  },
  {
    // A map with no Promotion due: the strip skips that stage and Continue says "Open the store".
    id: "LevelCompleteOverlay-storeOnly", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={fullScore} totalScore={1284} onContinue={noop} accentColor={ACCENT} buttonDelay={0}
      pipeline={{ clearedLevel: 10, promotion: false, store: true, last: false }} />,
  },
  {
    // The ticket with the store next: "Open the store", and under it the way past it.
    id: "LevelCompleteOverlay-ticketSkipStore", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={ticketScore} totalScore={1284} onContinue={noop} accentColor={ACCENT} buttonDelay={0}
      full={false} pipeline={{ clearedLevel: 10, promotion: false, store: true, last: false }} />,
  },
  {
    // The last map: no store, and the strip ends with the run's finish.
    id: "LevelCompleteOverlay-last", group: "screen",
    render: () => <LevelCompleteOverlay onSkipStore={noop} scoreData={fullScore} totalScore={4120} onContinue={noop} accentColor={ACCENT} buttonDelay={0}
      pipeline={{ clearedLevel: 35, promotion: false, store: false, last: true }} />,
  },
  {
    id: "ResultScreen-win", group: "screen",
    render: () => <ResultScreen result={winResult} onMainMenu={noop} onPlayAgain={noop} accentColor={ACCENT}
      runHoursAwarded={7} runLevelsCompleted={35} newlyUnlockedOffers={["Containment", "Cold Storage"]} runRecap={recap}
      runRank={{ rank: 3, gapToNext: 64, gapToTop10: null, aheadThroughMaps: 22, monthBest: true, dayBest: true, dailyStreak: 4 }}
      dailyKey="2026-10-10" onRecords={noop} />,
  },
  {
    id: "ResultScreen-loss", group: "screen",
    render: () => <ResultScreen result={lossResult} onMainMenu={noop} onPlayAgain={noop} onRestart={noop} checkpointLevel={11} accentColor={ACCENT}
      runLevelsCompleted={13} runHoursAwarded={2}
      runRecap={{ primary: null, secondary: null, tagCounts: { safety: 1 }, capstoneId: null, capstoneName: null }}
      runRank={{ rank: null, gapToNext: null, gapToTop10: 88, aheadThroughMaps: null }} />,
  },
  {
    id: "ContinuePrompt", group: "screen",
    render: () => <ContinuePrompt continuesRemaining={2} onSpend={noop} onDecline={noop} accentColor={ACCENT} />,
  },
  {
    id: "UpgradeShop", group: "screen",
    render: () => <UpgradeShop {...shopProps} tagSetThreshold={3} newlyUnlockedCerts={[certs[1]]} />,
  },
  {
    // Holding a ticket: the ticket opened, with its links and the certificate it counts toward.
    id: "UpgradeDetailModal", group: "modal",
    render: () => <UpgradeDetailModal upgrade={shopUpgrades[7]} upgrades={shopUpgrades} dependents={[shopUpgrades[8]]}
      has={id => shopOwned.includes(id)} cert={{ cert: certs[1], current: 1, required: 3 }} runContext={null}
      accent={hex(ACCENT)} onClose={noop} />,
  },
  {
    // Tapping a choice ticket: one variant committed, the other a few hours short.
    id: "ChoiceChooserModal", group: "modal",
    render: () => <ChoiceChooserModal options={[shopUpgrades[5], shopUpgrades[6]]} selectedIds={[shopUpgrades[5].id]}
      price={u => (u.id === shopUpgrades[5].id ? 63 : 77)} budget={70} accent={hex(ACCENT)} onChoose={noop} onClose={noop} />,
  },
  {
    // What can and cannot be bought, side by side: an affordable ticket, a
    // BLOCKED one whose blocker is on the shelf (its link jumps there), and an
    // UNFUNDED one a few hours short. The dots show the same at a glance.
    id: "UpgradeShop-reach", group: "screen",
    render: () => <UpgradeShop {...shopProps} playerPoints={50} completedLevel={3} abilityOfferCount={0} shopRestockCount={0}
      dealt={{ offerIds: ["code_review", "hot_start_principal", "hot_start_junior", "multithreading_principal"], abilityIds: [] }} />,
  },
  {
    id: "UpgradeShop-closed", group: "screen",
    render: () => <UpgradeShop {...shopProps} completedLevel={9} closed locksHave={1} locksNeed={3} />,
  },
  {
    id: "UpgradeShop-ability", group: "screen",
    // Every upgrade already owned, so the strip opens on the ability slot.
    render: () => <UpgradeShop {...shopProps} completedLevel={12} ownedUpgradeIds={shopUpgrades.map(u => u.id)} abilityOfferCount={2}
      freeAbilityGrant="freezeAll" activeModifiers={undefined} shopDiscountMultiplier={1} />,
  },
  {
    id: "ChainPickScreen", group: "screen",
    render: () => <ChainPickScreen offer={offer("headhunted")} choices={tenureOffers} onConfirm={noop} accentColor={ACCENT} />,
  },
  {
    id: "RunDraftScreen", group: "screen",
    render: () => <RunDraftScreen cards={sprintCards} onConfirm={noop} onBack={noop} accentColor={ACCENT} />,
  },
  {
    id: "RunDraftScreen-tenure", group: "screen",
    // A run that earned Tenure: its chain is the boon card; the gamble is the jackpot.
    render: () => <RunDraftScreen cards={sprintCardsTenure} onConfirm={noop} onBack={noop} accentColor={ACCENT} />,
  },
  {
    id: "CapstoneDraftScreen", group: "screen",
    render: () => <CapstoneDraftScreen offers={capstones} onSelect={noop} accentColor={ACCENT} />,
  },
];

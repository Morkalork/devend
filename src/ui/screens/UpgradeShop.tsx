/**
 * UpgradeShop - the between-levels store (canvas port of
 * components/game/UpgradeShop.tsx; its rules live in shopModel.ts).
 *
 * Shows a random selection of unlocked upgrades (3 + extraShopItems slots,
 * plus at most one locked "teaser"). The player toggles items to buy, then
 * "Buy & Continue" purchases the whole selection at once.
 *
 * Restocking (shopRestockCount modifier, Procurement upgrades): selecting an
 * item counts as the purchase moment - for the first N selections per visit,
 * a fresh offer is added to the shelf. Restock candidates are re-evaluated
 * treating the current selection as owned, so buying a Junior tier can put
 * its Senior tier on the shelf immediately. For the same reason, selections
 * satisfy prerequisites of other shelf items; deselecting an item cascades
 * to deselect anything that depended on it. Deselecting does not remove
 * restocked offers or refund the restock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorMatrixFilter } from "pixi.js";
import { ArrowRight, Clock, Lock, RefreshCw, ShoppingCart, Vault } from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import type { Certificate } from "@/types/certificate";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { RunContext } from "@/lib/upgradeConditions";
import { ownedTagCounts, weightedSample, DEFAULT_TAG_SET_THRESHOLD } from "@/lib/upgradeTags";
import { runwayStatus, spendChunks, spendChunkCap, SPEND_CHUNK_HOURS, type RunwayPerk } from "@/lib/treasury";
import { inflationForLevel } from "@/lib/upgradePricing";
import { getRunRng } from "@/lib/runRng";
import { rollAbilityOffers, abilitySlotClosed as abilityCapReached } from "@/lib/abilityOffer";
import { MAX_ABILITY_SLOTS, getAbility } from "@/lib/abilities";
import { Appear, COLOR, Icon, Label, RADIUS, ROLE, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { AbilityIcon } from "../game/AbilityIcon";
import { TutorialOverlay } from "../game/TutorialOverlay";
import { Carousel } from "./Carousel";
import { ArcadeButton, ArcadeText, arcadeInk } from "../kit/ui";
import { RichParagraph } from "./draftParts";
import {
  CertUnlockedRow, ChipInfoModal, ChoiceChooserModal, ClosedBanner, ClosedInfoModal, Pill, SprintPanel, TicketCard, UpgradeDetailModal, WaypointBanner, type SprintLine,
} from "./shopParts";
import {
  buildTagChips, cardModel, certChaseIndex, chooseVariantOutcome, dependentsIndex, freeOfferIdFor, itemClickOutcome,
  priceOf, purchasesFor, restockCandidates, rollShelf, selectionCost, shelfMarks,
} from "./shopModel";
import { PipelineFrame } from "./PipelineFrame";
import { continueLabel, pipelineColumnWidth, samplePlan, type BetweenMapPlan } from "./pipelineModel";

interface UpgradeShopProps {
  /**
   * The run as it stands, so a conditional upgrade can say whether it is LIVE
   * for the map about to be played. Optional: without it every condition reads
   * as met, which is the right default for a preview.
   */
  runContext?: RunContext | null;
  playerPoints: number;
  upgrades: UpgradeConfig[];
  ownedUpgradeIds: string[];
  completedLevel: number;
  isLocked: (upgradeId: string, ownedIds: string[]) => boolean;
  onPurchase: (upgradeId: string, price: number) => void;
  onContinue: () => void;
  accentColor?: string;
  extraShopItems?: number;
  shopRestockCount?: number;
  /** Scales all prices (<1 = cheaper; Bulk Licensing certificate) */
  shopDiscountMultiplier?: number;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
  newlyUnlockedCerts?: Certificate[];
  /** Certificate catalogue, for the "counts toward a certificate" card note. */
  certificates?: Certificate[];
  /**
   * The fence types the run already holds, from useGameSession's own
   * `fenceSlotIds` - the list the bar under the board is drawn from.
   *
   * Passed in rather than re-derived here. The held set comes from three
   * economies (certificates, upgrades, the dev flag) and a second derivation
   * would be free to disagree with the bar the player is looking at.
   */
  heldFenceTypeIds?: string[];
  /** certKey -> runs already credited, for that note's progress fraction. */
  maxTierCounts?: Record<string, number>;
  /** Already-unlocked cert ids; their chase note is done and is hidden. */
  unlockedCertIds?: string[];
  /** Owned upgrades of a tag needed to activate its set bonus (tagSets). */
  tagSetThreshold?: number;
  /** Company Card capstone: the cheapest unowned offer costs nothing. */
  freeCheapestOffer?: boolean;
  /** Full modifier set; drives the treasury strip (Runway + Budget Cycle). */
  activeModifiers?: GameModifiers;
  /** Opened "closed": the round didn't lock enough balls to earn the store. The
   *  shelf is still shown (so the player sees what they missed) but dimmed and
   *  non-interactive, with a "Not enough balls locked" banner; Continue only. */
  closed?: boolean;
  /** Locks made this round vs. required, shown as "X/Y" on the closed banner. */
  locksHave?: number;
  locksNeed?: number;
  /**
   * The store's ability slot (lib/abilityOffer.ts): retainer cards generated
   * from abilities.yml, shown BESIDE the upgrades rather than taking one of
   * their slots, and drawn inverted so they never read as a fourth upgrade.
   *
   * Rolled here, on mount, for the same reason the upgrade shelf is: a shop
   * visit is one shelf, and a shelf that re-rolls under the player's finger is
   * the bug this component was already written to avoid.
   */
  heldAbilityIds?: string[];
  /** Distinct abilities the player may hold at once. At the cap the slot closes. */
  abilitySlots?: number;
  /** Maps still to come, which is exactly what a retainer is worth. */
  mapsRemaining?: number;
  /** How many retainers to offer. 0 removes the slot entirely, which is what
   *  the Open Source Contribution upgrade does in exchange for a free one. */
  abilityOfferCount?: number;
  /** Buying a retainer is not buying an upgrade: it never touches
   *  ownedUpgradeIds, so it gets its own channel. */
  onPurchaseAbility?: (abilityId: string, price: number) => void;
  /** The ability handed over free on arrival (Open Source Contribution). The
   *  grant already happened in the session; the shop only announces it, so the
   *  player is not left wondering where the new button came from. */
  freeAbilityGrant?: string | null;
  /** The stages between the map just won and the next; a sample one in the gallery. */
  pipeline?: BetweenMapPlan;
}

const RUNWAY_CHIP_KEYS: Record<RunwayPerk, string> = {
  instantFence: "upgradeShop.runwayChipInstantFence",
  concurrentFence: "upgradeShop.runwayChipConcurrentFence",
  freeze: "upgradeShop.runwayChipFreeze",
};

const MARKET = hex("#c9a227");
const RUNWAY = hex("#2dd4bf");
const RUNWAY_OFF = hex("#8a8f98");
const YELLOW_500 = 0xeab308;

export function UpgradeShop({
  runContext = null,
  playerPoints,
  upgrades,
  ownedUpgradeIds,
  completedLevel,
  isLocked,
  onPurchase,
  onContinue,
  accentColor,
  extraShopItems = 0,
  shopRestockCount = 0,
  shopDiscountMultiplier = 1,
  showTutorial = false,
  onTutorialDismiss,
  newlyUnlockedCerts = [],
  certificates = [],
  heldFenceTypeIds = [],
  maxTierCounts = {},
  unlockedCertIds = [],
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
  freeCheapestOffer = false,
  activeModifiers,
  closed = false,
  locksHave,
  locksNeed,
  heldAbilityIds = [],
  abilitySlots = MAX_ABILITY_SLOTS,
  mapsRemaining = 0,
  abilityOfferCount = 1,
  onPurchaseAbility,
  freeAbilityGrant = null,
  pipeline,
}: UpgradeShopProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = accentColor ? hex(accentColor) : COLOR.border;
  // The board's accent: a committed ticket wears it, so it must never be the edge grey.
  const boardAccent = accentColor ? hex(accentColor) : COLOR.primary;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);
  const [shakingId, setShakingId] = useState<string | null>(null);
  // Upgrade whose detail card (track relationships) is open via press-and-hold.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Explains the "Not enough balls locked" banner; opened by holding it.
  const [showClosedInfo, setShowClosedInfo] = useState(false);
  // Open tier-3 "choice" chooser (its choiceGroup id), or null.
  const [chooserGroup, setChooserGroup] = useState<string | null>(null);
  // A status pill's explanation (the DOM's hover title), opened by holding it.
  const [chipInfo, setChipInfo] = useState<{ text: string; color: number } | null>(null);

  // `grayscale` on the closed shelf: what you missed, drained of colour.
  const closedFilters = useMemo(() => {
    if (!closed) return undefined;
    const gray = new ColorMatrixFilter();
    gray.desaturate();
    return [gray];
  }, [closed]);

  const shopSlots = 3 + extraShopItems;
  const dependentsById = useMemo(() => dependentsIndex(upgrades), [upgrades]);

  // Pick random offers once on mount; restocks append to this list.
  const [offeredUpgrades, setOfferedUpgrades] = useState<UpgradeConfig[]>(() =>
    rollShelf({ upgrades, ownedUpgradeIds, completedLevel, heldFenceTypeIds, shopSlots }));

  const [restocksUsed, setRestocksUsed] = useState(0);
  const restocksLeft = Math.max(0, shopRestockCount - restocksUsed);

  const allOwnedIds = useMemo(() => [...ownedUpgradeIds, ...purchasedThisSession], [ownedUpgradeIds, purchasedThisSession]);
  const certChaseByKey = useMemo(
    () => certChaseIndex(certificates, unlockedCertIds, maxTierCounts),
    [certificates, unlockedCertIds, maxTierCounts],
  );

  // Build readout: owned + currently selected upgrades per tag. Selections
  // count, so picking the piece that reaches the set threshold lights the chip
  // before the purchase is even confirmed.
  const buildTagCounts = useMemo(
    () => ownedTagCounts([...allOwnedIds, ...selectedIds], upgrades),
    [allOwnedIds, selectedIds, upgrades],
  );

  // playerPoints (totalScore) is already reduced by onPurchase.
  const effectiveOvertime = playerPoints;

  const freeOfferId = useMemo(
    () => freeOfferIdFor(freeCheapestOffer, offeredUpgrades, allOwnedIds, isLocked),
    [freeCheapestOffer, offeredUpgrades, allOwnedIds, isLocked],
  );

  // All prices flow through market-rate inflation (rises each 5-level
  // assignment block) and then the discount (Bulk Licensing certificate).
  const priceInflation = inflationForLevel(completedLevel);
  // The ability slot's cards, rolled once per visit like the upgrade shelf.
  const [abilityOffers] = useState<UpgradeConfig[]>(() => rollAbilityOffers(
    completedLevel, mapsRemaining, heldAbilityIds, abilityOfferCount,
    getRunRng(`shop:${completedLevel}:ability`), abilitySlots,
  ));
  // Closed only when the cap is what emptied it. A player who has simply bought
  // everything unlocked so far is not at the cap and must not be told they are.
  const abilitySlotClosed = abilityOfferCount > 0 && abilityCapReached(heldAbilityIds, abilitySlots);

  // The shelf as the player sees it: the ability slot LAST, after every
  // upgrade including restocks. The upgrades are what differs visit to visit
  // and what a build is made of; the constant card needs no prime position.
  const shelfItems = useMemo(() => [...offeredUpgrades, ...abilityOffers], [abilityOffers, offeredUpgrades]);

  const priceFor = useCallback(
    (u: UpgradeConfig) => priceOf(u, { freeOfferId, inflation: priceInflation, discount: shopDiscountMultiplier }),
    [shopDiscountMultiplier, freeOfferId, priceInflation],
  );
  const hasDiscount = shopDiscountMultiplier < 1;
  const inflationPercent = Math.round((priceInflation - 1) * 100);

  const selectedTotalCost = selectionCost(selectedIds, shelfItems, priceFor);
  const remainingBudget = effectiveOvertime - selectedTotalCost;

  // Treasury strip (Runway + Budget Cycle): evaluated against the balance AFTER
  // the current selection, so picking an item immediately shows a threshold
  // being lost and the Budget Cycle charging up. Same functions as the engine.
  const runwayPerks = activeModifiers ? runwayStatus(remainingBudget, activeModifiers) : [];
  const hasBudgetCycle = !!activeModifiers &&
    (activeModifiers.spendInstantFencePerChunk > 0 || activeModifiers.spendFenceSpeedPerChunk > 0 ||
     activeModifiers.spendCapturePerChunk > 0);
  // The spend chunk scales with the same inflation index as prices.
  const chunkHours = Math.round(SPEND_CHUNK_HOURS * priceInflation);
  const budgetChunks = spendChunks(selectedTotalCost, chunkHours, activeModifiers ? spendChunkCap(activeModifiers) : undefined);

  // The "can't afford" no: the card shakes, then settles.
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); }, []);
  const shake = useCallback((id: string) => {
    setShakingId(id);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShakingId(null), 600);
  }, []);

  const handleItemClick = (upgrade: UpgradeConfig, alreadySelected: boolean) => {
    const outcome = itemClickOutcome({
      closed, upgrade, alreadySelected, allOwnedIds, selectedIds, upgrades, isLocked,
      price: priceFor(upgrade), remainingBudget,
    });
    if (outcome.kind === "ignore") return;
    if (outcome.kind === "shake") { shake(upgrade.id); return; }
    setSelectedIds(outcome.selectedIds);
    if (outcome.kind !== "select" || !outcome.restock) return;

    // Restock: the first N purchases per visit add a fresh offer to the shelf.
    if (restocksLeft > 0) {
      const ownedAfterSelect = [...allOwnedIds, ...selectedIds, upgrade.id];
      const candidates = restockCandidates(upgrades, ownedAfterSelect, completedLevel, offeredUpgrades, isLocked);
      if (candidates.length > 0) {
        // Restocks lean into the build too: the selection counts as owned.
        // Seeded runs key each restock by its index, so both players' Nth
        // restock rolls identically.
        const counts = ownedTagCounts(ownedAfterSelect, upgrades);
        const restockedOffer = weightedSample(candidates, 1, counts, completedLevel, getRunRng(`shop:${completedLevel}:restock:${restocksUsed}`))[0];
        setOfferedUpgrades(prev => [...prev, restockedOffer]);
        setRestocksUsed(prev => prev + 1);
      }
    }
  };

  const chooseVariant = (member: UpgradeConfig) => {
    setChooserGroup(null);
    if (closed) return;
    const outcome = chooseVariantOutcome(selectedIds, member, upgrades, offeredUpgrades, priceFor, effectiveOvertime);
    if (outcome.shake) shake(member.id);
    else setSelectedIds(outcome.selectedIds);
  };

  const handleContinue = () => {
    for (const p of purchasesFor(selectedIds, shelfItems, upgrades, priceFor)) {
      if (p.channel === "ability") onPurchaseAbility?.(p.id, p.price);
      else onPurchase(p.id, p.price);
      setPurchasedThisSession(prev => [...prev, p.shelfId]);
    }
    onContinue();
  };

  const column = pipelineColumnWidth(screen.width);
  const plan = pipeline ?? samplePlan(completedLevel);
  const hasChips = inflationPercent > 0 || (!closed && (shopRestockCount > 0 || hasBudgetCycle));
  const cyan = COLOR.cyan;

  const cards = shelfItems.map((upgrade, index) => {
    const model = cardModel({
      upgrade, upgrades, selectedIds, allOwnedIds, isLocked, price: priceFor,
      effectiveOvertime, remainingBudget, certChaseByKey,
    });
    return (
      <TicketCard
        key={upgrade.id}
        upgrade={upgrade}
        model={model}
        upgrades={upgrades}
        index={index}
        shaking={shakingId === upgrade.id}
        accent={boardAccent}
        hasDiscount={hasDiscount}
        mapsRemaining={mapsRemaining}
        runContext={runContext}
        onHold={() => setDetailId(upgrade.id)}
        onTap={() => {
          // A choice card opens its chooser; a normal card toggles select.
          if (model.isChoice) {
            // #50: don't open the chooser for options that can't be bought
            // (unaffordable or store closed); shake like an unaffordable card.
            if (!model.selected && (closed || model.cantAfford)) { shake(upgrade.id); return; }
            setChooserGroup(upgrade.choiceGroup!);
          } else handleItemClick(upgrade, model.selected);
        }}
      />
    );
  });

  // The sprint: one line per committed pick, in the order it was picked. A
  // choice's line names the chosen variant, which is what the id is.
  const sprintLines: SprintLine[] = selectedIds.flatMap(id => {
    const u = shelfItems.find(o => o.id === id) ?? upgrades.find(o => o.id === id);
    return u ? [{ id, upgrade: u, price: priceFor(u), ability: !!u.grantsAbility }] : [];
  });
  const removeFromSprint = (id: string) => {
    const u = shelfItems.find(o => o.id === id) ?? upgrades.find(o => o.id === id);
    if (u) {
      handleItemClick(u, true);
    }
  };

  const detailUpgrade = detailId ? upgrades.find(x => x.id === detailId) : undefined;
  const chooserOptions = chooserGroup ? upgrades.filter(u => u.choiceGroup === chooserGroup) : [];
  const freeGrant = freeAbilityGrant ? getAbility(freeAbilityGrant) : undefined;
  const freeGrantColor = freeGrant?.color ? hex(freeGrant.color) : COLOR.foreground;

  return (
    <PipelineFrame
      plan={plan}
      at="store"
      accent={accent}
      headline={{
        value: remainingBudget,
        unit: "h",
        caption: plan.last ? t("pipeline.toSpendLast") : t("pipeline.toSpend", { level: completedLevel + 1 }),
      }}
      shelf={
        <>
          {/* The shelf, as a strip rather than a grid: one card gets most of
              the width and its description a size people actually read.
              See Carousel.tsx for what that trade costs. It runs edge to
              edge, because the peek IS the strip's margin. Closed: dimmed,
              greyed, and nothing in it takes a touch. */}
          <Appear fromY={20} delay={0.2}>
            <layoutContainer layout={{ alignItems: "center" }} alpha={closed ? 0.4 : 1} eventMode={closed ? "none" : "passive"}
              filters={closedFilters}>
              {/* The ability slot, closed: a fact about the run worth
                  reading once, not a dead card to swipe past every visit. */}
              {abilitySlotClosed && !closed && (
                <View layout={{ width: column, marginBottom: 8 }}>
                  <RichParagraph align="left" runs={[{ text: t("upgradeShop.abilitySlotClosed") }]} size={TEXT.sm} color={ROLE.muted}
                    lead={<Icon icon={Lock} size={14} color={COLOR.mutedForeground} />} leadGap={8} />
                </View>
              )}
              {/* Open Source Contribution: say what turned up, or the new button is a mystery. */}
              {freeAbilityGrant && (
                <View layout={{ width: column, marginBottom: 8 }}>
                  <RichParagraph align="left" runs={[{ text: t("upgradeShop.freeAbilityGranted", { name: freeGrant?.name ?? freeAbilityGrant }) }]}
                    size={TEXT.sm} color={freeGrantColor}
                    lead={<AbilityIcon kind={freeGrant?.kind ?? ""} size={16} color={freeGrantColor} />} leadGap={8} />
                </View>
              )}
              {/* The backlog's heading: what the strip below is, and how much is in it. */}
              <View layout={{ width: column, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Label text={t("upgradeShop.backlog")} size={TEXT.xs} weight="700" upper letterSpacing={1} color={ROLE.muted} />
                <View layout={{ borderRadius: RADIUS.full, paddingLeft: 6, paddingRight: 6, backgroundColor: ROLE.edge }}>
                  <Label text={String(shelfItems.length)} size={TEXT.xs} weight="700" color={ROLE.ink} />
                </View>
                <View layout={{ flex: 1, height: 1, backgroundColor: ROLE.edge }} />
              </View>
              <Carousel
                label={t("upgradeShop.carouselLabel")}
                prevLabel={t("upgradeShop.prevOffer")}
                nextLabel={t("upgradeShop.nextOffer")}
                positionLabel={(index, total) => t("upgradeShop.offerPosition", { index, total })}
                cardWidth="min(76vw, 340px)"
                // Tickets start on the column's left edge, under the Sprint panel and the backlog heading.
                alignWidth={column}
                marks={shelfMarks(shelfItems, upgrades, selectedIds, allOwnedIds)}
                items={cards}
              />
            </layoutContainer>
          </Appear>
        </>
      }
      footer={
        <>
          {/* Certificate unlock banner */}
          {newlyUnlockedCerts.length > 0 && (
            <Appear fromY={-8}>
              <View layout={{ gap: 8, alignSelf: "stretch" }}>
                {newlyUnlockedCerts.map(cert => <CertUnlockedRow key={cert.id} cert={cert} />)}
              </View>
            </Appear>
          )}

          {/* Continue */}
          <Appear fromY={20} delay={0.4}>
            <ArcadeButton onTap={handleContinue} iconAfter={ArrowRight}>
              {selectedIds.length > 0 ? (
                <>
                  <ArcadeText text={t("upgradeShop.buyAndContinue", { count: selectedIds.length })} color={arcadeInk("primary")} size={TEXT.sm} />
                  {/* Cost as an icon chip: the display font's parentheses look broken. */}
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon icon={Clock} size={16} color={arcadeInk("primary")} />
                    <ArcadeText text={t("upgradeShop.hoursValue", { hours: selectedTotalCost })} color={arcadeInk("primary")} size={TEXT.sm} />
                  </View>
                </>
              ) : (
                <ArcadeText text={continueLabel(plan, "store", t)} color={arcadeInk("primary")} size={TEXT.sm} />
              )}
            </ArcadeButton>
          </Appear>
        </>
      }
      overlay={
        <>
          {detailUpgrade && (
            <UpgradeDetailModal
              upgrade={detailUpgrade}
              upgrades={upgrades}
              dependents={dependentsById.get(detailUpgrade.id) ?? []}
              has={id => allOwnedIds.includes(id) || selectedIds.includes(id)}
              cert={certChaseByKey.get(detailUpgrade.choiceGroup ?? detailUpgrade.id)}
              runContext={runContext}
              accent={accent}
              onClose={() => setDetailId(null)}
            />
          )}

          {showClosedInfo && <ClosedInfoModal onClose={() => setShowClosedInfo(false)} />}

          {chooserOptions.length > 0 && (
            <ChoiceChooserModal
              options={chooserOptions}
              selectedIds={selectedIds}
              price={priceFor}
              budget={effectiveOvertime}
              accent={accent}
              onChoose={chooseVariant}
              onClose={() => setChooserGroup(null)}
            />
          )}

          {chipInfo && <ChipInfoModal text={chipInfo.text} accent={chipInfo.color} onClose={() => setChipInfo(null)} />}

          {showTutorial && !closed && (
            <TutorialOverlay
              visible
              title={t("upgradeShop.tutorialTitle")}
              body={t("upgradeShop.tutorialBody")}
              arrowDirection="none"
              onDismiss={() => onTutorialDismiss?.()}
            />
          )}
        </>
      }
    >
      {closed && <ClosedBanner locksHave={locksHave} locksNeed={locksNeed} onHold={() => setShowClosedInfo(true)} />}

      {completedLevel % 5 === 0 && <WaypointBanner level={completedLevel} />}

      {/* The modifiers that change what the budget buys. Three of them are a
          name and a number, which is a chip, not a sentence. */}
      {hasChips && (
        <Appear fromY={-8} delay={0.1}>
          <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 8 }}>
            {/* Market rates: prices rise each assignment block. */}
            {inflationPercent > 0 && (
              <Pill
                text={t("upgradeShop.marketRatesChip", { percent: inflationPercent })}
                color={MARKET} border={tint(MARKET, 0x55 / 255)} background={tint(MARKET, 0x0f / 255)}
                onHold={() => setChipInfo({ text: t("upgradeShop.marketRates", { percent: inflationPercent }), color: MARKET })}
              />
            )}

            {/* Restocks: buying an item adds a fresh offer to the strip. */}
            {!closed && shopRestockCount > 0 && (
              <Pill
                icon={RefreshCw}
                text={t("upgradeShop.restockChip", { count: restocksLeft })}
                color={restocksLeft > 0 ? cyan : COLOR.mutedForeground}
                border={restocksLeft > 0 ? tint(cyan, 0.4) : tint(COLOR.muted, 0.4)}
                background={restocksLeft > 0 ? tint(cyan, 0.05) : undefined}
                onHold={() => setChipInfo({
                  text: restocksLeft > 0 ? t("upgradeShop.restocksLeft", { count: restocksLeft }) : t("upgradeShop.noRestocksLeft"),
                  color: cyan,
                })}
              />
            )}

            {/* Budget Cycle: spending charges a boon for the next map. */}
            {!closed && hasBudgetCycle && (
              <Pill
                icon={ShoppingCart}
                text={budgetChunks > 0
                  ? t("upgradeShop.budgetCycleChipCharged", { count: budgetChunks })
                  : t("upgradeShop.budgetCycleChip", { spent: selectedTotalCost, next: chunkHours })}
                color={budgetChunks > 0 ? cyan : COLOR.mutedForeground}
                border={budgetChunks > 0 ? tint(cyan, 0.4) : tint(COLOR.muted, 0.4)}
                background={budgetChunks > 0 ? tint(cyan, 0.05) : undefined}
                onHold={() => setChipInfo({
                  text: budgetChunks > 0
                    ? t("upgradeShop.budgetCycleCharged", { count: budgetChunks, spent: selectedTotalCost })
                    : t("upgradeShop.budgetCycleProgress", { spent: selectedTotalCost, next: chunkHours }),
                  color: cyan,
                })}
              />
            )}
          </View>
        </Appear>
      )}

      {/* Runway thresholds and the per-archetype set-bonus counts, on ONE
          wrapping row: the player reads them as one status line. */}
      {!closed && (runwayPerks.length > 0 || buildTagCounts.size > 0) && (
        <Appear delay={0.12}>
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {runwayPerks.map(p => (
              <Pill
                key={p.perk}
                icon={Vault}
                size={10}
                text={t(RUNWAY_CHIP_KEYS[p.perk], { hours: p.thresholdHours }) + (p.met ? " ✓" : "")}
                color={p.met ? RUNWAY : RUNWAY_OFF}
                border={p.met ? tint(RUNWAY, 0x66 / 255) : tint(RUNWAY_OFF, 0x33 / 255)}
                background={p.met ? tint(RUNWAY, 0x14 / 255) : undefined}
                alpha={p.met ? 1 : 0.8}
                onHold={() => setChipInfo({ text: t("upgradeShop.runwayTitle"), color: RUNWAY })}
              />
            ))}
            {buildTagChips(buildTagCounts, tagSetThreshold).map(c => (
              <TagChip key={c.tag} tag={c.tag} pill ringed={c.active} sizeClass="text-[10px]" suffix={c.suffix} />
            ))}
          </View>
        </Appear>
      )}

      {/* The sprint the backlog's tickets are pulled into. Not on a closed
          store: nothing can be committed there. */}
      {!closed && (
        <Appear fromY={-8} delay={0.14}>
          <SprintPanel
            level={completedLevel + 1}
            lines={sprintLines}
            committed={selectedTotalCost}
            capacity={effectiveOvertime}
            accent={boardAccent}
            onRemove={removeFromSprint}
          />
        </Appear>
      )}
    </PipelineFrame>
  );
}

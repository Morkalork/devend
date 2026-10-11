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
import { Appear, COLOR, Icon, Label, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { AbilityIcon } from "../game/AbilityIcon";
import { TutorialOverlay } from "../game/TutorialOverlay";
import { Carousel } from "./Carousel";
import { ArcadeButton, ArcadeText } from "./betweenArcadeButton";
import {
  CertUnlockedRow, ChipInfoModal, ChoiceChooserModal, ClosedBanner, ClosedInfoModal, Pill, ShopCard, UpgradeDetailModal, WaypointBanner,
} from "./shopParts";
import {
  buildTagChips, cardModel, certChaseIndex, chooseVariantOutcome, dependentsIndex, freeOfferIdFor, itemClickOutcome,
  priceOf, purchasesFor, restockCandidates, rollShelf, selectionCost, shelfMarks,
} from "./shopModel";

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
}: UpgradeShopProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = accentColor ? hex(accentColor) : COLOR.border;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);
  const [lockedInfoId, setLockedInfoId] = useState<string | null>(null);
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

  const inset = screen.width - 48;
  const cyan = COLOR.cyan;

  const cards = shelfItems.map((upgrade, index) => {
    const model = cardModel({
      upgrade, upgrades, selectedIds, allOwnedIds, isLocked, price: priceFor,
      effectiveOvertime, remainingBudget, certChaseByKey,
    });
    return (
      <ShopCard
        key={upgrade.id}
        upgrade={upgrade}
        model={model}
        upgrades={upgrades}
        index={index}
        shaking={shakingId === upgrade.id}
        lockedInfoOpen={lockedInfoId === upgrade.id}
        hasDiscount={hasDiscount}
        mapsRemaining={mapsRemaining}
        runContext={runContext}
        onHold={() => setDetailId(upgrade.id)}
        onLockTap={() => setLockedInfoId(prev => (prev === upgrade.id ? null : upgrade.id))}
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

  const detailUpgrade = detailId ? upgrades.find(x => x.id === detailId) : undefined;
  const chooserOptions = chooserGroup ? upgrades.filter(u => u.choiceGroup === chooserGroup) : [];
  const freeGrant = freeAbilityGrant ? getAbility(freeAbilityGrant) : undefined;
  const freeGrantColor = freeGrant?.color ? hex(freeGrant.color) : COLOR.foreground;

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
      {/* bg-background/95 over the global CRT background, which shows through faintly. */}
      <Appear layout={{ width: screen.width, height: screen.height }}>
        <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.95) }}>
          <ScrollView layout={{ width: screen.width, height: screen.height }}>
            <View layout={{ width: screen.width, minHeight: screen.height, alignItems: "center", justifyContent: "center", gap: 16, paddingTop: 24, paddingBottom: 24 }}>

              {/* Store title and the level just cleared, on ONE line: two
                  stacked rows to say six words was the header's whole problem. */}
              <Appear fromY={-20} delay={0.1}>
                <View layout={{ maxWidth: inset, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center", columnGap: 12, rowGap: 4 }}>
                  <Label text={t("upgradeShop.storeLabel")} size={TEXT["2xl"]} weight="700" upper letterSpacing={2.4} color={COLOR.foreground} alpha={0.3} />
                  <Label text={t("upgradeShop.levelComplete", { level: completedLevel })} size={TEXT.sm} color={COLOR.mutedForeground} />
                </View>
              </Appear>

              {closed && <ClosedBanner locksHave={locksHave} locksNeed={locksNeed} onHold={() => setShowClosedInfo(true)} />}

              {completedLevel % 5 === 0 && <WaypointBanner level={completedLevel} />}

              {/* Budget, and the modifiers that change what it buys. Three of
                  them are a name and a number, which is a chip, not a sentence. */}
              <Appear fromY={-20} delay={0.1}>
                <View layout={{ maxWidth: inset, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 12, rowGap: 8 }}>
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon icon={Clock} size={24} color={YELLOW_500} />
                    <Label text={t("upgradeShop.hoursValue", { hours: effectiveOvertime })} size={TEXT.xl} weight="600" color={COLOR.foreground} />
                    <Label text={t("upgradeShop.overtime")} size={TEXT.xl} color={COLOR.mutedForeground} />
                  </View>

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

              {/* Runway thresholds and the per-archetype set-bonus counts, on ONE
                  wrapping row: the player reads them as one status line. */}
              {!closed && (runwayPerks.length > 0 || buildTagCounts.size > 0) && (
                <Appear delay={0.12}>
                  <View layout={{ maxWidth: Math.min(672, inset), flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
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
                    <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8, maxWidth: inset }}>
                      <Icon icon={Lock} size={14} color={COLOR.mutedForeground} />
                      <Label text={t("upgradeShop.abilitySlotClosed")} size={TEXT.xs} upper letterSpacing={0.3} color={COLOR.mutedForeground} />
                    </View>
                  )}
                  {/* Open Source Contribution: say what turned up, or the new button is a mystery. */}
                  {freeAbilityGrant && (
                    <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8, maxWidth: inset }}>
                      <AbilityIcon kind={freeGrant?.kind ?? ""} size={16} color={freeGrantColor} />
                      <Label
                        text={t("upgradeShop.freeAbilityGranted", { name: freeGrant?.name ?? freeAbilityGrant })}
                        size={TEXT.xs} upper letterSpacing={0.3} color={freeGrantColor}
                      />
                    </View>
                  )}
                  <Carousel
                    label={t("upgradeShop.carouselLabel")}
                    prevLabel={t("upgradeShop.prevOffer")}
                    nextLabel={t("upgradeShop.nextOffer")}
                    positionLabel={(index, total) => t("upgradeShop.offerPosition", { index, total })}
                    cardWidth="min(76vw, 340px)"
                    marks={shelfMarks(shelfItems, upgrades, selectedIds, allOwnedIds)}
                    items={cards}
                  />
                </layoutContainer>
              </Appear>

              {/* Certificate unlock banner */}
              {newlyUnlockedCerts.length > 0 && (
                <Appear fromY={-8}>
                  <View layout={{ gap: 8, width: Math.min(inset, 384) }}>
                    {newlyUnlockedCerts.map(cert => <CertUnlockedRow key={cert.id} cert={cert} />)}
                  </View>
                </Appear>
              )}

              {/* Continue */}
              <Appear fromY={20} delay={0.4}>
                <ArcadeButton onTap={handleContinue} trailingIcon={ArrowRight} layout={{ maxWidth: inset }}>
                  {selectedIds.length > 0 ? (
                    <>
                      <ArcadeText text={t("upgradeShop.buyAndContinue", { count: selectedIds.length })} color={COLOR.primary} size={TEXT.sm} />
                      {/* Cost as an icon chip: the display font's parentheses look broken. */}
                      <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Icon icon={Clock} size={16} color={COLOR.primary} />
                        <ArcadeText text={t("upgradeShop.hoursValue", { hours: selectedTotalCost })} color={COLOR.primary} size={TEXT.sm} />
                      </View>
                    </>
                  ) : (
                    <ArcadeText text={t("upgradeShop.continue")} color={COLOR.primary} size={TEXT.sm} />
                  )}
                </ArcadeButton>
              </Appear>
            </View>
          </ScrollView>
        </View>
      </Appear>

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
    </View>
  );
}

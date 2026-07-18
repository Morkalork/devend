/**
 * UpgradeShop — the between-levels store.
 *
 * Shows a random selection of unlocked upgrades (3 + extraShopItems slots,
 * plus at most one locked "teaser"). The player toggles items to buy, then
 * "Buy & Continue" purchases the whole selection at once.
 *
 * Restocking (shopRestockCount modifier, Procurement upgrades): selecting an
 * item counts as the purchase moment — for the first N selections per visit,
 * a fresh offer is added to the shelf. Restock candidates are re-evaluated
 * treating the current selection as owned, so buying a Junior tier can put
 * its Senior tier on the shelf immediately. For the same reason, selections
 * satisfy prerequisites of other shelf items; deselecting an item cascades
 * to deselect anything that depended on it. Deselecting does not remove
 * restocked offers or refund the restock.
 */
import { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { UpgradeConfig, TIER_COLORS, UpgradeTag, UpgradeTier } from '@/types/upgrade';
import { ownedTagCounts, weightedSample, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { GameModifiers } from '@/hooks/useActiveModifiers';
import { runwayStatus, spendChunks, spendChunkCap, SPEND_CHUNK_HOURS, RunwayPerk } from '@/lib/treasury';
import { inflationForLevel } from '@/lib/upgradePricing';
import { TagChip } from './TagChip';
import { Clock, ArrowRight, Lock, Check, Medal, RefreshCw, X, Info, Vault, ShoppingCart } from 'lucide-react';
import { getUpgradeIcon } from './upgradeIcons';
import { getRunRng } from '@/lib/runRng';
import { CRTBackground } from './CRTBackground';
import { TutorialOverlay } from './TutorialOverlay';
import { Certificate } from '@/types/certificate';
import { contentText } from '@/i18n/content';

interface UpgradeShopProps {
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
}

/**
 * Remove `id` from the selection, then keep removing any selected upgrades
 * whose prerequisites are no longer satisfied (by owned or still-selected
 * items) — deselecting a Junior tier also deselects a Senior tier that was
 * picked up via restock on top of it.
 */
function deselectWithDependents(
  selected: string[],
  id: string,
  ownedIds: string[],
  upgrades: UpgradeConfig[],
): string[] {
  let next = selected.filter(s => s !== id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sid of next) {
      const prereqs = upgrades.find(u => u.id === sid)?.prerequisites ?? [];
      if (prereqs.some(p => !ownedIds.includes(p) && !next.includes(p))) {
        next = next.filter(s => s !== sid);
        changed = true;
        break;
      }
    }
  }
  return next;
}

export function UpgradeShop({
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
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
  freeCheapestOffer = false,
  activeModifiers,
  closed = false,
}: UpgradeShopProps) {
  const { t, i18n } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);
  const [lockedInfoId, setLockedInfoId] = useState<string | null>(null);
  const [shakingId, setShakingId] = useState<string | null>(null);
  // Upgrade whose detail card (track relationships) is open via press-and-hold.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Explains the "Not enough balls locked" banner; opened by holding it.
  const [showClosedInfo, setShowClosedInfo] = useState(false);
  // Open tier-3 "choice" chooser (its choiceGroup id), or null. Tapping a choice
  // card opens it; picking an option selects that variant for purchase.
  const [chooserGroup, setChooserGroup] = useState<string | null>(null);

  // Press-and-hold detection: a held card opens its detail view; the timer fires
  // detailId and the flag suppresses the click-to-select that follows on release.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback((id: string, e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    longPressFired.current = false;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setDetailId(id);
    }, 450);
  }, [cancelLongPress]);

  const moveLongPress = useCallback((e: React.PointerEvent) => {
    const start = pointerStart.current;
    if (start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  // Press-and-hold the closed banner to open its explainer (reuses the shared
  // hold timer/refs — the banner and the upgrade cards are never held at once).
  const startClosedInfoHold = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => setShowClosedInfo(true), 450);
  }, [cancelLongPress]);

  // Clear any pending hold timer if the shop unmounts mid-press.
  useEffect(() => cancelLongPress, [cancelLongPress]);

  const shopSlots = 3 + extraShopItems;

  // Reverse prerequisite index: id → the upgrades that list it as a prerequisite
  // (i.e. what this upgrade unlocks). Used by the press-and-hold detail card.
  const dependentsById = useMemo(() => {
    const map = new Map<string, UpgradeConfig[]>();
    for (const u of upgrades) {
      for (const prereqId of u.prerequisites ?? []) {
        const list = map.get(prereqId);
        if (list) list.push(u);
        else map.set(prereqId, [u]);
      }
    }
    return map;
  }, [upgrades]);

  // Pick random offers once on mount; restocks append to this list. Picks are
  // tag-weighted toward the player's owned archetypes (see weightedSample).
  const [offeredUpgrades, setOfferedUpgrades] = useState<UpgradeConfig[]>(() => {
    // Filter out owned, upgrades not yet unlocked by level progression, and any
    // choice group whose pick is already made (a sibling owned).
    const available = upgrades.filter(u =>
      !ownedUpgradeIds.includes(u.id) &&
      completedLevel >= (u.unlockLevel ?? 1) &&
      !(u.choiceGroup && upgrades.some(o => o.choiceGroup === u.choiceGroup && ownedUpgradeIds.includes(o.id)))
    );
    // Collapse a choice group to ONE representative card (the chooser expands the
    // full group), so it fills a single shop slot.
    const collapseChoiceGroups = (list: UpgradeConfig[]): UpgradeConfig[] => {
      const seen = new Set<string>();
      return list.filter(u => {
        if (!u.choiceGroup) return true;
        if (seen.has(u.choiceGroup)) return false;
        seen.add(u.choiceGroup);
        return true;
      });
    };
    const unlocked = collapseChoiceGroups(available.filter(u => {
      if (!u.prerequisites || u.prerequisites.length === 0) return true;
      return u.prerequisites.every(p => ownedUpgradeIds.includes(p));
    }));
    const locked = collapseChoiceGroups(available.filter(u => {
      if (!u.prerequisites || u.prerequisites.length === 0) return false;
      return u.prerequisites.some(p => !ownedUpgradeIds.includes(p));
    }));
    const counts = ownedTagCounts(ownedUpgradeIds, upgrades);
    // Seeded runs (Daily Stand-up) roll the shelf from the run seed keyed by
    // the level, so everyone opening this shop sees the same offers. Shelves
    // still diverge once purchases differ (weights follow the build) - only
    // the roll is shared, not the choices.
    const shelfRng = getRunRng(`shop:${completedLevel}`);
    const offers = weightedSample(unlocked, shopSlots, counts, completedLevel, shelfRng);
    // Add at most one locked item if there's room
    if (offers.length < shopSlots && locked.length > 0) {
      offers.push(weightedSample(locked, 1, counts, completedLevel, shelfRng)[0]);
    }
    return offers;
  });

  // Equal-height cards across wrapped rows: flexbox centers every row (incl. a
  // partial last one), but can't equalise heights across rows. So we measure the
  // tallest card's natural height and expose it as a `--card-h` CSS variable that
  // every card uses as its min-height. Re-runs when the offered set or language
  // changes (both can change how many lines a description wraps to).
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Release the constraint so each card reports its natural content height…
    grid.style.setProperty('--card-h', 'auto');
    let tallest = 0;
    for (const child of Array.from(grid.children)) {
      tallest = Math.max(tallest, (child as HTMLElement).offsetHeight);
    }
    // …then pin every card to the tallest.
    grid.style.setProperty('--card-h', `${tallest}px`);
  }, [offeredUpgrades, i18n.language]);

  const [restocksUsed, setRestocksUsed] = useState(0);
  const restocksLeft = Math.max(0, shopRestockCount - restocksUsed);

  // Combine owned with session purchases
  const allOwnedIds = useMemo(() =>
    [...ownedUpgradeIds, ...purchasedThisSession],
    [ownedUpgradeIds, purchasedThisSession]
  );

  // Build readout: owned + currently selected upgrades per tag. Selections
  // count, so picking the piece that reaches the set threshold lights the
  // chip up before the purchase is even confirmed.
  const buildTagCounts = useMemo(
    () => ownedTagCounts([...allOwnedIds, ...selectedIds], upgrades),
    [allOwnedIds, selectedIds, upgrades],
  );

  // Effective overtime - playerPoints (totalScore) is already reduced by onPurchase
  const effectiveOvertime = playerPoints;

  // Company Card capstone: the cheapest PURCHASABLE offer on the shelf is
  // free. Locked teasers are skipped - a free price on something you can't
  // buy would waste the perk. Recomputed as restocks add offers and as
  // purchases change what's locked.
  const freeOfferId = useMemo(() => {
    if (!freeCheapestOffer) return null;
    let cheapest: UpgradeConfig | null = null;
    for (const u of offeredUpgrades) {
      if (allOwnedIds.includes(u.id)) continue;
      if (isLocked(u.id, allOwnedIds)) continue;
      if (!cheapest || u.cost < cheapest.cost) cheapest = u;
    }
    return cheapest?.id ?? null;
  }, [freeCheapestOffer, offeredUpgrades, allOwnedIds, isLocked]);

  // All prices flow through market-rate inflation (rises each 5-level
  // assignment block) and then the discount (Bulk Licensing certificate).
  const priceInflation = inflationForLevel(completedLevel);
  const priceFor = useCallback(
    (u: UpgradeConfig) =>
      u.id === freeOfferId ? 0 : Math.max(1, Math.round(u.cost * priceInflation * shopDiscountMultiplier)),
    [shopDiscountMultiplier, freeOfferId, priceInflation],
  );
  const hasDiscount = shopDiscountMultiplier < 1;
  const inflationPercent = Math.round((priceInflation - 1) * 100);

  // Budget remaining after currently selected items
  const selectedTotalCost = selectedIds.reduce((sum, id) => {
    const u = offeredUpgrades.find(u => u.id === id);
    return sum + (u ? priceFor(u) : 0);
  }, 0);
  const remainingBudget = effectiveOvertime - selectedTotalCost;

  // Treasury strip (Runway + Budget Cycle): evaluated against the balance AFTER
  // the current selection, so picking an item immediately shows a threshold
  // being lost and the Budget Cycle charging up. Same functions as the engine.
  const runwayPerks = activeModifiers ? runwayStatus(remainingBudget, activeModifiers) : [];
  const hasBudgetCycle = !!activeModifiers &&
    (activeModifiers.spendInstantFencePerChunk > 0 || activeModifiers.spendFenceSpeedPerChunk > 0 ||
     activeModifiers.spendCapturePerChunk > 0);
  // The spend chunk scales with the same inflation index as prices, so the
  // spender archetype doesn't get cheaper boons as markets rise.
  const chunkHours = Math.round(SPEND_CHUNK_HOURS * priceInflation);
  const budgetChunks = spendChunks(
    selectedTotalCost,
    chunkHours,
    activeModifiers ? spendChunkCap(activeModifiers) : undefined,
  );
  const RUNWAY_CHIP_KEYS: Record<RunwayPerk, string> = {
    instantFence: 'upgradeShop.runwayChipInstantFence',
    concurrentFence: 'upgradeShop.runwayChipConcurrentFence',
    freeze: 'upgradeShop.runwayChipFreeze',
  };

  const handleItemClick = useCallback((upgrade: UpgradeConfig, alreadySelected: boolean, currentRemainingBudget: number) => {
    if (closed) return; // store is closed this round — no purchases
    if (allOwnedIds.includes(upgrade.id)) return;

    // Deselect if already selected — cascades to dependents (see helper)
    if (alreadySelected) {
      setSelectedIds(prev => deselectWithDependents(prev, upgrade.id, allOwnedIds, upgrades));
      return;
    }

    // Selections count toward prerequisites of other shelf items
    const effectiveOwned = [...allOwnedIds, ...selectedIds];
    if (isLocked(upgrade.id, effectiveOwned)) return;

    // Can't afford — shake instead of toast
    if (priceFor(upgrade) > currentRemainingBudget) {
      setShakingId(upgrade.id);
      setTimeout(() => setShakingId(null), 600);
      return;
    }

    setSelectedIds(prev => [...prev, upgrade.id]);

    // Restock: the first N purchases per visit add a fresh offer to the shelf.
    // Candidates are re-evaluated as if the selection were already owned, so
    // the next tier of the item just bought can appear immediately.
    if (restocksLeft > 0) {
      const ownedAfterSelect = [...effectiveOwned, upgrade.id];
      const candidates = upgrades.filter(u =>
        !ownedAfterSelect.includes(u.id) &&
        completedLevel >= (u.unlockLevel ?? 1) &&
        !offeredUpgrades.some(o => o.id === u.id) &&
        // Don't restock a choice group that's already on the shelf (one card each).
        !(u.choiceGroup && offeredUpgrades.some(o => o.choiceGroup === u.choiceGroup)) &&
        !isLocked(u.id, ownedAfterSelect)
      );
      if (candidates.length > 0) {
        // Restocks also lean into the build: the selection counts as owned, so
        // buying a lock upgrade makes the fresh offer likelier to be lock too.
        const counts = ownedTagCounts(ownedAfterSelect, upgrades);
        // Seeded runs key each restock by its index, so both players' Nth
        // restock rolls identically (their candidates may already differ).
        const restockedOffer = weightedSample(candidates, 1, counts, completedLevel, getRunRng(`shop:${completedLevel}:restock:${restocksUsed}`))[0];
        setOfferedUpgrades(prev => [...prev, restockedOffer]);
        setRestocksUsed(prev => prev + 1);
      }
    }
  }, [closed, allOwnedIds, selectedIds, isLocked, restocksLeft, upgrades, completedLevel, offeredUpgrades, priceFor]);

  // Pick one option of a tier-3 choice group: strips any sibling first, then
  // toggles this variant in (budget-checked). The chosen variant may not be in
  // offeredUpgrades (only the group's representative card is), so it is looked
  // up from the full catalogue for pricing/purchase.
  const chooseVariant = useCallback((member: UpgradeConfig) => {
    const group = member.choiceGroup;
    setChooserGroup(null);
    if (closed) return;
    setSelectedIds(prev => {
      const base = prev.filter(id => upgrades.find(o => o.id === id)?.choiceGroup !== group);
      if (prev.includes(member.id)) return base; // toggled off
      const spentOnBase = base.reduce((sum, id) => {
        const u = offeredUpgrades.find(o => o.id === id) || upgrades.find(o => o.id === id);
        return sum + (u ? priceFor(u) : 0);
      }, 0);
      if (priceFor(member) > effectiveOvertime - spentOnBase) {
        setShakingId(member.id);
        setTimeout(() => setShakingId(null), 600);
        return prev; // can't afford
      }
      return [...base, member.id];
    });
  }, [closed, upgrades, offeredUpgrades, priceFor, effectiveOvertime]);

  const handleContinue = useCallback(() => {
    for (const id of selectedIds) {
      const upgrade = offeredUpgrades.find(u => u.id === id) || upgrades.find(u => u.id === id);
      if (upgrade) {
        onPurchase(upgrade.id, priceFor(upgrade));
        setPurchasedThisSession(prev => [...prev, upgrade.id]);
      }
    }
    onContinue();
  }, [selectedIds, offeredUpgrades, upgrades, onPurchase, onContinue, priceFor]);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 z-50 overflow-y-auto"
      >
        {/* Store title — above the items */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <span className="text-2xl font-bold text-foreground/30 tracking-widest uppercase">
            {t('upgradeShop.storeLabel')}
          </span>
        </motion.div>

        {/* Level completed */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="text-sm text-muted-foreground"
        >
          {t('upgradeShop.levelComplete', { level: completedLevel })}
        </motion.div>

        {/* Closed banner — the round didn't lock enough balls to earn the store.
            Press and hold it for an explainer of why the store is shut. */}
        {closed && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 20 }}
            onPointerDown={startClosedInfoHold}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerMove={moveLongPress}
            onContextMenu={(e) => e.preventDefault()}
            className="flex items-center gap-2 rounded-lg px-4 py-2 border-2 cursor-help select-none"
            style={{
              color: '#ff6b6b',
              borderColor: '#ff6b6b66',
              background: '#ff6b6b12',
              touchAction: 'pan-y',
            }}
          >
            <Lock className="w-4 h-4 shrink-0" />
            <span className="text-sm font-bold tracking-wide uppercase">
              {t('upgradeShop.closedNotEnoughLocks')}
            </span>
            <Info className="w-3.5 h-3.5 shrink-0 opacity-70" />
          </motion.div>
        )}

        {/* Waypoint banner — shown only on multiples of 5 */}
        {completedLevel % 5 === 0 && (
          <motion.div
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-full max-w-sm flex flex-col items-center gap-1 rounded-xl px-6 py-4"
            style={{
              background: 'linear-gradient(135deg, #00ff8812 0%, #00ff8820 100%)',
              border: '2px solid #00ff88',
              boxShadow: '0 0 24px #00ff8866, 0 0 48px #00ff8833, inset 0 0 24px #00ff8808',
            }}
          >
            {/* Pulsing glow ring */}
            <motion.div
              animate={{ boxShadow: ['0 0 0px #00ff8800', '0 0 32px #00ff8888', '0 0 0px #00ff8800'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-xl pointer-events-none"
            />

            <motion.p
              animate={{ opacity: [1, 0.7, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="text-xs font-bold tracking-[0.3em] uppercase"
              style={{ fontFamily: 'Michroma, sans-serif', color: '#00ff88' }}
            >
              ⚑ &nbsp;{t('upgradeShop.checkpointReached')}&nbsp; ⚑
            </motion.p>

            <motion.p
              animate={{ textShadow: ['0 0 8px #00ff8888', '0 0 24px #00ff88cc', '0 0 8px #00ff8888'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="text-4xl font-black tracking-widest"
              style={{ fontFamily: 'Michroma, sans-serif', color: '#00ff88' }}
            >
              {t('upgradeShop.levelBanner', { level: completedLevel })}
            </motion.p>

            <p
              className="text-xs tracking-widest uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: '#4a7a5a' }}
            >
              {t('upgradeShop.progressSavedHere')}
            </p>
          </motion.div>
        )}

        {/* Overtime display */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-2 text-xl"
        >
          <Clock className="w-6 h-6 text-yellow-500" />
          <span className="font-semibold text-foreground">{t('upgradeShop.hoursValue', { hours: effectiveOvertime })}</span>
          <span className="text-muted-foreground">{t('upgradeShop.overtime')}</span>
        </motion.div>

        {/* Market rates: prices rise each assignment block */}
        {inflationPercent > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
            className="text-center text-[11px] tracking-widest uppercase"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: '#c9a227' }}
          >
            {t('upgradeShop.marketRates', { percent: inflationPercent })}
          </motion.p>
        )}

        {/* Treasury strip: Runway thresholds + Budget Cycle charge, live against
            the balance after the current selection (see remainingBudget above). */}
        {!closed && (runwayPerks.length > 0 || hasBudgetCycle) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
            className="flex flex-col items-center gap-1.5"
          >
            {runwayPerks.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {runwayPerks.map(p => (
                  <span
                    key={p.perk}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                    style={p.met
                      ? { color: '#2dd4bf', borderColor: '#2dd4bf66', background: '#2dd4bf14' }
                      : { color: '#8a8f98', borderColor: '#8a8f9833', background: 'transparent', opacity: 0.8 }}
                    title={t('upgradeShop.runwayTitle')}
                  >
                    <Vault className="w-3 h-3" />
                    {t(RUNWAY_CHIP_KEYS[p.perk], { hours: p.thresholdHours })}
                    {p.met ? ' ✓' : ''}
                  </span>
                ))}
              </div>
            )}
            {hasBudgetCycle && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShoppingCart className={`w-3.5 h-3.5 ${budgetChunks > 0 ? 'text-cyan-400' : ''}`} />
                <span>
                  {budgetChunks > 0
                    ? t('upgradeShop.budgetCycleCharged', { count: budgetChunks, spent: selectedTotalCost })
                    : t('upgradeShop.budgetCycleProgress', { spent: selectedTotalCost, next: chunkHours })}
                </span>
              </div>
            )}
          </motion.div>
        )}

        {/* Restock counter — only when the Procurement upgrades are owned */}
        {!closed && shopRestockCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${restocksLeft > 0 ? 'text-cyan-400' : ''}`} />
            <span>
              {restocksLeft > 0
                ? t('upgradeShop.restocksLeft', { count: restocksLeft })
                : t('upgradeShop.noRestocksLeft')}
            </span>
          </motion.div>
        )}

        {/* Build readout: per-tag piece count toward the set bonus. A ✓ chip
            means that archetype's set bonus is active (or will be on buy). */}
        {!closed && buildTagCounts.size > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.16 }}
            className="flex flex-wrap justify-center gap-1.5"
          >
            {[...buildTagCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => {
                const setActive = count >= tagSetThreshold;
                return (
                  <TagChip
                    key={tag}
                    tag={tag as UpgradeTag}
                    pill
                    ringed={setActive}
                    sizeClass="text-[10px]"
                    suffix={setActive ? '✓' : `${count}/${tagSetThreshold}`}
                  />
                );
              })}
          </motion.div>
        )}

        {/* Press-and-hold discovery hint */}
        {!closed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18 }}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"
          >
            <Info className="w-3 h-3" />
            <span>{t('upgradeShop.holdHint')}</span>
          </motion.div>
        )}

        {/* Upgrade Tree — flex-wrap keeps every row centered (including a partial
            last row); the measured `--card-h` var (see useLayoutEffect) makes all
            cards the same height as the tallest, growing to fit any line count. */}
        <motion.div
          ref={gridRef}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: closed ? 0.4 : 1 }}
          transition={{ delay: 0.2 }}
          className={`flex flex-wrap justify-center gap-4 max-w-5xl ${closed ? 'pointer-events-none grayscale' : ''}`}
        >
          {offeredUpgrades.map((upgrade, index) => {
                // Tier-3 "choice" card: one card standing in for a mutually
                // exclusive group. It shows the chosen option once picked, else a
                // "choose" prompt; tapping opens the chooser.
                const isChoice = !!upgrade.choiceGroup;
                const choiceOptions = isChoice ? upgrades.filter(u => u.choiceGroup === upgrade.choiceGroup) : [];
                const chosenMember = isChoice
                  ? choiceOptions.find(u => selectedIds.includes(u.id))
                  : undefined;
                const displayUpgrade = chosenMember ?? upgrade;
                const owned = allOwnedIds.includes(upgrade.id);
                const selected = isChoice ? !!chosenMember : selectedIds.includes(upgrade.id);
                // Other selected items count toward this card's prerequisites,
                // so a restocked Senior tier unlocks while its Junior is selected
                const effectiveOwned = [...allOwnedIds, ...selectedIds.filter(id => id !== upgrade.id)];
                const locked = isLocked(upgrade.id, effectiveOwned);
                // Price shown: the chosen option, else the cheapest of a choice, else this card's.
                const shownPrice = chosenMember
                  ? priceFor(chosenMember)
                  : isChoice
                    ? Math.min(...choiceOptions.map(priceFor))
                    : priceFor(upgrade);
                const purchasable = !owned && !locked && shownPrice <= effectiveOvertime;
                // Can't afford with remaining budget (unless already selected)
                const cantAfford = !locked && !owned && !selected && shownPrice > remainingBudget;
                const tierColors = TIER_COLORS[upgrade.tier];
                const Icon = getUpgradeIcon(displayUpgrade, upgrades);

            return (
              <motion.div
                key={upgrade.id}
                className="select-none w-[calc(50%-0.5rem)] sm:w-44"
                style={{ touchAction: 'pan-y' }}
                onPointerDown={(e) => startLongPress(upgrade.id, e)}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerMove={moveLongPress}
                onContextMenu={(e) => e.preventDefault()}
                animate={shakingId === upgrade.id ? { x: [-10, 10, -8, 8, -4, 4, 0] } : { x: 0 }}
                transition={shakingId === upgrade.id ? { duration: 0.5, type: 'tween' } : { duration: 0 }}
              >
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => {
                  // A press-and-hold opened the detail card — swallow the click
                  // so it doesn't also select/deselect the upgrade.
                  if (longPressFired.current) {
                    longPressFired.current = false;
                    return;
                  }
                  // A choice card opens its chooser; a normal card toggles select.
                  if (isChoice) setChooserGroup(upgrade.choiceGroup!);
                  else handleItemClick(upgrade, selected, remainingBudget);
                }}
                disabled={owned || locked}
                whileHover={{ scale: purchasable ? 1.05 : 1 }}
                whileTap={{ scale: purchasable ? 0.95 : 1 }}
                // min-height comes from the measured `--card-h` var so all cards
                // match the tallest; falls back to auto before the first measure.
                style={{ minHeight: 'var(--card-h, auto)' }}
                className={`
                  relative w-full p-3 rounded-lg transition-all duration-200 text-center flex flex-col
                  ${cantAfford ? 'border-dashed' : ''} border-2
                  ${selected ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-black' : ''}
                  ${owned
                    ? 'bg-green-500/20 border-green-500/50'
                    : locked
                      ? 'bg-muted/30 border-muted/30 opacity-40 cursor-not-allowed'
                      : purchasable
                        ? `bg-card ${tierColors.border} hover:border-primary cursor-pointer`
                        : cantAfford
                          ? 'bg-card/50 border-muted-foreground/30 opacity-60 cursor-pointer'
                          : 'bg-card/50 border-muted cursor-not-allowed opacity-40'
                  }
                `}
              >
                {/* Tier badge */}
                <div className={`text-xs font-medium mb-1 ${tierColors.text}`}>
                  {contentText.tier(t, upgrade.tier)}
                </div>

                {/* Icon */}
                {Icon && (
                  <div className="flex justify-center mb-1">
                    <Icon className={`w-7 h-7 ${tierColors.text}`} strokeWidth={1.5} />
                  </div>
                )}

                {/* Name */}
                <div className="text-sm font-semibold text-foreground mb-1 truncate">
                  {contentText.upgradeName(t, upgrade)}
                </div>

                {/* Archetype tag chips */}
                {(upgrade.tags?.length ?? 0) > 0 && (
                  <div className="flex justify-center gap-1 mb-1 flex-wrap">
                    {upgrade.tags!.map(tag => <TagChip key={tag} tag={tag} />)}
                  </div>
                )}

                {/* Status icon */}
                {selected && (
                  <div className="absolute top-1 right-1">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                {owned && (
                  <div className="absolute top-1 right-1">
                    <Check className="w-3 h-3 text-green-500" />
                  </div>
                )}
                {locked && !owned && (
                  <div
                    className="absolute top-1 right-1 cursor-help"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLockedInfoId(prev => prev === upgrade.id ? null : upgrade.id);
                    }}
                  >
                    <Lock className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                {locked && !owned && lockedInfoId === upgrade.id && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full z-10 bg-popover border border-border rounded px-2 py-1 text-[10px] text-muted-foreground whitespace-nowrap shadow-md">
                    {t('upgradeShop.requires')} {(upgrade.prerequisites || []).filter(p => !effectiveOwned.includes(p)).map(p => {
                      const prereq = upgrades.find(u => u.id === p);
                      return prereq ? contentText.upgradeName(t, prereq) : p;
                    }).join(', ')}
                  </div>
                )}

                {/* Description — grows to fit its full text (no clamp); the grid
                    keeps every card the same height as the tallest one. */}
                <p className="text-xs text-muted-foreground">
                  {isChoice && !chosenMember
                    ? t('upgradeShop.choicePrompt')
                    : contentText.upgradeDesc(t, displayUpgrade)}
                </p>

                {/* Cost — mt-auto pins it to the card bottom regardless of how
                    many lines the description above it takes. */}
                {!owned && (
                  <div className={`mt-auto pt-1 flex items-center justify-center gap-1 text-sm font-bold
                    ${purchasable ? 'text-yellow-500' : 'text-muted-foreground'}
                  `}>
                    <Clock className="w-4 h-4" />
                    {(hasDiscount || shownPrice === 0) && (
                      <span className="text-xs font-normal line-through opacity-50">{t('upgradeShop.hoursValue', { hours: displayUpgrade.cost })}</span>
                    )}
                    {isChoice && !chosenMember && (
                      <span className="text-[10px] font-normal opacity-70">{t('upgradeShop.fromLabel')}</span>
                    )}
                    {shownPrice === 0
                      ? t('upgradeShop.freeLabel')
                      : t('upgradeShop.hoursValue', { hours: shownPrice })}
                  </div>
                )}
              </motion.button>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Certificate unlock banner */}
        {newlyUnlockedCerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            {newlyUnlockedCerts.map(cert => (
              <div
                key={cert.id}
                className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10"
              >
                <Medal className="w-4 h-4 text-yellow-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider">{t('upgradeShop.certificateUnlocked')}</p>
                  <p className="text-sm text-foreground font-semibold">{contentText.certName(t, cert)}</p>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Continue Button */}
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={handleContinue}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="arcade-button-primary rounded-lg flex items-center justify-center gap-2 text-sm max-w-full whitespace-nowrap"
        >
          {selectedIds.length > 0 ? (
            <>
              <span>{t('upgradeShop.buyAndContinue', { count: selectedIds.length })}</span>
              {/* Cost as an icon chip: the display font's parentheses glyphs look broken */}
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4 shrink-0" />
                {t('upgradeShop.hoursValue', { hours: selectedTotalCost })}
              </span>
            </>
          ) : (
            t('upgradeShop.continue')
          )}
          <ArrowRight className="w-5 h-5 shrink-0" />
        </motion.button>
      </motion.div>

      {/* Press-and-hold detail card: track relationships (what unlocks this, and
          what this unlocks). Tapping the backdrop or the X closes it. */}
      <AnimatePresence>
        {detailId && (() => {
          const u = upgrades.find(x => x.id === detailId);
          if (!u) return null;
          const DetailIcon = getUpgradeIcon(u, upgrades);
          const tc = TIER_COLORS[u.tier];
          const prereqs = (u.prerequisites ?? [])
            .map(id => upgrades.find(x => x.id === id))
            .filter((x): x is UpgradeConfig => Boolean(x));
          const dependents = dependentsById.get(u.id) ?? [];

          const relRow = (rel: UpgradeConfig) => {
            const RelIcon = getUpgradeIcon(rel, upgrades);
            const relTc = TIER_COLORS[rel.tier];
            const relHas = allOwnedIds.includes(rel.id) || selectedIds.includes(rel.id);
            return (
              <li key={rel.id} className="flex items-center gap-2 text-sm text-foreground">
                {RelIcon && <RelIcon className={`w-4 h-4 shrink-0 ${relTc.text}`} strokeWidth={1.5} />}
                <span className="flex-1 truncate">{contentText.upgradeName(t, rel)}</span>
                <span className={`text-[10px] uppercase tracking-wider ${relTc.text}`}>{contentText.tier(t, rel.tier)}</span>
                {relHas && <Check className="w-3.5 h-3.5 shrink-0 text-green-500" />}
              </li>
            );
          };

          return (
            <motion.div
              key="upgrade-detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailId(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.92, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
                style={{ borderColor: accentColor ? `${accentColor}66` : undefined }}
              >
                <button
                  onClick={() => setDetailId(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Header */}
                <div className="flex items-center gap-3 mb-2 pr-6">
                  {DetailIcon && <DetailIcon className={`w-8 h-8 shrink-0 ${tc.text}`} strokeWidth={1.5} />}
                  <div className="min-w-0">
                    <div className="text-base font-bold text-foreground truncate">{contentText.upgradeName(t, u)}</div>
                    <div className={`text-xs ${tc.text}`}>{contentText.tier(t, u.tier)}</div>
                  </div>
                </div>

                {(u.tags?.length ?? 0) > 0 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {u.tags!.map(tag => <TagChip key={tag} tag={tag} sizeClass="text-[10px]" />)}
                  </div>
                )}

                <p className="text-sm text-muted-foreground mb-4">{contentText.upgradeDesc(t, u)}</p>

                {/* Unlocked by (prerequisites) */}
                <div className="mb-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1.5">
                    {t('upgradeShop.detailUnlockedBy')}
                  </div>
                  {prereqs.length > 0 ? (
                    <ul className="space-y-1.5">{prereqs.map(relRow)}</ul>
                  ) : (
                    <p className="text-xs italic text-muted-foreground/60">{t('upgradeShop.detailNoPrereqs')}</p>
                  )}
                </div>

                {/* Unlocks (dependents) */}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1.5">
                    {t('upgradeShop.detailUnlocks')}
                  </div>
                  {dependents.length > 0 ? (
                    <ul className="space-y-1.5">{dependents.map(relRow)}</ul>
                  ) : (
                    <p className="text-xs italic text-muted-foreground/60">{t('upgradeShop.detailNoUnlocks')}</p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Closed-store explainer — opened by holding the "Not enough balls locked"
          banner. Tapping the backdrop or the X closes it. */}
      <AnimatePresence>
        {showClosedInfo && (
          <motion.div
            key="closed-info"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowClosedInfo(false)}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          >
            <motion.div
              initial={{ scale: 0.92, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
              style={{ borderColor: '#ff6b6b66' }}
            >
              <button
                onClick={() => setShowClosedInfo(false)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 mb-2 pr-6">
                <Lock className="w-5 h-5 shrink-0" style={{ color: '#ff6b6b' }} />
                <h3 className="text-base font-bold text-foreground">{t('upgradeShop.closedInfoTitle')}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {t('upgradeShop.closedInfoBody')}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tier-3 choice chooser — opened by tapping a choice card. Pick ONE of the
          group's mutually exclusive options (each costs 50% more). */}
      <AnimatePresence>
        {chooserGroup && (() => {
          const options = upgrades.filter(u => u.choiceGroup === chooserGroup);
          if (options.length === 0) return null;
          return (
            <motion.div
              key="choice-chooser"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChooserGroup(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.92, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
                style={{ borderColor: accentColor ? `${accentColor}66` : undefined }}
              >
                <button
                  onClick={() => setChooserGroup(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="text-base font-bold text-foreground mb-1 pr-6">
                  {contentText.upgradeName(t, options[0])}
                </div>
                <p className="text-xs text-muted-foreground mb-4">{t('upgradeShop.choiceModalHint')}</p>
                <div className="flex flex-col gap-2">
                  {options.map(opt => {
                    const price = priceFor(opt);
                    const isSel = selectedIds.includes(opt.id);
                    const affordable = price <= effectiveOvertime;
                    const tc = TIER_COLORS[opt.tier];
                    return (
                      <button
                        key={opt.id}
                        onClick={() => chooseVariant(opt)}
                        className={`text-left rounded-lg border-2 p-3 transition-colors
                          ${isSel ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-black ' + tc.border : ''}
                          ${affordable ? `cursor-pointer hover:border-primary ${tc.border}` : 'opacity-60 border-muted cursor-pointer'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-foreground flex-1">
                            {contentText.upgradeDesc(t, opt)}
                          </span>
                          {isSel && <Check className="w-4 h-4 text-white shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1 text-xs font-bold text-yellow-500">
                          <Clock className="w-3.5 h-3.5" />
                          {price === 0 ? t('upgradeShop.freeLabel') : t('upgradeShop.hoursValue', { hours: price })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {showTutorial && !closed && (
        <TutorialOverlay
          visible
          title={t('upgradeShop.tutorialTitle')}
          body={t('upgradeShop.tutorialBody')}
          arrowDirection="none"
          onDismiss={() => onTutorialDismiss?.()}
        />
      )}
    </>
  );
}

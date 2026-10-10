/**
 * The certificate store's rules, split from the drawing so they can be tested
 * without a canvas (canvas port of components/game/CertificateStore). State
 * and purchase logic live in useCertificateManager; these only decide what the
 * store shows and what a tap selects.
 */
import type { TFunction } from "i18next";
import type { Certificate } from "@/types/certificate";
import { type Achievement, ACHIEVEMENT_STAT_LABELS } from "@/types/achievement";
import type { MetaProgressionStats } from "@/types/metaProgression";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";

/** What a locked certificate needs + how far along the player is. */
export interface UnlockInfo {
  requirementText: string;
  current: number;
  required: number;
  progressLabel: string;
}

/** What the unlock requirements are measured against. */
export interface UnlockContext {
  upgrades: UpgradeConfig[];
  achievements: Achievement[];
  metaStats?: MetaProgressionStats;
  maxTierCounts: Record<string, number>;
  lifetimeHoursSpent: number;
}

/** The hours to go from the levels owned up to `targetLevel` (1-indexed). */
export function getCostForSelection(cert: Certificate, targetLevel: number, certLevelsOwned: Record<string, number>): number {
  const currentOwned = certLevelsOwned[cert.id] || 0;
  return cert.levels.slice(currentOwned, targetLevel).reduce((sum, l) => sum + l.cost, 0);
}

/** Requirement text + live progress for a locked certificate. */
export function getUnlockInfo(t: TFunction, cert: Certificate, ctx: UnlockContext): UnlockInfo {
  if (cert.unlockType === "upgrade-chain" && cert.sourceUpgradeId) {
    const upgrade = ctx.upgrades.find(u => u.id === cert.sourceUpgradeId);
    const upgradeName = upgrade ? `${contentText.upgradeName(t, upgrade)} (${contentText.tier(t, upgrade.tier)})` : cert.sourceUpgradeId;
    const required = cert.requiredRuns ?? 3;
    return {
      requirementText: t("certificateStore.unlockUpgradeChain", { upgradeName, required }),
      current: Math.min(ctx.maxTierCounts[cert.sourceUpgradeId] || 0, required),
      required,
      progressLabel: t("certificateStore.progressLabelRuns"),
    };
  }
  if (cert.unlockType === "achievement" && cert.sourceAchievementId) {
    const achievement = ctx.achievements.find(a => a.id === cert.sourceAchievementId);
    if (achievement) {
      const statValue = ctx.metaStats?.[achievement.requirement.stat] ?? 0;
      return {
        requirementText: t("certificateStore.unlockAchievement", { name: contentText.achName(t, achievement), description: contentText.achDesc(t, achievement) }),
        current: Math.min(statValue, achievement.requirement.threshold),
        required: achievement.requirement.threshold,
        progressLabel: ACHIEVEMENT_STAT_LABELS[achievement.requirement.stat].toLowerCase(),
      };
    }
    return { requirementText: t("certificateStore.unlockLinkedAchievement"), current: 0, required: 1, progressLabel: "" };
  }
  if (cert.unlockType === "hours-spent") {
    const required = cert.requiredHoursSpent ?? 1;
    return {
      requirementText: t("certificateStore.unlockHoursSpent", { required }),
      current: Math.min(ctx.lifetimeHoursSpent, required),
      required,
      progressLabel: t("certificateStore.progressLabelHoursSpent"),
    };
  }
  return { requirementText: t("certificateStore.unlockKeepPlaying"), current: 0, required: 1, progressLabel: "" };
}

export interface CertSections {
  locked: Certificate[];
  available: Certificate[];
  maxed: Certificate[];
}

/**
 * Every certificate is visible: locked ones render disabled with their unlock
 * requirement behind a tap, unlocked ones with levels left are for sale, and
 * fully bought ones sit at the bottom.
 *
 * Locked are nearest-first. In YAML order the locked list is a wall of
 * identical grey cards with no hint of which is within reach; sorted, it reads
 * as a ladder and the top one is a goal for the next run or two.
 */
export function certSections(
  t: TFunction,
  certificates: Certificate[],
  certLevelsOwned: Record<string, number>,
  unlockedCertIds: string[],
  ctx: UnlockContext,
): CertSections {
  const locked: Certificate[] = [];
  const available: Certificate[] = [];
  const maxed: Certificate[] = [];
  for (const cert of certificates) {
    const levelsOwned = certLevelsOwned[cert.id] || 0;
    if (!unlockedCertIds.includes(cert.id)) locked.push(cert);
    else if (levelsOwned >= cert.levels.length) maxed.push(cert);
    else available.push(cert);
  }
  const fraction = (cert: Certificate) => {
    const { current, required } = getUnlockInfo(t, cert, ctx);
    return required > 0 ? current / required : 0;
  };
  locked.sort((a, b) => fraction(b) - fraction(a));
  return { locked, available, maxed };
}

/**
 * A tap on a level row. Owned levels do nothing; tapping the selected level
 * again clears the selection; any other level becomes the target (buying up
 * to it buys every level in between).
 */
export function toggleLevelSelection(
  prev: Record<string, number>, certId: string, level: number, certLevelsOwned: Record<string, number>,
): Record<string, number> {
  const currentOwned = certLevelsOwned[certId] || 0;
  if (level <= currentOwned) return prev;
  if (prev[certId] === level) {
    const next = { ...prev };
    delete next[certId];
    return next;
  }
  return { ...prev, [certId]: level };
}

/** The selection after a purchase: that certificate's target is cleared. */
export function clearSelection(prev: Record<string, number>, certId: string): Record<string, number> {
  const next = { ...prev };
  delete next[certId];
  return next;
}

/** Live projected balance: the hours left once every pending selection is paid for. */
export function projectedBalance(
  totalCertificateHours: number, selectedLevels: Record<string, number>,
  certificates: Certificate[], certLevelsOwned: Record<string, number>,
): number {
  let balance = totalCertificateHours;
  for (const cert of certificates) {
    const target = selectedLevels[cert.id];
    if (target != null) balance -= getCostForSelection(cert, target, certLevelsOwned);
  }
  return balance;
}

export interface PendingPurchase {
  pendingCost: number;
  canAfford: boolean;
  /** Hours still missing (only meaningful when it cannot be afforded). */
  shortBy: number;
}

export function pendingPurchase(
  cert: Certificate, selectedTarget: number | undefined, certLevelsOwned: Record<string, number>, totalCertificateHours: number,
): PendingPurchase {
  const pendingCost = selectedTarget != null ? getCostForSelection(cert, selectedTarget, certLevelsOwned) : 0;
  return {
    pendingCost,
    canAfford: pendingCost <= totalCertificateHours && pendingCost > 0,
    shortBy: pendingCost - totalCertificateHours,
  };
}

/** How one level row reads: bought, in the pending range, or for sale. */
export function levelRowState(levelNum: number, levelsOwned: number, selectedTarget: number | undefined): "owned" | "selected" | "open" {
  if (levelNum <= levelsOwned) return "owned";
  if (selectedTarget != null && levelNum <= selectedTarget) return "selected";
  return "open";
}

/**
 * Tapping Lv 3 also buys Lv 2, so the buy row names the range: the total cost
 * alone doesn't explain where it came from.
 */
export function buyingText(t: TFunction, levelsOwned: number, selectedTarget: number): string {
  return levelsOwned + 1 === selectedTarget
    ? t("certificateStore.buyingOne", { to: selectedTarget })
    : t("certificateStore.buyingRange", { from: levelsOwned + 1, to: selectedTarget });
}

/** The next level's price, or null once every level is owned. */
export const nextLevelCost = (cert: Certificate, levelsOwned: number): number | null => cert.levels[levelsOwned]?.cost ?? null;

/** One card open at a time: tapping the open one closes it. */
export const toggleExpanded = (expanded: string | null, certId: string): string | null => (expanded === certId ? null : certId);

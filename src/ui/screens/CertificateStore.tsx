/**
 * CertificateStore: the between-runs meta-progression shop (canvas port of
 * components/game/CertificateStore).
 *
 * Certificates (public/certificates.yml) unlock by mastering upgrade chains
 * or completing achievements; their levels are bought here with Certificate
 * Hours. State and purchase logic live in useCertificateManager; this
 * component is purely presentational, and its rules are in certModel.ts.
 *
 * The DOM page sat on CRTBackground, which stays DOM and is drawn once,
 * globally, under the interface canvas; this screen paints only the 90%
 * background wash the DOM put over it.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Medal, ArrowLeft, Check, Lock, ChevronRight, ChevronDown, ChevronUp, Hexagon, Info } from "lucide-react";
import type { Certificate } from "@/types/certificate";
import type { Achievement } from "@/types/achievement";
import type { MetaProgressionStats } from "@/types/metaProgression";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";
import { certEffectLabel } from "@/lib/certEffectLabel";
import {
  Appear, COLOR, Icon, Label, Pressable, ProgressBar, RADIUS, ScrollView, TEXT, View, tint, useUiScreen,
} from "../kit/ui";
import { TutorialOverlay } from "../game/TutorialOverlay";
import { MenuHeading } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import {
  buyingText, certSections, clearSelection, getUnlockInfo, levelRowState, nextLevelCost, pendingPurchase,
  projectedBalance as projectBalance, toggleExpanded, toggleLevelSelection, type UnlockContext,
} from "./certModel";

interface CertificateStoreProps {
  certificates: Certificate[];
  totalCertificateHours: number;
  certLevelsOwned: Record<string, number>;
  unlockedCertIds: string[];
  maxTierCounts: Record<string, number>;
  onPurchaseCertLevel: (certId: string, targetLevel: number) => void;
  onBack: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
  /** For locked-cert unlock tooltips: upgrade names, achievement requirements, lifetime stats. */
  upgrades?: UpgradeConfig[];
  achievements?: Achievement[];
  metaStats?: MetaProgressionStats;
  /** Lifetime Certificate Hours spent in this store (drives hours-spent unlocks). */
  lifetimeHoursSpent?: number;
}

/** text-[0.65rem]. */
const TINY = 10.4;
/** text-xs leading-relaxed. */
const RELAXED = Math.round(TEXT.xs * 1.625);

export function CertificateStore({
  certificates,
  totalCertificateHours,
  certLevelsOwned,
  unlockedCertIds,
  maxTierCounts,
  onPurchaseCertLevel,
  onBack,
  showTutorial = false,
  onTutorialDismiss,
  upgrades = [],
  achievements = [],
  metaStats,
  lifetimeHoursSpent = 0,
}: CertificateStoreProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  // selectedLevels[certId] = target level (1-indexed) the player has tapped
  const [selectedLevels, setSelectedLevels] = useState<Record<string, number>>({});

  // ── Accordion state, shared by all sections ───────────────────────────────
  // Every certificate card collapses to a compact header and expands inline on
  // tap (locked: unlock requirement + progress; available: level buttons + buy
  // row; complete: description). Inline expansion (not a popup) so nothing can
  // clip against the scroll view; one card open at a time.
  const [expandedCertId, setExpandedCertId] = useState<string | null>(null);
  const toggleCard = (certId: string) => () => setExpandedCertId(prev => toggleExpanded(prev, certId));

  const ctx: UnlockContext = useMemo(
    () => ({ upgrades, achievements, metaStats, maxTierCounts, lifetimeHoursSpent }),
    [upgrades, achievements, metaStats, maxTierCounts, lifetimeHoursSpent],
  );
  const { locked, available, maxed } = useMemo(
    () => certSections(t, certificates, certLevelsOwned, unlockedCertIds, ctx),
    [t, certificates, certLevelsOwned, unlockedCertIds, ctx],
  );

  const handleLevelTap = (certId: string, level: number) =>
    setSelectedLevels(prev => toggleLevelSelection(prev, certId, level, certLevelsOwned));

  const handleBuy = (cert: Certificate) => {
    const target = selectedLevels[cert.id];
    if (!target) return;
    onPurchaseCertLevel(cert.id, target);
    setSelectedLevels(prev => clearSelection(prev, cert.id));
  };

  // Live projected balance: starting from totalCertificateHours, deduct all pending selections
  const projectedBalance = useMemo(
    () => projectBalance(totalCertificateHours, selectedLevels, certificates, certLevelsOwned),
    [totalCertificateHours, selectedLevels, certificates, certLevelsOwned],
  );

  const wide = screen.width >= 640;
  const pad = wide ? 24 : 16;
  // max-w-2xl inside the page's padding.
  const contentWidth = Math.min(672, screen.width - pad * 2);

  return (
    // The padding is on an inner box, so the tutorial overlay (absolute at
    // 0,0) is laid out against the whole screen rather than the padded content.
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}>
      <View layout={{ flex: 1, padding: pad }}>
        <Appear fromY={20} duration={0.5} layout={{ flex: 1, width: contentWidth, alignSelf: "center" }}>
          <View layout={{ flex: 1, alignItems: "center", gap: 24 }}>
            {/* Header. The subtitle is the one thing that separates this screen from
                the upgrade shop, and it used to be said only in the first-visit
                tutorial - which a returning player has long since dismissed. */}
            <View layout={{ alignItems: "center", gap: 4 }}>
              <MenuHeading icon={Medal} iconColor={COLOR.primary} text={t("certificateStore.title")} size={wide ? TEXT["4xl"] : TEXT["3xl"]}
                letterSpacing={1.2} maxWidth={contentWidth} />
              <View layout={{ alignSelf: "stretch" }}>
                <Label text={t("certificateStore.subtitle")} size={TEXT.xs} color={COLOR.mutedForeground} wrap />
              </View>
            </View>

            {/* Balance */}
            <Appear fromScale={0.9} delay={0.1}>
              <View layout={{
                width: Math.min(contentWidth, 360), alignItems: "center",
                paddingLeft: 24, paddingRight: 24, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.xl,
                backgroundColor: tint(COLOR.primary, 0.1), borderWidth: 1, borderColor: tint(COLOR.primary, 0.4),
              }}>
                <Label text={t("certificateStore.certificateHours")} size={TEXT.xs} upper letterSpacing={0.6}
                  color={COLOR.mutedForeground} align="center" wrap layout={{ marginBottom: 4 }} />
                <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Icon icon={Hexagon} size={24} color={COLOR.primary} />
                  <Label text={String(projectedBalance)} size={TEXT["4xl"]} font="display" weight="700" color={COLOR.primary} />
                </View>
                <Label text={t("certificateStore.earnRate")} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap layout={{ marginTop: 4 }} />
                {/* Both currencies are called "hours" and both render as "5h", so the
                    store reads as if it spends the same wallet as the upgrade shop. */}
                <View layout={{ width: Math.min(256, contentWidth - 48), marginTop: 2 }}>
                  <Label text={t("certificateStore.walletNote")} size={TINY} color={COLOR.mutedForeground} alpha={0.7} align="center" wrap />
                </View>
              </View>
            </Appear>

            {/* Cert list */}
            <ScrollView layout={{ flex: 1, alignSelf: "stretch", gap: 24, paddingRight: 4 }}>

              {/* ── Unlocked & levels available ── */}
              {available.length > 0 && (
                <CertSection title={t("certificateStore.sectionAvailable")}>
                  {available.map((cert, i) => (
                    <Appear key={cert.id} delay={0.15 + i * 0.04}>
                      <CertAvailableCard
                        cert={cert}
                        levelsOwned={certLevelsOwned[cert.id] || 0}
                        selectedTarget={selectedLevels[cert.id]}
                        certLevelsOwned={certLevelsOwned}
                        totalCertificateHours={totalCertificateHours}
                        expanded={expandedCertId === cert.id}
                        onToggle={toggleCard(cert.id)}
                        onLevelTap={level => handleLevelTap(cert.id, level)}
                        onBuy={() => handleBuy(cert)}
                      />
                    </Appear>
                  ))}
                </CertSection>
              )}

              {/* ── Locked ── */}
              {locked.length > 0 && (
                <CertSection title={t("certificateStore.sectionLocked")}>
                  {locked.map((cert, i) => (
                    <Appear key={cert.id} delay={0.2 + i * 0.03}>
                      <CertLockedCard cert={cert} ctx={ctx} expanded={expandedCertId === cert.id} onToggle={toggleCard(cert.id)} />
                    </Appear>
                  ))}
                </CertSection>
              )}

              {/* ── Fully purchased ── */}
              {maxed.length > 0 && (
                <CertSection title={t("certificateStore.sectionComplete")}>
                  {maxed.map((cert, i) => (
                    <Appear key={cert.id} delay={0.25 + i * 0.03}>
                      <CertMaxedCard cert={cert} expanded={expandedCertId === cert.id} onToggle={toggleCard(cert.id)} />
                    </Appear>
                  ))}
                </CertSection>
              )}

              {certificates.length === 0 && (
                <View layout={{ paddingTop: 32, paddingBottom: 32 }}>
                  <Label text={t("certificateStore.loading")} size={TEXT.sm} color={COLOR.mutedForeground} align="center" wrap />
                </View>
              )}
            </ScrollView>

            {/* Back */}
            <Appear fromY={20} delay={0.4} layout={{ marginTop: -12 }}>
              <ArcadeButton variant="secondary" text={t("certificateStore.continue")} icon={ArrowLeft} onTap={onBack} />
            </Appear>
          </View>
        </Appear>
      </View>

      {showTutorial && (
        <TutorialOverlay
          visible
          title={t("certificateStore.tutorialTitle")}
          body={t("certificateStore.tutorialBody")}
          arrowDirection="none"
          onDismiss={() => onTutorialDismiss?.()}
        />
      )}
    </View>
  );
}

function CertSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View>
      <Label text={title} size={TEXT.xs} font="display" weight="700" upper letterSpacing={1.2} color={COLOR.mutedForeground}
        layout={{ marginBottom: 8, marginLeft: 4 }} />
      <View layout={{ gap: 12 }}>{children}</View>
    </View>
  );
}

/** The hairline between a card's header and its open body. */
function CertDivider({ color }: { color: string }) {
  return <View layout={{ height: 1, backgroundColor: color, marginBottom: 12 }} />;
}

function CertAvailableCard({
  cert, levelsOwned, selectedTarget, certLevelsOwned, totalCertificateHours, expanded, onToggle, onLevelTap, onBuy,
}: {
  cert: Certificate; levelsOwned: number; selectedTarget: number | undefined;
  certLevelsOwned: Record<string, number>; totalCertificateHours: number;
  expanded: boolean; onToggle: () => void; onLevelTap: (level: number) => void; onBuy: () => void;
}) {
  const { t } = useTranslation();
  const { pendingCost, canAfford, shortBy } = pendingPurchase(cert, selectedTarget, certLevelsOwned, totalCertificateHours);
  const nextCost = nextLevelCost(cert, levelsOwned);
  return (
    // The header is the toggle and the body is not inside it: purchases happen
    // in the body, and a tap there must not collapse the card.
    <View layout={{
      borderRadius: RADIUS.lg, borderWidth: 2, backgroundColor: COLOR.card,
      // A pending selection lights the card up (the DOM's stronger glow).
      borderColor: tint(COLOR.primary, selectedTarget != null ? 0.85 : 0.4),
    }}>
      <Pressable onTap={onToggle} pressedAlpha={0.85} label={contentText.certName(t, cert)} layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 }}>
        <View layout={{ flex: 1 }}>
          <Label text={contentText.certName(t, cert)} size={TEXT.base} font="display" weight="700" wrap />
          <Label text={contentText.certDesc(t, cert)} size={TEXT.xs} color={COLOR.mutedForeground} wrap layout={{ marginTop: 2 }} />
        </View>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View layout={{ alignItems: "flex-end" }}>
            <Label text={t("certificateStore.levelFraction", { owned: levelsOwned, total: cert.levels.length })}
              size={TEXT.xs} font="display" weight="700" color={COLOR.primary} />
            {/* Price of the next level up front, so a collapsed list can be
                scanned for what is affordable without opening every card. */}
            {nextCost != null && (
              <Label text={t("certificateStore.nextLevelCost", { cost: nextCost })} size={TINY}
                color={nextCost <= totalCertificateHours ? COLOR.mutedForeground : COLOR.destructive}
                alpha={nextCost <= totalCertificateHours ? 1 : 0.8} />
            )}
          </View>
          <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} color={COLOR.primary} />
        </View>
      </Pressable>

      {/* Accordion body: level rows + buy row */}
      {expanded && (
        <Appear duration={0.2} layout={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
          <CertDivider color={tint(COLOR.primary, 0.2)} />
          {/* One row per level, not a chip row: the row is what makes space
              for the EFFECT, and a level whose effect you cannot read is a
              blind purchase. */}
          <View layout={{ gap: 6, marginBottom: 12 }}>
            {cert.levels.map((level, idx) => {
              const levelNum = idx + 1;
              return (
                <CertLevelRow
                  key={levelNum}
                  levelNum={levelNum}
                  state={levelRowState(levelNum, levelsOwned, selectedTarget)}
                  effect={certEffectLabel(t, level.effect)}
                  cost={level.cost}
                  onTap={() => onLevelTap(levelNum)}
                />
              );
            })}
          </View>

          {selectedTarget != null && (
            <View>
              <View layout={{ height: 1, backgroundColor: tint(COLOR.primary, 0.2), marginBottom: 8 }} />
              <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <View layout={{ flex: 1 }}>
                  {/* Tapping Lv 3 also buys Lv 2, so name the range: the total
                      cost alone doesn't explain where it came from. */}
                  <Label text={buyingText(t, levelsOwned, selectedTarget)} size={TEXT.xs} weight="700" color={COLOR.primary} alpha={0.8} wrap />
                  <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 4 }}>
                    <Label text={t("certificateStore.cost")} size={TEXT.sm} color={COLOR.mutedForeground} />
                    <Label text={t("certificateStore.hoursValue", { hours: pendingCost })} size={TEXT.sm} weight="700"
                      color={canAfford ? COLOR.primary : COLOR.destructive} />
                    {!canAfford && (
                      <Label text={t("certificateStore.needMore", { hours: shortBy })} size={TEXT.xs} color={COLOR.destructive} alpha={0.8} />
                    )}
                  </View>
                </View>
                <ArcadeButton
                  text={t("certificateStore.buyUpToLevel", { level: selectedTarget })}
                  iconAfter={ChevronRight} iconSize={16} variant="primary" textSize={TEXT.sm}
                  disabled={!canAfford} onTap={onBuy}
                  contentLayout={{ paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, gap: 6 }}
                />
              </View>
            </View>
          )}
        </Appear>
      )}
    </View>
  );
}

function CertLevelRow({ levelNum, state, effect, cost, onTap }: {
  levelNum: number; state: "owned" | "selected" | "open"; effect: string; cost: number; onTap: () => void;
}) {
  const { t } = useTranslation();
  const owned = state === "owned";
  const ink = COLOR.primary;
  const inkAlpha = owned ? 0.6 : 1;
  const layout = {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 10,
    paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: owned ? tint(ink, 0.25) : state === "selected" ? ink : tint(ink, 0.4),
    backgroundColor: owned ? tint(ink, 0.1) : state === "selected" ? tint(ink, 0.25) : tint(ink, 0.05),
  };
  const content = (
    <>
      <Icon icon={owned ? Check : Hexagon} size={16} color={ink} alpha={owned ? inkAlpha : 0.8} />
      <Label text={t("certificateStore.levelLabel", { level: levelNum })} size={TEXT.sm} font="display" weight="700" color={ink} alpha={inkAlpha} />
      {/* Falls back to nothing rather than a guess when the effect has no
          label; the description still stands. */}
      <View layout={{ flex: 1 }}>
        {effect !== "" && <Label text={effect} size={TEXT.xs} lineHeight={TEXT.xs * 1.25} color={ink} alpha={inkAlpha * 0.9} wrap />}
      </View>
      <Label text={owned ? t("certificateStore.levelOwned") : t("certificateStore.hoursValue", { hours: cost })}
        size={TEXT.xs} weight="700" color={ink} alpha={owned ? inkAlpha : 0.9} />
    </>
  );
  // An owned level is a record, not a button: it takes no tap.
  if (owned) return <View layout={layout}>{content}</View>;
  return <Pressable onTap={onTap} label={t("certificateStore.levelLabel", { level: levelNum })} layout={layout}>{content}</Pressable>;
}

function CertLockedCard({ cert, ctx, expanded, onToggle }: { cert: Certificate; ctx: UnlockContext; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const unlock = getUnlockInfo(t, cert, ctx);
  const value = unlock.current / unlock.required;
  return (
    // Nothing in a locked card is interactive, so the whole card is the toggle.
    <Pressable onTap={onToggle} pressedAlpha={0.85} alpha={expanded ? 0.85 : 0.6} label={contentText.certName(t, cert)} layout={{
      padding: 16, borderRadius: RADIUS.lg, borderWidth: 1,
      borderColor: tint(COLOR.muted, 0.3), backgroundColor: tint(COLOR.muted, 0.05),
    }}>
      <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <Icon icon={Lock} size={16} color={COLOR.mutedForeground} layout={{ marginTop: 2 }} />
        <View layout={{ flex: 1 }}>
          <Label text={contentText.certName(t, cert)} size={TEXT.sm} font="display" weight="700" color={COLOR.mutedForeground} wrap />
          <Label text={contentText.certDesc(t, cert)} size={TEXT.xs} color={COLOR.mutedForeground} alpha={0.7} wrap layout={{ marginTop: 2 }} />
          {unlock.required > 1 && (
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
              <ProgressBar value={value} height={4} track={tint(COLOR.muted, 0.3)} layout={{ flex: 1 }} />
              {/* The bare bar said nothing about what it was counting.
                  Numbers here mean the tap is for the "how", not the "how far". */}
              <Label text={t("certificateStore.progressShort", { current: unlock.current, required: unlock.required, label: unlock.progressLabel })}
                size={TINY} color={COLOR.mutedForeground} />
            </View>
          )}
        </View>
        {/* The "how to unlock" mark: the card itself takes the tap. */}
        <Icon icon={Info} size={20} color={expanded ? COLOR.white : COLOR.mutedForeground} />
      </View>

      {/* Accordion body: unlock requirement + progress, inline */}
      {expanded && (
        <Appear duration={0.2} layout={{ marginTop: 12 }}>
          <CertDivider color={tint(COLOR.white, 0.1)} />
          <View layout={{ gap: 6 }}>
            <Label text={t("certificateStore.howToUnlock")} size={TEXT.xs} font="display" weight="700" upper letterSpacing={0.6} color={COLOR.white} />
            <Label text={unlock.requirementText} size={TEXT.xs} lineHeight={RELAXED} color={COLOR.foreground} alpha={0.85} wrap />
            <Label
              text={t("certificateStore.progress", {
                current: unlock.current,
                required: unlock.required,
                label: unlock.progressLabel ? ` ${unlock.progressLabel}` : "",
              })}
              size={TEXT.xs} weight="700" color={COLOR.white} wrap
            />
            <ProgressBar value={value} height={6} track={tint(COLOR.muted, 0.4)} />
          </View>
        </Appear>
      )}
    </Pressable>
  );
}

function CertMaxedCard({ cert, expanded, onToggle }: { cert: Certificate; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onTap={onToggle} pressedAlpha={0.85} alpha={expanded ? 1 : 0.85} label={contentText.certName(t, cert)} layout={{
      padding: 16, borderRadius: RADIUS.lg, borderWidth: 1,
      borderColor: tint(COLOR.primary, 0.3), backgroundColor: tint(COLOR.primary, 0.05),
    }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon icon={Check} size={20} color={COLOR.primary} />
        <View layout={{ flex: 1 }}>
          <Label text={contentText.certName(t, cert)} size={TEXT.sm} font="display" weight="700" wrap />
        </View>
        <Label text={t("certificateStore.levelFraction", { owned: cert.levels.length, total: cert.levels.length })}
          size={TEXT.xs} font="display" weight="700" color={COLOR.primary} alpha={0.8} />
        <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} color={COLOR.primary} />
      </View>

      {expanded && (
        <Appear duration={0.2} layout={{ marginTop: 12 }}>
          <CertDivider color={tint(COLOR.primary, 0.2)} />
          <Label text={contentText.certDesc(t, cert)} size={TEXT.xs} color={COLOR.mutedForeground} wrap />
        </Appear>
      )}
    </Pressable>
  );
}

/**
 * The upgrade shop's pieces on the canvas (canvas port of the markup inside
 * components/game/UpgradeShop.tsx): the shelf card, the status pills, the
 * banners and the three modals. UpgradeShop.tsx keeps the state; these draw it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LayoutContainer } from "@pixi/layout/components";
import type { Graphics } from "pixi.js";
import { animate } from "motion";
// Info directly, not the kit's HoldHint: that is fixed at 0.8 alpha and the card's hint is fainter (opacity-30).
import { Check, Clock, Info as HoldInfoIcon, Lock, Medal, RefreshCw } from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import type { Certificate } from "@/types/certificate";
import { conditionMet, type RunContext } from "@/lib/upgradeConditions";
import { unlockRequirements } from "@/lib/upgradeUnlock";
import { contentText } from "@/i18n/content";
import { getUpgradeIcon } from "@/components/game/upgradeIcons";
import {
  Appear, COLOR, HoldHint, Icon, Label, Modal, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, usePulse, useUiScreen,
  type Layout,
} from "../kit/ui";
import type { IconSource } from "../kit/icons";
import { TagChip } from "../game/TagChip";
import { ConditionChip } from "../game/ConditionChip";
import { AbilityIcon } from "../game/AbilityIcon";
import { cardLook, lockedReasonParts, tierPalette, type CardModel, type CertChase } from "./shopModel";
import { DRAFT_HINT } from "./draftModel";
import { RichParagraph, TopRule } from "./draftParts";

const RED = hex("#ff6b6b");
const CHECKPOINT = hex("#00ff88");
const YELLOW_300 = 0xfde047;
const YELLOW_400 = 0xfacc15;
const YELLOW_500 = 0xeab308;
const GREEN_500 = 0x22c55e;
const AMBER_700 = 0xb45309;
/** The explainer cards' width (max-w-sm). */
const MODAL_W = 384;

// ── Small pieces ───────────────────────────────────────────────────────────

/** Shakes sideways once each time `active` turns on: the shop's "can't afford" no. */
function Shake({ active, children, layout }: { active: boolean; children?: ReactNode; layout?: Layout }) {
  const ref = useRef<LayoutContainer | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const controls = animate(0, [-10, 10, -8, 8, -4, 4, 0], {
      duration: 0.5,
      // `x` is an offset on the laid-out position (the layout transform ignores pivot).
      onUpdate: (x: number) => { if (!node.destroyed) node.x = x; },
    });
    return () => { controls.stop(); if (!node.destroyed) node.x = 0; };
  }, [active]);
  return <layoutContainer ref={ref} layout={layout ?? {}}>{children}</layoutContainer>;
}

/** Text with a line through it (Tailwind `line-through`): the price before a discount. */
function Struck({ text, size, color, alpha }: { text: string; size: number; color: number; alpha?: number }) {
  return (
    <View alpha={alpha} layout={{ justifyContent: "center" }}>
      <Label text={text} size={size} color={color} />
      <View layout={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: color }} />
    </View>
  );
}

interface PillProps {
  text: string;
  icon?: IconSource;
  color: number;
  border: number | string;
  background?: number | string;
  size?: number;
  alpha?: number;
  /** The DOM's hover `title`, offered as the game's hold-to-explain instead. */
  onHold?: () => void;
}

/** A rounded status chip (market rates, restocks, Budget Cycle, Runway). */
export function Pill({ text, icon, color, border, background, size = 11, alpha, onHold }: PillProps) {
  return (
    <Pressable
      onHold={onHold}
      pressedAlpha={1}
      alpha={alpha}
      label={text}
      layout={{
        flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
        borderRadius: RADIUS.full, borderWidth: 1, borderColor: border,
        ...(background !== undefined ? { backgroundColor: background } : {}),
      }}
    >
      {icon && <Icon icon={icon} size={12} color={color} />}
      <Label text={text} size={size} weight="600" color={color} />
    </Pressable>
  );
}

// ── Banners ────────────────────────────────────────────────────────────────

/**
 * Closed banner: the round didn't lock enough balls to earn the store.
 * Press and hold it for an explainer of why the store is shut.
 */
export function ClosedBanner({ locksHave, locksNeed, onHold }: { locksHave?: number; locksNeed?: number; onHold: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <Appear fromScale={0.9} delay={0.08}>
      <Pressable
        onHold={onHold}
        pressedAlpha={1}
        label={t("upgradeShop.closedNotEnoughLocks")}
        layout={{
          maxWidth: screen.width - 48,
          flexDirection: "row", alignItems: "center", gap: 8, borderRadius: RADIUS.lg,
          paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
          borderWidth: 2, borderColor: tint(RED, 0x66 / 255), backgroundColor: tint(RED, 0x12 / 255),
        }}
      >
        <Icon icon={Lock} size={16} color={RED} />
        {/* Word by word, so on a narrow phone it wraps instead of pushing the count off the banner. */}
        <View layout={{ flexShrink: 1 }}>
          <RichParagraph align="left" runs={[{ text: t("upgradeShop.closedNotEnoughLocks") }]} size={TEXT.sm} weight="700" upper letterSpacing={0.35} color={RED} />
        </View>
        {typeof locksNeed === "number" && (
          <View layout={{ borderRadius: RADIUS.base, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(RED, 0x26 / 255) }}>
            <Label text={`${locksHave ?? 0}/${locksNeed}`} size={TEXT.sm} weight="700" color={RED} />
          </View>
        )}
        <HoldHint color={RED} size={14} />
      </Pressable>
    </Appear>
  );
}

/**
 * A soft glow around its content (the DOM's coloured box-shadow): rounded
 * outlines stepping outward, each fainter, so the edge fades instead of
 * stopping at a hard border. It measures its own box, since the height
 * follows the content.
 */
function Glow({ color, alpha, spread, radius, children, layout }: {
  color: number; alpha: number; spread: number; radius: number; children?: ReactNode; layout?: Layout;
}) {
  const ref = useRef<LayoutContainer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const onLayout = (l: { computedLayout: { width: number; height: number } }) => {
      const { width: w, height: h } = l.computedLayout;
      setSize(prev => (Math.abs(prev.w - w) >= 1 || Math.abs(prev.h - h) >= 1 ? { w, h } : prev));
    };
    box.on("layout", onLayout);
    const done = box.layout?.computedLayout;
    if (done && done.width > 0) onLayout({ computedLayout: done });
    return () => { box.off("layout", onLayout); };
  }, []);
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (size.w <= 0 || alpha <= 0) return;
    for (let i = 1; i <= spread; i += 2) {
      const falloff = (1 - i / (spread + 1)) ** 2;
      g.roundRect(-i, -i, size.w + i * 2, size.h + i * 2, radius + i).stroke({ color, width: 2, alpha: alpha * falloff });
    }
  }, [size, color, alpha, spread, radius]);
  return (
    <layoutContainer ref={ref} layout={layout ?? {}}>
      <pixiGraphics draw={draw} layout={false} />
      {children}
    </layoutContainer>
  );
}

/** Waypoint banner, shown only on multiples of 5. Its own component so its pulse re-renders only itself. */
export function WaypointBanner({ level }: { level: number }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  // The banner breathes: its glow swells and the kicker dims, on one 2s cycle.
  const pulse = usePulse(2000);
  return (
    <Appear fromScale={0.75} delay={0.08}>
      {/* A steady glow (box-shadow 24px #00ff8866, 48px #00ff8833) plus the
          pulsing ring that swells to 32px #00ff8888 and back. */}
      <Glow color={CHECKPOINT} alpha={0.12 + 0.18 * pulse} spread={24} radius={RADIUS.xl}
        layout={{ width: Math.min(384, screen.width - 48) }}>
        <View layout={{
          alignItems: "center", gap: 4, borderRadius: RADIUS.xl, paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 16,
          backgroundColor: tint(CHECKPOINT, 0x18 / 255), borderWidth: 2, borderColor: CHECKPOINT,
        }}>
          {/* Word by word, so a long translation wraps inside the banner; the
              no-break spaces keep each flag on its word's line. */}
          <View layout={{ alignSelf: "stretch" }} alpha={1 - 0.3 * pulse}>
            <RichParagraph runs={[{ text: `⚑\u00A0${t("upgradeShop.checkpointReached")}\u00A0⚑` }]}
              size={TEXT.xs} weight="700" upper letterSpacing={3.6} font="display" color={CHECKPOINT} />
          </View>
          {/* The DOM pulsed this text-shadow too; held steady here, because a
              changing glow re-rasterises the text on every frame. */}
          <Label text={t("upgradeShop.levelBanner", { level })} size={TEXT["4xl"]} weight="900" letterSpacing={3.6} font="display" color={CHECKPOINT} glow={16} />
          <Label text={t("upgradeShop.progressSavedHere")} size={TEXT.xs} upper letterSpacing={1.2} font="mono" color={DRAFT_HINT} wrap align="center" />
        </View>
      </Glow>
    </Appear>
  );
}

/** A certificate this purchase finished unlocking. */
export function CertUnlockedRow({ cert }: { cert: Certificate }) {
  const { t } = useTranslation();
  return (
    <View layout={{
      flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: RADIUS.lg,
      borderWidth: 1, borderColor: tint(YELLOW_500, 0.4), backgroundColor: tint(YELLOW_500, 0.1),
    }}>
      <Icon icon={Medal} size={16} color={YELLOW_400} />
      <View layout={{ flex: 1 }}>
        <Label text={t("upgradeShop.certificateUnlocked")} size={TEXT.xs} weight="700" upper letterSpacing={0.6} color={YELLOW_400} wrap />
        <Label text={contentText.certName(t, cert)} size={TEXT.sm} weight="600" color={COLOR.foreground} wrap />
      </View>
    </View>
  );
}

// ── The shelf card ─────────────────────────────────────────────────────────

interface ShopCardProps {
  upgrade: UpgradeConfig;
  model: CardModel;
  upgrades: UpgradeConfig[];
  index: number;
  shaking: boolean;
  lockedInfoOpen: boolean;
  hasDiscount: boolean;
  mapsRemaining: number;
  runContext: RunContext | null;
  onTap: () => void;
  onHold: () => void;
  onLockTap: () => void;
}

/**
 * One offer. Selection has to read at arm's length on a phone, in a strip
 * where a neighbour is always half in frame, so a selected card takes the same
 * three-part treatment DraftCard uses - tinted ground, solid accent border and
 * an outer ring - which is also what makes the shop and the drafts read as
 * one system. The ability slot is drawn inverted (light ground, dark ink) so
 * it never reads as a fourth upgrade.
 */
export function ShopCard({
  upgrade, model, upgrades, index, shaking, lockedInfoOpen, hasDiscount, mapsRemaining, runContext, onTap, onHold, onLockTap,
}: ShopCardProps) {
  const { t } = useTranslation();
  const { inv, isChoice, chosenMember, displayUpgrade, owned, selected, locked, shownPrice, purchasable, cantAfford, certChase, certShown } = model;
  const tier = tierPalette(upgrade.tier);
  const look = cardLook({ selected, owned, locked, purchasable, cantAfford }, inv, tier.border);
  // On the inverted card the tier palette is unreadable (light on light), so
  // the ability's own colour carries the icon and kicker, and the rest steps
  // down through the dark ink.
  const headColor = inv ? (upgrade.abilityColor ? hex(upgrade.abilityColor) : COLOR.background) : tier.text;
  const ink = inv ? COLOR.background : COLOR.foreground;
  const UpgradeIcon = getUpgradeIcon(displayUpgrade, upgrades);
  const inert = owned || locked;
  const priceColor = inv
    ? (purchasable ? AMBER_700 : COLOR.background)
    : (purchasable ? YELLOW_500 : COLOR.mutedForeground);
  const priceAlpha = inv && !purchasable ? 0.6 : 1;

  return (
    <Appear fromScale={0.9} delay={index * 0.05} layout={{ flex: 1 }}>
      <Shake active={shaking} layout={{ flex: 1 }}>
        {/* The outer ring (ring-2 ring-offset-2): always there, coloured only when selected, so selecting never resizes the card. */}
        <View layout={{ flex: 1, padding: 2, borderRadius: RADIUS.xl + 4, borderWidth: 2, borderColor: look.ring ?? tint(COLOR.black, 0) }}>
          <Pressable
            onTap={inert ? undefined : onTap}
            onHold={onHold}
            pressedAlpha={inert ? 1 : 0.85}
            alpha={look.alpha}
            label={inv ? upgrade.name : contentText.upgradeName(t, upgrade)}
            layout={{
              flex: 1, padding: 20, gap: 12, borderRadius: RADIUS.xl,
              backgroundColor: look.background, borderWidth: 2, borderColor: look.border,
            }}
          >
            {/* Identity: icon, tier, name. One block, so the name has room to be a heading. */}
            <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 24 }}>
              {inv
                ? <AbilityIcon kind={upgrade.abilityKind ?? ""} size={40} color={headColor} />
                : UpgradeIcon && <Icon icon={UpgradeIcon} size={40} strokeWidth={1.5} color={headColor} />}
              <View layout={{ flex: 1 }}>
                <Label
                  text={inv ? t("upgradeShop.abilityKicker") : contentText.tier(t, upgrade.tier)}
                  size={11} weight="600" upper letterSpacing={2} color={headColor}
                />
                <Label
                  text={inv ? upgrade.name : contentText.upgradeName(t, upgrade)}
                  size={TEXT.xl} weight="700" lineHeight={25} color={ink} wrap
                />
              </View>
            </View>

            {/* Archetype tag chips, and the situation a conditional upgrade needs. */}
            {((upgrade.tags?.length ?? 0) > 0 || upgrade.condition) && (
              <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {upgrade.tags?.map(tag => <TagChip key={tag} tag={tag} />)}
                {upgrade.condition && (
                  <ConditionChip condition={upgrade.condition} live={conditionMet(upgrade.condition, runContext)} />
                )}
              </View>
            )}

            {/* Description: the only text on the screen the player has to
                actually read, so it gets the largest type after the name. */}
            <Label
              text={isChoice && !chosenMember ? t("upgradeShop.choicePrompt") : contentText.upgradeDesc(t, displayUpgrade)}
              size={TEXT.lg} lineHeight={29}
              color={inv ? COLOR.background : COLOR.mutedForeground}
              alpha={inv ? 0.75 : 1}
              wrap
            />
            {/* What a retainer actually buys, in the only unit that makes its price legible: maps still to come. */}
            {inv && (
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }} alpha={0.8}>
                <Icon icon={RefreshCw} size={16} color={COLOR.background} />
                <Label text={t("upgradeShop.abilityEveryMap", { count: mapsRemaining })} size={TEXT.sm} weight="600" color={COLOR.background} />
              </View>
            )}

            {/* Certificate chase: this purchase is also progress toward a permanent unlock. */}
            {certChase && <CertChaseRow chase={certChase} shown={certShown} />}

            {/* The locked card's reason, opened from its lock. In flow at the
                card's foot: hung below the card it would be clipped by the strip. */}
            {locked && !owned && lockedInfoOpen && (
              <View layout={{ borderRadius: RADIUS.base, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border }}>
                <Label
                  text={`${t("upgradeShop.requires")} ${lockedReasonParts(t, upgrade, upgrades, model.effectiveOwned).join(", ")}`}
                  size={TEXT.xs} color={COLOR.mutedForeground} wrap
                />
              </View>
            )}

            {/* Cost, pinned to the card's foot whatever the description's length. */}
            {!owned && (
              <>
                <View layout={{ flex: 1 }} />
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8 }} alpha={priceAlpha}>
                  <Icon icon={Clock} size={20} color={priceColor} />
                  {(hasDiscount || shownPrice === 0) && (
                    <Struck text={t("upgradeShop.hoursValue", { hours: displayUpgrade.cost })} size={TEXT.sm} color={priceColor} alpha={0.5} />
                  )}
                  {isChoice && !chosenMember && (
                    <Label text={t("upgradeShop.fromLabel")} size={TEXT.xs} color={priceColor} alpha={0.7} />
                  )}
                  <Label
                    text={shownPrice === 0 ? t("upgradeShop.freeLabel") : t("upgradeShop.hoursValue", { hours: shownPrice })}
                    size={TEXT.lg} weight="700" color={priceColor}
                  />
                </View>
              </>
            )}

            {/* Status badge, top right. A filled badge for "selected": a bare
                tick was lost against a bright icon. */}
            <View layout={{ position: "absolute", top: 12, right: 12 }}>
              {selected ? (
                <View layout={{ borderRadius: RADIUS.full, padding: 4, backgroundColor: COLOR.primary }}>
                  <Icon icon={Check} size={16} strokeWidth={3} color={COLOR.primaryForeground} />
                </View>
              ) : owned ? (
                <Icon icon={Check} size={16} color={GREEN_500} />
              ) : locked ? (
                <Pressable onTap={onLockTap} label={t("upgradeShop.requires")} layout={{ padding: 2, margin: -2 }}>
                  <Icon icon={Lock} size={16} color={COLOR.mutedForeground} />
                </Pressable>
              ) : (
                // The holdable affordance lives ON the holdable thing.
                <Icon icon={HoldInfoIcon} size={16} color={ink} alpha={0.3} />
              )}
            </View>
          </Pressable>
        </View>
      </Shake>
    </Appear>
  );
}

function CertChaseRow({ chase, shown }: { chase: CertChase; shown: number }) {
  const { t } = useTranslation();
  const done = shown >= chase.required;
  const color = done ? YELLOW_300 : YELLOW_400;
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }} alpha={done ? 1 : 0.8}>
      <Icon icon={Medal} size={14} color={color} />
      <View layout={{ flex: 1 }}>
        <Label text={contentText.certName(t, chase.cert)} size={TEXT.xs} color={color} truncate />
      </View>
      <Label text={t("upgradeShop.certRuns", { current: shown, required: chase.required })} size={TEXT.xs} weight="700" color={color} />
    </View>
  );
}

// ── Modals ─────────────────────────────────────────────────────────────────

interface DetailProps {
  upgrade: UpgradeConfig;
  upgrades: UpgradeConfig[];
  dependents: UpgradeConfig[];
  /** Owned or selected: a relation the player already has gets a tick. */
  has: (id: string) => boolean;
  cert: CertChase | undefined;
  runContext: RunContext | null;
  accent: number;
  onClose: () => void;
}

/**
 * Press-and-hold detail card: track relationships (what unlocks this, and
 * what this unlocks). Backdrop or X closes it.
 */
export function UpgradeDetailModal({ upgrade: u, upgrades, dependents, has, cert, runContext, accent, onClose }: DetailProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const DetailIcon = getUpgradeIcon(u, upgrades);
  const tc = tierPalette(u.tier);
  // Both gates: "Nothing required" over a card the shop refuses to sell is a lie.
  const need = unlockRequirements(u, upgrades);

  const relRow = (rel: UpgradeConfig) => {
    const RelIcon = getUpgradeIcon(rel, upgrades);
    const relTc = tierPalette(rel.tier);
    return (
      <View key={rel.id} layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {RelIcon && <Icon icon={RelIcon} size={16} strokeWidth={1.5} color={relTc.text} />}
        <View layout={{ flex: 1 }}>
          <Label text={contentText.upgradeName(t, rel)} size={TEXT.sm} color={COLOR.foreground} truncate />
        </View>
        <Label text={contentText.tier(t, rel.tier)} size={10} upper letterSpacing={0.5} color={relTc.text} />
        {has(rel.id) && <Icon icon={Check} size={14} color={GREEN_500} />}
      </View>
    );
  };
  const sectionTitle = (text: string) => (
    <Label text={text} size={11} weight="600" upper letterSpacing={0.6} color={COLOR.mutedForeground} alpha={0.8} layout={{ marginBottom: 6 }} />
  );
  const none = (text: string) => <Label text={text} size={TEXT.xs} color={COLOR.mutedForeground} alpha={0.6} wrap />;

  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent}>
      {/* Bounded and scrollable, so a tall card is never clipped out of both ends. */}
      <ScrollView layout={{ maxHeight: screen.height - 160 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
          {DetailIcon && <Icon icon={DetailIcon} size={32} strokeWidth={1.5} color={tc.text} />}
          <View layout={{ flex: 1 }}>
            <Label text={contentText.upgradeName(t, u)} size={TEXT.base} weight="700" color={COLOR.foreground} truncate />
            <Label text={contentText.tier(t, u.tier)} size={TEXT.xs} color={tc.text} />
          </View>
        </View>

        {((u.tags?.length ?? 0) > 0 || u.condition) && (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {u.tags?.map(tag => <TagChip key={tag} tag={tag} sizeClass="text-[10px]" />)}
            {u.condition && <ConditionChip condition={u.condition} live={conditionMet(u.condition, runContext)} />}
          </View>
        )}

        <Label text={contentText.upgradeDesc(t, u)} size={TEXT.base} color={COLOR.mutedForeground} wrap layout={{ marginBottom: 16 }} />

        {/* Unlocked by (prerequisites) */}
        <View layout={{ marginBottom: 12 }}>
          {sectionTitle(t("upgradeShop.detailUnlockedBy"))}
          {need.prereqs.length > 0 || need.maxedFamily ? (
            <View layout={{ gap: 6 }}>
              {need.prereqs.map(relRow)}
              {need.maxedFamily && (
                <Label text={t("upgradeShop.requiresMaxedFamily", { family: need.maxedFamily })} size={TEXT.xs} color={COLOR.mutedForeground} wrap />
              )}
            </View>
          ) : none(t("upgradeShop.detailNoPrereqs"))}
        </View>

        {/* Unlocks (dependents) */}
        <View>
          {sectionTitle(t("upgradeShop.detailUnlocks"))}
          {dependents.length > 0
            ? <View layout={{ gap: 6 }}>{dependents.map(relRow)}</View>
            : none(t("upgradeShop.detailNoUnlocks"))}
        </View>

        {/* The card note only has room for a fraction; this is where the rule
            behind it is stated, including that the runs must be SEPARATE. */}
        {cert && (
          <View layout={{ marginTop: 12, paddingTop: 12 }}>
            <TopRule />
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Icon icon={Medal} size={14} color={YELLOW_400} />
              <Label text={t("upgradeShop.detailCertificate")} size={11} weight="600" upper letterSpacing={0.6} color={YELLOW_400} />
            </View>
            <Label
              text={t("upgradeShop.detailCertificateBody", { name: contentText.certName(t, cert.cert), required: cert.required, current: cert.current })}
              size={TEXT.xs} color={COLOR.mutedForeground} wrap
            />
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

/** Closed-store explainer, opened by holding the banner. */
export function ClosedInfoModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={RED} title={t("upgradeShop.closedInfoTitle")}>
      <ScrollView layout={{ maxHeight: screen.height - 200 }}>
        <Label text={t("upgradeShop.closedInfoBody")} size={TEXT.sm} lineHeight={23} color={COLOR.mutedForeground} wrap />
      </ScrollView>
    </Modal>
  );
}

/** A pill's explanation (the DOM's hover title), opened by holding it. */
export function ChipInfoModal({ text, accent, onClose }: { text: string; accent: number; onClose: () => void }) {
  const screen = useUiScreen();
  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent}>
      <Label text={text} size={TEXT.sm} lineHeight={22} color={COLOR.mutedForeground} wrap />
    </Modal>
  );
}

interface ChooserProps {
  options: UpgradeConfig[];
  selectedIds: string[];
  price: (u: UpgradeConfig) => number;
  budget: number;
  accent: number;
  onChoose: (u: UpgradeConfig) => void;
  onClose: () => void;
}

/**
 * Tier-3 choice chooser, opened by tapping a choice card. Pick ONE of the
 * group's mutually exclusive options (each costs 50% more).
 */
export function ChoiceChooserModal({ options, selectedIds, price, budget, accent, onChoose, onClose }: ChooserProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent} title={contentText.upgradeName(t, options[0])}>
      <ScrollView layout={{ maxHeight: screen.height - 200 }}>
        <Label text={t("upgradeShop.choiceModalHint")} size={TEXT.xs} color={COLOR.mutedForeground} wrap layout={{ marginBottom: 16 }} />
        <View layout={{ gap: 8 }}>
          {options.map(opt => {
            const p = price(opt);
            const isSel = selectedIds.includes(opt.id);
            const affordable = p <= budget;
            const tc = tierPalette(opt.tier);
            return (
              <View key={opt.id} layout={{ padding: 2, borderRadius: RADIUS.lg + 4, borderWidth: 2, borderColor: isSel ? tint(COLOR.white, 0.9) : tint(COLOR.black, 0) }}>
                <Pressable
                  onTap={() => onChoose(opt)}
                  alpha={affordable ? 1 : 0.6}
                  label={contentText.upgradeDesc(t, opt)}
                  layout={{ borderRadius: RADIUS.lg, borderWidth: 2, borderColor: affordable || isSel ? tc.border : COLOR.muted, padding: 12, gap: 4 }}
                >
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View layout={{ flex: 1 }}>
                      <Label text={contentText.upgradeDesc(t, opt)} size={TEXT.base} weight="600" color={COLOR.foreground} wrap />
                    </View>
                    {isSel && <Icon icon={Check} size={16} color={COLOR.white} />}
                  </View>
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon icon={Clock} size={14} color={YELLOW_500} />
                    <Label text={p === 0 ? t("upgradeShop.freeLabel") : t("upgradeShop.hoursValue", { hours: p })} size={TEXT.xs} weight="700" color={YELLOW_500} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Modal>
  );
}

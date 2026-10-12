/**
 * The upgrade shop's pieces on the canvas (canvas port of the markup inside
 * components/game/UpgradeShop.tsx): the ticket, the sprint panel, the status
 * pills, the banners and the three modals. UpgradeShop.tsx keeps the state; these draw it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LayoutContainer } from "@pixi/layout/components";
import type { Graphics } from "pixi.js";
import { animate } from "motion";
// Info directly, not the kit's HoldHint: that is fixed at 0.8 alpha and the card's hint is fainter (opacity-30).
import {
  Check, ChevronDown, ChevronUp, ChevronsUp, Clock, Equal, Flag, Flame, Info as HoldInfoIcon, Lock, SquareKanban, Medal, RefreshCw, X,
} from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import type { Certificate } from "@/types/certificate";
import { conditionMet, type RunContext } from "@/lib/upgradeConditions";
import { unlockRequirements } from "@/lib/upgradeUnlock";
import { contentText } from "@/i18n/content";
import { getUpgradeIcon } from "@/components/game/upgradeIcons";
import {
  Appear, COLOR, HoldHint, Icon, Label, Modal, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, hex, tint, usePulse, useTween, useUiScreen,
  type Layout,
} from "../kit/ui";
import type { IconSource } from "../kit/icons";
import { TagChip } from "../game/TagChip";
import { ConditionChip } from "../game/ConditionChip";
import { AbilityIcon } from "../game/AbilityIcon";
import { lockedReasonParts, tierPalette, type CardModel, type CertChase } from "./shopModel";
import { STATUS_KEY, capacityShare, priorityRank, ticketKey, ticketStatus, type TicketStatus } from "./storeBoardModel";
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
          alignSelf: "stretch",
          flexDirection: "row", alignItems: "center", gap: 8, borderRadius: RADIUS.sm,
          paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
          borderWidth: 1, borderColor: tint(RED, 0x66 / 255), backgroundColor: tint(RED, 0x12 / 255),
        }}
      >
        <Icon icon={Lock} size={16} color={RED} />
        {/* Word by word, so on a narrow phone it wraps instead of pushing the count off the banner. */}
        <View layout={{ flexShrink: 1 }}>
          <RichParagraph align="left" runs={[{ text: t("upgradeShop.closedNotEnoughLocks") }]} size={TEXT.sm} weight="700" color={RED} />
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
 * Waypoint banner, shown only on multiples of 5: a flat panel edged in the
 * checkpoint green, left-aligned like the rest of the pipeline. It used to
 * glow and breathe; in the redo nothing moves on its own but the headline.
 */
export function WaypointBanner({ level }: { level: number }) {
  const { t } = useTranslation();
  const kicker = t("upgradeShop.checkpointReached");
  return (
    <Appear fromY={-6} delay={0.08}>
      <View layout={{
        flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", padding: 12, borderRadius: RADIUS.sm,
        backgroundColor: ROLE.raised, borderWidth: 1, borderColor: CHECKPOINT,
      }}>
        <Icon icon={Flag} size={20} color={CHECKPOINT} />
        <View layout={{ flex: 1, gap: 2 }}>
          <Label text={`${kicker.charAt(0).toUpperCase()}${kicker.slice(1)}: ${t("pipeline.level", { level })}`}
            size={TEXT.base} weight="600" font="display" color={CHECKPOINT} wrap />
          <Label text={t("upgradeShop.progressSavedHere")} size={TEXT.xs} color={ROLE.muted} wrap />
        </View>
      </View>
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

// ── The ticket ─────────────────────────────────────────────────────────────

interface TicketCardProps {
  upgrade: UpgradeConfig;
  model: CardModel;
  upgrades: UpgradeConfig[];
  index: number;
  shaking: boolean;
  hasDiscount: boolean;
  mapsRemaining: number;
  runContext: RunContext | null;
  /** The band's accent: a ticket in the sprint wears it. */
  accent: number;
  onTap: () => void;
  onHold: () => void;
}

/** Each status's lozenge: ground and ink, the way a board colours them. */
function statusLook(status: TicketStatus, accent: number): { ground: number | string; ink: number } {
  switch (status) {
    case "inSprint": return { ground: tint(accent, 0.18), ink: accent };
    case "done": return { ground: tint(GREEN_500, 0.18), ink: GREEN_500 };
    case "blocked": return { ground: tint(RED, 0.16), ink: RED };
    case "overCapacity": return { ground: tint(ROLE.hours, 0.12), ink: ROLE.hours };
    default: return { ground: ROLE.edge, ink: ROLE.muted };
  }
}

/** The priority glyphs, lowest to highest, one per tier (storeBoardModel). */
const PRIORITY_GLYPH = [ChevronDown, Equal, ChevronUp, ChevronsUp, Flame] as const;

/**
 * One offer, drawn as a ticket on a sprint board (the store as Jira, the way
 * the owner asked for it): a stripe in the tier's colour down its left edge,
 * the ticket's type square, key and priority across the top, the title, the
 * description, the labels, then the status lozenge and the estimate in hours.
 *
 * Selecting a ticket commits it to the sprint: the lozenge says so and the
 * edge turns to the accent, in place, so nothing jumps under the finger. A
 * blocked ticket says what blocks it, always, rather than behind its lock.
 * The ability slot is a ticket of its own type ("Ability"), coloured by the
 * ability, so it never reads as a fourth upgrade.
 */
export function TicketCard({
  upgrade, model, upgrades, index, shaking, hasDiscount, mapsRemaining, runContext, accent, onTap, onHold,
}: TicketCardProps) {
  const { t } = useTranslation();
  const { inv, isChoice, chosenMember, displayUpgrade, owned, selected, locked, shownPrice, purchasable, certChase, certShown } = model;
  const tier = tierPalette(upgrade.tier);
  const typeColor = inv ? (upgrade.abilityColor ? hex(upgrade.abilityColor) : COLOR.primary) : tier.text;
  const status = ticketStatus(model);
  const lozenge = statusLook(status, accent);
  const UpgradeIcon = getUpgradeIcon(displayUpgrade, upgrades);
  const Priority = PRIORITY_GLYPH[priorityRank(upgrade.tier)];
  const inert = owned || locked;
  const name = inv ? upgrade.name : contentText.upgradeName(t, upgrade);
  const priceColor = purchasable || selected ? ROLE.hours : ROLE.muted;

  return (
    <Appear fromY={10} delay={index * 0.05} layout={{ flex: 1 }}>
      <Shake active={shaking} layout={{ flex: 1 }}>
        <Pressable
          onTap={inert ? undefined : onTap}
          onHold={onHold}
          pressedAlpha={inert ? 1 : 0.85}
          alpha={locked || owned ? 0.6 : status === "overCapacity" ? 0.75 : 1}
          label={name}
          layout={{
            flex: 1, flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
            backgroundColor: selected ? tint(accent, 0.07) : ROLE.raised,
            // The width never changes with the state, so selecting moves nothing.
            borderWidth: 2, borderColor: selected ? accent : ROLE.edge,
          }}
        >
          {/* The type stripe. */}
          <View layout={{ width: 4, backgroundColor: typeColor }} />

          <View layout={{ flex: 1, padding: 16, gap: 10 }}>
            {/* Type square, key and priority. */}
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View layout={{ width: 22, height: 22, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: tint(typeColor, 0.2) }}>
                {inv
                  ? <AbilityIcon kind={upgrade.abilityKind ?? ""} size={14} color={typeColor} />
                  : UpgradeIcon && <Icon icon={UpgradeIcon} size={14} strokeWidth={2} color={typeColor} />}
              </View>
              <Label text={ticketKey(upgrade.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                {!inv && <Icon icon={Priority} size={14} strokeWidth={2.5} color={typeColor} />}
                <Label text={inv ? t("upgradeShop.abilityKicker") : contentText.tier(t, upgrade.tier)} size={TEXT.xs} weight="600" color={typeColor} />
              </View>
              <View layout={{ flex: 1 }} />
              {/* The holdable affordance lives ON the holdable thing. */}
              <Icon icon={HoldInfoIcon} size={14} color={ROLE.muted} alpha={0.6} />
            </View>

            {/* The title. */}
            <Label text={name} size={TEXT.lg} font="display" weight="600" lineHeight={24} color={ROLE.ink} wrap />

            {/* The description: the one thing on the ticket worth reading slowly. */}
            <Label
              text={isChoice && !chosenMember ? t("upgradeShop.choicePrompt") : contentText.upgradeDesc(t, displayUpgrade)}
              size={TEXT.base} lineHeight={24} color={ROLE.muted} wrap
            />

            {/* What a retainer actually buys, in the only unit that makes its price legible: maps still to come. */}
            {inv && (
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon icon={RefreshCw} size={14} color={typeColor} />
                <Label text={t("upgradeShop.abilityEveryMap", { count: mapsRemaining })} size={TEXT.sm} weight="600" color={typeColor} />
              </View>
            )}

            {/* Labels: the archetype tags, and the situation a conditional upgrade needs. */}
            {((upgrade.tags?.length ?? 0) > 0 || upgrade.condition) && (
              <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {upgrade.tags?.map(tag => <TagChip key={tag} tag={tag} />)}
                {upgrade.condition && (
                  <ConditionChip condition={upgrade.condition} live={conditionMet(upgrade.condition, runContext)} />
                )}
              </View>
            )}

            {/* Certificate chase: this purchase is also progress toward a permanent unlock. */}
            {certChase && <CertChaseRow chase={certChase} shown={certShown} />}

            {/* What blocks it, said outright: a board names a ticket's blockers. */}
            {locked && !owned && (
              <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Icon icon={Lock} size={14} color={RED} layout={{ marginTop: 2 }} />
                <View layout={{ flex: 1 }}>
                  <Label
                    text={`${t("upgradeShop.requires")} ${lockedReasonParts(t, upgrade, upgrades, model.effectiveOwned).join(", ")}`}
                    size={TEXT.xs} color={ROLE.muted} wrap
                  />
                </View>
              </View>
            )}

            {/* Status and estimate, pinned to the foot whatever the description's length. */}
            <View layout={{ flex: 1 }} />
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: lozenge.ground }}>
                {status === "inSprint" && <Icon icon={Check} size={12} strokeWidth={3} color={lozenge.ink} />}
                <Label text={t(STATUS_KEY[status])} size={11} weight="700" upper letterSpacing={0.6} color={lozenge.ink} />
              </View>
              <View layout={{ flex: 1 }} />
              {!owned && (
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {(hasDiscount || shownPrice === 0) && (
                    <Struck text={t("upgradeShop.hoursValue", { hours: displayUpgrade.cost })} size={TEXT.xs} color={ROLE.muted} alpha={0.7} />
                  )}
                  {isChoice && !chosenMember && (
                    <Label text={t("upgradeShop.fromLabel")} size={TEXT.xs} color={ROLE.muted} />
                  )}
                  {/* The estimate: a ticket's hours, in gold like every figure in hours. */}
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: RADIUS.full, paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(priceColor, 0.12) }}>
                    <Icon icon={Clock} size={13} color={priceColor} />
                    <Label
                      text={shownPrice === 0 ? t("upgradeShop.freeLabel") : t("upgradeShop.hoursValue", { hours: shownPrice })}
                      size={TEXT.sm} weight="700" font="display" color={priceColor}
                    />
                  </View>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </Shake>
    </Appear>
  );
}

// ── The sprint ─────────────────────────────────────────────────────────────

export interface SprintLine {
  id: string;
  /** The upgrade the line names (a choice's chosen member). */
  upgrade: UpgradeConfig;
  price: number;
  /** A retainer, named as written rather than through the upgrade locales. */
  ability: boolean;
}

interface SprintPanelProps {
  /** The level the sprint is for. */
  level: number;
  lines: SprintLine[];
  committed: number;
  capacity: number;
  accent: number;
  /** Tapping a committed line takes it back out of the sprint. */
  onRemove: (id: string) => void;
}

/**
 * The sprint the tickets are pulled into: its capacity as a bar (the hours
 * the player has; committed hours fill it in gold) and one line per committed
 * ticket, each tappable to take it back out. Sits above the backlog, so the
 * running total is in view while the player swipes through the tickets.
 */
export function SprintPanel({ level, lines, committed, capacity, accent, onRemove }: SprintPanelProps) {
  const { t } = useTranslation();
  const share = useTween(capacityShare(committed, capacity), 0.3);
  return (
    <View label="sprint" layout={{ alignSelf: "stretch", gap: 10, padding: 14, borderRadius: RADIUS.sm, backgroundColor: ROLE.raised, borderWidth: 1, borderColor: ROLE.edge }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon icon={SquareKanban} size={16} color={accent} />
        <Label text={t("upgradeShop.sprintTitle", { level })} size={TEXT.base} font="display" weight="700" color={ROLE.ink} />
        <View layout={{ flex: 1 }} />
        <Label text={t("upgradeShop.sprintCapacity", { used: committed, total: capacity })} size={TEXT.xs} font="mono" color={ROLE.muted} />
      </View>

      {/* Capacity. */}
      <View layout={{ alignSelf: "stretch", height: 6, borderRadius: 3, backgroundColor: ROLE.edge, overflow: "hidden" }}>
        <View layout={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(share * 1000) / 10}%`, backgroundColor: ROLE.hours }} />
      </View>

      {lines.length === 0 ? (
        <Label text={t("upgradeShop.sprintEmpty")} size={TEXT.xs} color={ROLE.muted} wrap />
      ) : (
        <View layout={{ gap: 2 }}>
          {lines.map(line => (
            <Pressable key={line.id} label={`sprint-${line.id}`} onTap={() => onRemove(line.id)}
              layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 6 }}>
              <Label text={ticketKey(line.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
              <View layout={{ flex: 1 }}>
                <Label text={line.ability ? line.upgrade.name : contentText.upgradeName(t, line.upgrade)} size={TEXT.sm} color={ROLE.ink} truncate />
              </View>
              <Label text={t("upgradeShop.hoursValue", { hours: line.price })} size={TEXT.sm} weight="700" font="display" color={ROLE.hours} />
              <Icon icon={X} size={14} color={ROLE.muted} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
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

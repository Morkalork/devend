/**
 * The upgrade shop's pieces on the canvas (canvas port of the markup inside
 * components/game/UpgradeShop.tsx): the ticket, the sprint panel, the status
 * pills, the banners and the three modals. UpgradeShop.tsx keeps the state; these draw it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LayoutContainer } from "@pixi/layout/components";
import { ColorMatrixFilter, type Graphics } from "pixi.js";
import { animate } from "motion";
// Info directly, not the kit's HoldHint: that is fixed at 0.8 alpha and the card's hint is fainter (opacity-30).
import {
  ArrowRight, Check, ChevronDown, ChevronUp, ChevronsUp, Clock, Equal, Flag, Flame, Info as HoldInfoIcon, Lock, SquareKanban, Medal, RefreshCw, X,
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
import { lockedReasonParts, schoolColor, tierPalette, type CardModel, type CertChase } from "./shopModel";
import {
  STATUS_KEY, capacityShare, fundedShare, priorityRank, shortfall, ticketKey, ticketStatus, unavailable, type TicketStatus,
} from "./storeBoardModel";
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
export function Pill({ text, icon, color, background, size = 11, alpha, onHold }: PillProps) {
  return (
    <Pressable
      onHold={onHold}
      pressedAlpha={1}
      alpha={alpha}
      label={text}
      // Flat, like a ticket's fields: a tinted ground in the pill's own colour
      // and no outline. `border` is kept for callers; an unlit pill (no ground
      // given) takes the edge grey so it still reads as a field.
      layout={{
        flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
        borderRadius: 4, backgroundColor: background !== undefined ? tint(color, 0.14) : ROLE.edge,
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
  return (
    <Appear fromY={-6} delay={0.08}>
      <View label={`checkpoint-${level}`} layout={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch" }}>
        <Icon icon={Flag} size={16} color={CHECKPOINT} />
        <View layout={{ flex: 1 }}>
          <Label text={t("upgradeShop.checkpointLine")} size={TEXT.sm} weight="600" color={CHECKPOINT} wrap />
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
      flexDirection: "row", alignSelf: "stretch", borderRadius: RADIUS.sm, overflow: "hidden",
      backgroundColor: ROLE.raised, borderWidth: 1, borderColor: ROLE.edge,
    }}>
      {/* A gold stripe: a certificate is hours banked for good. */}
      <View layout={{ width: 4, backgroundColor: YELLOW_400 }} />
      <View layout={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
        <Icon icon={Medal} size={18} color={YELLOW_400} />
        <View layout={{ flex: 1, gap: 2 }}>
          <Label text={t("upgradeShop.certificateUnlocked")} size={TEXT.xs} weight="600" color={YELLOW_400} wrap />
          <Label text={contentText.certName(t, cert)} size={TEXT.sm} weight="600" font="display" color={ROLE.ink} wrap />
        </View>
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
  /** Hours left to spend after the current picks: what an unfunded ticket is short of. */
  remainingBudget: number;
  /** The tickets blocking this one, each with its place on the shelf (null when it is not on it). */
  blockers: { upgrade: UpgradeConfig; shelfIndex: number | null }[];
  /** Move the strip to a blocker that is on the shelf. */
  onJump: (shelfIndex: number) => void;
  /** Restocked this visit and not yet looked at. */
  fresh?: boolean;
  onTap: () => void;
  onHold: () => void;
}

/** Each status's lozenge: ground and ink, the way a board colours them. */
function statusLook(status: TicketStatus, accent: number): { ground: number | string; ink: number } {
  switch (status) {
    case "inSprint": return { ground: tint(accent, 0.18), ink: accent };
    case "done": return { ground: tint(GREEN_500, 0.18), ink: GREEN_500 };
    case "blocked": return { ground: tint(RED, 0.16), ink: RED };
    // Gold: it is short of hours, and gold means hours.
    case "unfunded": return { ground: tint(ROLE.hours, 0.14), ink: ROLE.hours };
    default: return { ground: ROLE.edge, ink: ROLE.muted };
  }
}

/** The priority glyphs, lowest to highest, one per tier (storeBoardModel). */
const PRIORITY_GLYPH = [ChevronDown, Equal, ChevronUp, ChevronsUp, Flame] as const;

/**
 * One offer, drawn as a ticket on a sprint board (the store as Jira, the way
 * the owner asked for it): a stripe in the school's colour down its left edge,
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
  upgrade, model, upgrades, index, shaking, hasDiscount, mapsRemaining, runContext, accent, remainingBudget, blockers, onJump, fresh = false, onTap, onHold,
}: TicketCardProps) {
  const { t } = useTranslation();
  const { inv, isChoice, chosenMember, displayUpgrade, owned, selected, locked, shownPrice, purchasable, certChase, certShown } = model;
  const tier = tierPalette(upgrade.tier);
  // The square and stripe are the school's colour; the tier keeps its own on
  // the priority glyph and the tier word (schoolColor).
  const typeColor = inv ? (upgrade.abilityColor ? hex(upgrade.abilityColor) : COLOR.primary) : schoolColor(upgrade);
  const status = ticketStatus(model);
  const lozenge = statusLook(status, accent);
  // Out of reach right now, for either reason: the ticket loses its colour,
  // so it reads as unavailable even half off-screen in the peek.
  const out = unavailable(status);
  const blocked = status === "blocked";
  const unfunded = status === "unfunded";
  const identity = out ? ROLE.muted : typeColor;
  const tierInk = out ? ROLE.muted : inv ? identity : tier.text;
  const stripe = blocked ? RED : out ? ROLE.edge : typeColor;
  const short = unfunded ? shortfall(shownPrice, remainingBudget) : 0;
  const grey = useMemo(() => {
    const f = new ColorMatrixFilter();
    f.desaturate();
    return [f];
  }, []);
  const familyGate = blocked ? lockedReasonParts(t, upgrade, upgrades, model.effectiveOwned).slice(blockers.length) : [];
  const UpgradeIcon = getUpgradeIcon(displayUpgrade, upgrades);
  const Priority = PRIORITY_GLYPH[priorityRank(upgrade.tier)];
  const inert = owned || locked;
  const name = contentText.upgradeName(t, upgrade);
  const priceColor = (purchasable && !unfunded) || selected ? ROLE.hours : ROLE.muted;

  return (
    <Appear fromY={10} delay={index * 0.05} layout={{ flex: 1 }}>
      <Shake active={shaking} layout={{ flex: 1 }}>
        <Pressable
          onTap={inert ? undefined : onTap}
          onHold={onHold}
          pressedAlpha={inert ? 1 : 0.85}
          alpha={owned ? 0.6 : out ? 0.9 : 1}
          label={name}
          layout={{
            flex: 1, flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
            backgroundColor: selected ? tint(accent, 0.07) : ROLE.raised,
            // The width never changes with the state, so selecting moves nothing.
            borderWidth: 2, borderColor: selected ? accent : ROLE.edge,
          }}
        >
          {/* The type stripe: red on a blocked ticket, grey on an unfunded one. */}
          <View layout={{ width: 4, backgroundColor: stripe }} />

          <View layout={{ flex: 1, padding: 16, gap: 10 }}>
            {/* Type square, key and priority. */}
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View layout={{ width: 22, height: 22, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: tint(identity, 0.2) }}>
                {inv
                  ? <AbilityIcon kind={upgrade.abilityKind ?? ""} size={14} color={identity} />
                  : UpgradeIcon && <Icon icon={UpgradeIcon} size={14} strokeWidth={2} color={identity} />}
              </View>
              <Label text={ticketKey(upgrade.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                {!inv && <Icon icon={Priority} size={14} strokeWidth={2.5} color={tierInk} />}
                <Label text={inv ? t("upgradeShop.abilityKicker") : contentText.tier(t, upgrade.tier)} size={TEXT.xs} weight="600" color={tierInk} />
              </View>
              {/* A restock: new to this backlog. */}
              {fresh && (
                <View layout={{ borderRadius: 4, paddingLeft: 5, paddingRight: 5, backgroundColor: tint(COLOR.cyan, 0.16) }}>
                  <Label text={t("upgradeShop.statusNew")} size={10} weight="700" upper letterSpacing={0.6} color={COLOR.cyan} />
                </View>
              )}
              <View layout={{ flex: 1 }} />
              {/* A blocked ticket wears its lock where the hold hint sits; the hold still works. */}
              {blocked
                ? <Icon icon={Lock} size={14} color={RED} />
                : <Icon icon={HoldInfoIcon} size={14} color={ROLE.muted} alpha={0.6} />}
            </View>

            {/* The title. */}
            <Label text={name} size={TEXT.lg} font="display" weight="600" lineHeight={24} color={out ? ROLE.muted : ROLE.ink} wrap />

            {/* The description: the one thing on the ticket worth reading slowly. */}
            <Label
              text={isChoice && !chosenMember ? t("upgradeShop.choicePrompt") : contentText.upgradeDesc(t, displayUpgrade)}
              size={TEXT.base} lineHeight={24} color={ROLE.muted} wrap
            />

            {/* What a retainer actually buys, in the only unit that makes its price legible: maps still to come. */}
            {inv && (
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon icon={RefreshCw} size={14} color={identity} />
                <Label text={t("upgradeShop.abilityEveryMap", { count: mapsRemaining })} size={TEXT.sm} weight="600" color={identity} />
              </View>
            )}

            {/* Labels: the archetype tags, and the situation a conditional upgrade needs. */}
            {((upgrade.tags?.length ?? 0) > 0 || upgrade.condition) && (
              <layoutContainer layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }} filters={out ? grey : undefined} alpha={out ? 0.7 : 1}>
                {upgrade.tags?.map(tag => <TagChip key={tag} tag={tag} />)}
                {upgrade.condition && (
                  <ConditionChip condition={upgrade.condition} live={conditionMet(upgrade.condition, runContext)} />
                )}
              </layoutContainer>
            )}

            {/* Certificate chase: this purchase is also progress toward a permanent unlock. */}
            {certChase && <CertChaseRow chase={certChase} shown={certShown} />}

            {/* What blocks it, said outright: a board names a ticket's blockers. */}
            {/* What blocks it, as links: a board names a ticket's blockers, and a
                blocker on this shelf is one tap away. */}
            {blocked && (
              <View layout={{ gap: 4, padding: 10, borderRadius: RADIUS.sm, backgroundColor: tint(RED, 0.08) }}>
                <Label text={t("upgradeShop.blockedBy")} size={11} weight="700" upper letterSpacing={0.6} color={RED} />
                {blockers.map(b => {
                  const shelfIndex = b.shelfIndex;
                  const row = (
                    <>
                      <Label text={ticketKey(b.upgrade.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
                      <View layout={{ flex: 1 }}>
                        <Label text={contentText.upgradeName(t, b.upgrade)} size={TEXT.sm} color={ROLE.ink} wrap />
                      </View>
                      {shelfIndex !== null && <Icon icon={ArrowRight} size={14} color={ROLE.muted} />}
                    </>
                  );
                  return shelfIndex !== null ? (
                    <Pressable key={b.upgrade.id} label={`blocker-${b.upgrade.id}`} onTap={() => onJump(shelfIndex)}
                      layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
                      {row}
                    </Pressable>
                  ) : (
                    <View key={b.upgrade.id} layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
                      {row}
                    </View>
                  );
                })}
                {/* The maxed-family gate has no single ticket to link to. */}
                {familyGate.map((text, i) => <Label key={`gate${i}`} text={text} size={TEXT.sm} color={ROLE.ink} wrap />)}
              </View>
            )}

            {/* How much of it the hours left would cover: close is worth knowing. */}
            {unfunded && (
              <View layout={{ alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: ROLE.edge, overflow: "hidden" }}>
                <View layout={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(fundedShare(shownPrice, remainingBudget) * 1000) / 10}%`, backgroundColor: ROLE.hours }} />
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
                  {/* On an unfunded ticket the shortfall matters more than the discount. */}
                  {(hasDiscount || shownPrice === 0) && !unfunded && (
                    <Struck text={t("upgradeShop.hoursValue", { hours: displayUpgrade.cost })} size={TEXT.xs} color={ROLE.muted} alpha={0.7} />
                  )}
                  {isChoice && !chosenMember && (
                    <Label text={t("upgradeShop.fromLabel")} size={TEXT.xs} color={ROLE.muted} />
                  )}
                  {/* The shortfall, in the red of a cost: what it would take. */}
                  {short > 0 && <Label text={t("upgradeShop.shortBy", { hours: short })} size={TEXT.xs} weight="700" color={ROLE.cost} />}
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
  /** Backlog tickets the hours left cannot pay for, and the closest shortfall; null when all fit. */
  wontFit?: { count: number; closest: number } | null;
  /** The sprint's fields (rates, restocks, budget cycle, runway, set counts), under the capacity. */
  fields?: ReactNode;
  /** The newest restock not yet seen; tapping it moves the strip there. */
  restocked?: { id: string; upgrade: UpgradeConfig; index: number } | null;
  onJump?: (shelfIndex: number) => void;
  /** Tapping a committed line takes it back out of the sprint. */
  onRemove: (id: string) => void;
}

/**
 * The sprint the tickets are pulled into: its capacity as a bar (the hours
 * the player has; committed hours fill it in gold) and one line per committed
 * ticket, each tappable to take it back out. Sits above the backlog, so the
 * running total is in view while the player swipes through the tickets.
 */
export function SprintPanel({
  level, lines, committed, capacity, accent, wontFit: notFitting = null, fields, restocked = null, onJump, onRemove,
}: SprintPanelProps) {
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

      {fields}

      {/* A restock lands at the end of the strip, out of sight: say so, and go there on a tap. */}
      {restocked && (
        <Pressable label={`restocked-${restocked.id}`} onTap={() => onJump?.(restocked.index)}
          layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon icon={RefreshCw} size={13} color={COLOR.cyan} />
          <View layout={{ flex: 1 }}>
            <Label text={t("upgradeShop.restockedLine", { key: ticketKey(restocked.id), name: contentText.upgradeName(t, restocked.upgrade) })}
              size={TEXT.xs} color={COLOR.cyan} wrap />
          </View>
          <Icon icon={ArrowRight} size={13} color={COLOR.cyan} />
        </Pressable>
      )}

      {/* What no longer fits, said where the capacity is. */}
      {notFitting && (
        <Label text={t("upgradeShop.sprintWontFit", { count: notFitting.count, hours: notFitting.closest })} size={TEXT.xs} color={ROLE.cost} wrap />
      )}

      {lines.length === 0 ? (
        <Label text={t("upgradeShop.sprintEmpty")} size={TEXT.xs} color={ROLE.muted} wrap />
      ) : (
        <View layout={{ gap: 2 }}>
          {lines.map(line => (
            <Pressable key={line.id} label={`sprint-${line.id}`} onTap={() => onRemove(line.id)}
              layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 6 }}>
              <Label text={ticketKey(line.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
              <View layout={{ flex: 1 }}>
                <Label text={contentText.upgradeName(t, line.upgrade)} size={TEXT.sm} color={ROLE.ink} truncate />
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
 * Press-and-hold detail: the ticket, opened (a Jira issue view). The header is
 * the ticket's own (type square, key, priority), then the title, the labels
 * and the description in full; then its links, "Unlocked by" (what it needs)
 * and "Unlocks" (what it leads to), each a row with the linked ticket's key;
 * then the certificate it counts toward. Backdrop or X closes it.
 */
export function UpgradeDetailModal({ upgrade: u, upgrades, dependents, has, cert, runContext, accent, onClose }: DetailProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const DetailIcon = getUpgradeIcon(u, upgrades);
  const tc = tierPalette(u.tier);
  const school = schoolColor(u);
  const Priority = PRIORITY_GLYPH[priorityRank(u.tier)];
  // Both gates: "Nothing required" over a card the shop refuses to sell is a lie.
  const need = unlockRequirements(u, upgrades);

  const relRow = (rel: UpgradeConfig) => {
    const relTc = tierPalette(rel.tier);
    return (
      <View key={rel.id} layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
        <Label text={ticketKey(rel.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
        <View layout={{ flex: 1 }}>
          <Label text={contentText.upgradeName(t, rel)} size={TEXT.sm} color={ROLE.ink} truncate />
        </View>
        <Label text={contentText.tier(t, rel.tier)} size={TEXT.xs} weight="600" color={relTc.text} />
        {/* Owned or committed: that link is already satisfied. */}
        {has(rel.id) && <Icon icon={Check} size={14} color={GREEN_500} />}
      </View>
    );
  };
  const sectionTitle = (text: string) => (
    <Label text={text} size={11} weight="700" upper letterSpacing={0.6} color={ROLE.muted} layout={{ marginBottom: 4 }} />
  );
  const none = (text: string) => <Label text={text} size={TEXT.xs} color={ROLE.muted} wrap />;
  const rule = <View layout={{ height: 1, alignSelf: "stretch", backgroundColor: ROLE.edge }} />;

  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent} stripe={school} heading={
      <>
          {/* The ticket's header: type square, key and priority. */}
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 }}>
            <View layout={{ width: 22, height: 22, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: tint(school, 0.2) }}>
              {DetailIcon && <Icon icon={DetailIcon} size={14} strokeWidth={2} color={school} />}
            </View>
            <Label text={ticketKey(u.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Icon icon={Priority} size={14} strokeWidth={2.5} color={tc.text} />
              <Label text={contentText.tier(t, u.tier)} size={TEXT.xs} weight="600" color={tc.text} />
            </View>
          </View>
      </>
    }>
      {/* Bounded and scrollable, so a tall ticket is never clipped out of both ends. */}
      <ScrollView layout={{ maxHeight: screen.height - 160 }}>
        <View layout={{ gap: 12 }}>
          <Label text={contentText.upgradeName(t, u)} size={TEXT.xl} font="display" weight="700" color={ROLE.ink} wrap />

          {((u.tags?.length ?? 0) > 0 || u.condition) && (
            <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {u.tags?.map(tag => <TagChip key={tag} tag={tag} sizeClass="text-[10px]" />)}
              {u.condition && <ConditionChip condition={u.condition} live={conditionMet(u.condition, runContext)} />}
            </View>
          )}

          <Label text={contentText.upgradeDesc(t, u)} size={TEXT.base} lineHeight={24} color={ROLE.muted} wrap />

          {rule}

          {/* Links: what it needs, then what it leads to. */}
          <View>
            {sectionTitle(t("upgradeShop.detailUnlockedBy"))}
            {need.prereqs.length > 0 || need.maxedFamily ? (
              <View>
                {need.prereqs.map(relRow)}
                {need.maxedFamily && (
                  <Label text={t("upgradeShop.requiresMaxedFamily", { family: need.maxedFamily })} size={TEXT.xs} color={ROLE.muted} wrap />
                )}
              </View>
            ) : none(t("upgradeShop.detailNoPrereqs"))}
          </View>

          <View>
            {sectionTitle(t("upgradeShop.detailUnlocks"))}
            {dependents.length > 0
              ? <View>{dependents.map(relRow)}</View>
              : none(t("upgradeShop.detailNoUnlocks"))}
          </View>

          {/* The card note only has room for a fraction; this is where the rule
              behind it is stated, including that the runs must be SEPARATE. */}
          {cert && (
            <>
              {rule}
              <View layout={{ gap: 4 }}>
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon icon={Medal} size={14} color={YELLOW_400} />
                  <Label text={t("upgradeShop.detailCertificate")} size={11} weight="700" upper letterSpacing={0.6} color={YELLOW_400} />
                </View>
                <Label
                  text={t("upgradeShop.detailCertificateBody", { name: contentText.certName(t, cert.cert), required: cert.required, current: cert.current })}
                  size={TEXT.xs} color={ROLE.muted} wrap
                />
              </View>
            </>
          )}
        </View>
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
 * Tier-3 choice chooser, opened by tapping a choice ticket: pick ONE of the
 * group's mutually exclusive options (each costs 50% more). Each option is a
 * sub-ticket under the parent's title: its own stripe and key, the variant's
 * text, its estimate, and the same statuses as the board (in the sprint, or
 * unfunded with its shortfall).
 */
export function ChoiceChooserModal({ options, selectedIds, price, budget, accent, onChoose, onClose }: ChooserProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const school = schoolColor(options[0]);
  return (
    <Modal screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent} stripe={school} title={contentText.upgradeName(t, options[0])}>
      <ScrollView layout={{ maxHeight: screen.height - 200 }}>
        <Label text={t("upgradeShop.choiceModalHint")} size={TEXT.xs} color={ROLE.muted} wrap layout={{ marginBottom: 12 }} />
        <View layout={{ gap: 8 }}>
          {options.map(opt => {
            const p = price(opt);
            const isSel = selectedIds.includes(opt.id);
            const affordable = p <= budget;
            const short = isSel ? 0 : shortfall(p, budget);
            const optSchool = schoolColor(opt);
            return (
              <Pressable
                key={opt.id}
                onTap={() => onChoose(opt)}
                alpha={affordable || isSel ? 1 : 0.85}
                label={contentText.upgradeDesc(t, opt)}
                layout={{
                  flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
                  backgroundColor: isSel ? tint(accent, 0.07) : ROLE.surface,
                  borderWidth: 2, borderColor: isSel ? accent : ROLE.edge,
                }}
              >
                <View layout={{ width: 4, backgroundColor: affordable || isSel ? optSchool : ROLE.edge }} />
                <View layout={{ flex: 1, padding: 12, gap: 8 }}>
                  <Label text={ticketKey(opt.id)} size={TEXT.xs} font="mono" color={ROLE.muted} />
                  <Label text={contentText.upgradeDesc(t, opt)} size={TEXT.base} lineHeight={22} color={affordable || isSel ? ROLE.ink : ROLE.muted} wrap />
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {isSel && (
                      <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(accent, 0.18) }}>
                        <Icon icon={Check} size={12} strokeWidth={3} color={accent} />
                        <Label text={t("upgradeShop.statusInSprint")} size={11} weight="700" upper letterSpacing={0.6} color={accent} />
                      </View>
                    )}
                    {short > 0 && (
                      <View layout={{ borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(ROLE.hours, 0.14) }}>
                        <Label text={t("upgradeShop.statusUnfunded")} size={11} weight="700" upper letterSpacing={0.6} color={ROLE.hours} />
                      </View>
                    )}
                    <View layout={{ flex: 1 }} />
                    {short > 0 && <Label text={t("upgradeShop.shortBy", { hours: short })} size={TEXT.xs} weight="700" color={ROLE.cost} />}
                    <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: RADIUS.full, paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(affordable || isSel ? ROLE.hours : ROLE.muted, 0.12) }}>
                      <Icon icon={Clock} size={13} color={affordable || isSel ? ROLE.hours : ROLE.muted} />
                      <Label text={p === 0 ? t("upgradeShop.freeLabel") : t("upgradeShop.hoursValue", { hours: p })} size={TEXT.sm} weight="700" font="display" color={affordable || isSel ? ROLE.hours : ROLE.muted} />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Modal>
  );
}

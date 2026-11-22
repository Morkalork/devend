/**
 * The tree stage (BALL_TREE_PLAN.md phase 4): where a run under the tree rule
 * set spends its hours between maps, and where it picks its first ball's
 * trait before map 1.
 *
 * The roster first, because the balls are the build's face: each ball with
 * its rungs, tappable for the rungs it could take next and what they cost,
 * and a slot for the next ball while the roster is under its cap. The tree
 * below, by branch, every node always in view: what the player cannot afford
 * they can still read, which is the planning the store's shelf never allowed.
 * A node opens a ticket with its words, its price and what it requires, and
 * the buy is a button on that ticket, so nothing is bought by a brush of the
 * thumb while scrolling.
 *
 * Purchases apply at once (the session updates hours, roster and owned ids),
 * so the screen is a view over the run, and Continue only goes to the map.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Circle, Hand, Landmark, Layers, Lock, Plus, Sparkles, Fence } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";
import { getUpgradeIcon } from "@/components/game/upgradeIcons";
import { resolveUpgradeCost, getLivePricing } from "@/lib/upgradePricing";
import { RUNG_IDS, RUNG_META, ROSTER_MAX, type Roster, type RosterBall, type RungId } from "@/lib/roster";
import { TREE_BRANCHES, ballPrice, nodesOf, rungOffers, type TreeBranch } from "@/lib/tree";
import {
  Appear, ArcadeButton, ArcadeText, Icon, Label, Modal, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, arcadeInk, hex, tint, useUiScreen,
} from "../kit/ui";
import { PipelineFrame } from "./PipelineFrame";
import { continueLabel, samplePlan, type BetweenMapPlan } from "./pipelineModel";
import type { NextMapInfo } from "./draftStoreParts";

export interface TreeScreenProps {
  /** Hours in the bank. */
  hours: number;
  roster: Roster;
  /** The tree's catalogue (tree.yml `upgrades:`). */
  nodes: UpgradeConfig[];
  ownedIds: string[];
  isLocked: (id: string, ownedIds: string[]) => boolean;
  completedLevel: number;
  nextMap?: NextMapInfo | null;
  /** The tree's own discount (Expense Account), 1 for none. */
  discount?: number;
  onBuyNode: (id: string, price: number) => void;
  onBuyRung: (slot: number, rung: RungId, price: number) => void;
  onBuyBall: (price: number) => void;
  onContinue: () => void;
  accentColor?: string;
  /** The stages between the map just won and the next; a sample one in the gallery. */
  pipeline?: BetweenMapPlan;
  /**
   * The run start: pick one of these rank-one rungs free for the first ball,
   * then start. No frame, no hours, no tree: one decision.
   */
  start?: { offer: RungId[]; onPick: (rung: RungId) => void } | null;
}

const BRANCH_ICON: Record<TreeBranch, LucideIcon> = { balls: Circle, fences: Fence, hands: Hand, office: Landmark };

/** A ball's rungs as short chips. */
function RungChips({ ball, size = TEXT.xs }: { ball: RosterBall; size?: number }) {
  const held = RUNG_IDS.filter(id => (ball.rungs[id] ?? 0) > 0);
  if (held.length === 0) {
    return null;
  }
  return (
    <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {held.map(id => (
        <View key={id} layout={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.sm, backgroundColor: tint(RUNG_META[id].color, 0.18) }}>
          <Label text={`${RUNG_META[id].label} ${ball.rungs[id]}`} size={size} weight="700" color={RUNG_META[id].color} />
        </View>
      ))}
    </View>
  );
}

export function TreeScreen({
  hours, roster, nodes, ownedIds, isLocked, completedLevel, nextMap = null, discount = 1,
  onBuyNode, onBuyRung, onBuyBall, onContinue, accentColor = "#00ff88", pipeline, start = null,
}: TreeScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const plan = pipeline ?? samplePlan(completedLevel);
  const [openBall, setOpenBall] = useState<number | null>(null);
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [picked, setPicked] = useState<RungId | null>(null);

  const pricing = getLivePricing();
  const priceOf = (u: UpgradeConfig): number => Math.max(1, Math.round((resolveUpgradeCost(u, pricing) ?? 0) * discount));
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const nextBallPrice = ballPrice(roster.length, undefined, discount);

  // ── The run start: one trait, free ────────────────────────────────────────
  if (start) {
    const width = Math.min(screen.width - 32, 520);
    return (
      <View layout={{ width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <View layout={{ width, gap: 16 }}>
          <Appear fromY={-8}>
            <View layout={{ gap: 6 }}>
              <Label text={t("tree.startTitle")} size={TEXT.xl} font="display" weight="700" color={accent} wrap />
              <Label text={t("tree.startBody")} size={TEXT.sm} color={ROLE.muted} wrap />
            </View>
          </Appear>
          {start.offer.map((rung, i) => {
            const meta = RUNG_META[rung];
            const on = picked === rung;
            return (
              <Appear key={rung} fromY={12} delay={0.08 * (i + 1)}>
                <Pressable
                  onTap={() => setPicked(rung)}
                  label={meta.label}
                  layout={{
                    padding: 14, gap: 6, borderRadius: RADIUS.md, borderWidth: 2,
                    borderColor: on ? meta.color : ROLE.edge, backgroundColor: on ? tint(meta.color, 0.12) : ROLE.surface,
                  }}
                >
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View layout={{ width: 12, height: 12, borderRadius: 6, backgroundColor: meta.color }} />
                    <Label text={`${meta.label} 1`} size={TEXT.base} font="display" weight="700" color={on ? meta.color : ROLE.ink} />
                    {rung === "weight" && <Label text={t("tree.forBricks")} size={TEXT.xs} color={ROLE.muted} />}
                  </View>
                  <Label text={meta.ranks[0]} size={TEXT.sm} color={ROLE.ink} wrap />
                </Pressable>
              </Appear>
            );
          })}
          <Appear fromY={20} delay={0.4}>
            <ArcadeButton onTap={() => { if (picked) start.onPick(picked); }} disabled={!picked} iconAfter={ArrowRight}>
              <ArcadeText text={picked ? t("tree.startWith", { trait: RUNG_META[picked].label }) : t("tree.pickOne")} color={arcadeInk("primary")} size={TEXT.sm} />
            </ArcadeButton>
          </Appear>
        </View>
      </View>
    );
  }

  // ── The ball ticket: the rungs a ball could take next ─────────────────────
  const ballModal = openBall !== null && (() => {
    const ball = roster.find(b => b.slot === openBall);
    if (!ball) return null;
    const offers = rungOffers(ball, undefined, discount);
    return (
      <Modal screen={screen} maxWidth={400} onClose={() => setOpenBall(null)} accent={accent} title={ball.name ?? t("tree.ballN", { n: ball.slot })}>
        <ScrollView layout={{ maxHeight: screen.height - 180 }}>
          <View layout={{ gap: 10 }}>
            <RungChips ball={ball} />
            {offers.length === 0 && <Label text={t("tree.ballFull")} size={TEXT.sm} color={ROLE.muted} wrap />}
            {offers.map(o => {
              const meta = RUNG_META[o.rung];
              const can = hours >= o.price;
              return (
                <View key={o.rung} layout={{ gap: 4, padding: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: tint(meta.color, 0.5), backgroundColor: ROLE.surface }}>
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View layout={{ width: 10, height: 10, borderRadius: 5, backgroundColor: meta.color }} />
                    <View layout={{ flex: 1 }}>
                      <Label text={`${meta.label} ${o.rank}`} size={TEXT.sm} weight="700" color={meta.color} />
                    </View>
                    <Pressable
                      onTap={can ? () => onBuyRung(ball.slot, o.rung, o.price) : undefined}
                      alpha={can ? 1 : 0.45}
                      label={t("tree.buyFor", { hours: o.price })}
                      layout={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: RADIUS.sm, backgroundColor: can ? accent : ROLE.raised }}
                    >
                      <Label text={t("tree.buyFor", { hours: o.price })} size={TEXT.xs} weight="700" color={can ? 0x000000 : ROLE.muted} />
                    </Pressable>
                  </View>
                  <Label text={meta.ranks[o.rank - 1]} size={TEXT.xs} color={ROLE.ink} wrap />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Modal>
    );
  })();

  // ── The node ticket ───────────────────────────────────────────────────────
  const nodeModal = openNode !== null && (() => {
    const node = byId.get(openNode);
    if (!node) return null;
    const owned = ownedIds.includes(node.id);
    const locked = !owned && isLocked(node.id, ownedIds);
    const price = priceOf(node);
    const can = !owned && !locked && hours >= price;
    const requires = (node.prerequisites ?? []).concat(node.upgradeOf ? [node.upgradeOf] : [])
      .filter(id => !ownedIds.includes(id)).map(id => byId.get(id)).filter((n): n is UpgradeConfig => !!n);
    const icon = getUpgradeIcon(node, nodes);
    const downside = contentText.upgradeDownside(t, node);
    return (
      <Modal screen={screen} maxWidth={400} onClose={() => setOpenNode(null)} accent={accent}>
        <View layout={{ gap: 10 }}>
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {icon && <Icon icon={icon} size={28} color={accent} />}
            <View layout={{ flex: 1 }}>
              <Label text={contentText.upgradeName(t, node)} size={TEXT.base} font="display" weight="700" color={accent} wrap />
            </View>
          </View>
          <Label text={contentText.upgradeDesc(t, node)} size={TEXT.sm} lineHeight={20} color={ROLE.ink} wrap />
          {downside && <Label text={downside} size={TEXT.xs} color={ROLE.cost} wrap />}
          {requires.length > 0 && (
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon icon={Lock} size={14} color={ROLE.cost} />
              <View layout={{ flex: 1 }}>
                <Label text={t("tree.requires", { names: requires.map(r => contentText.upgradeName(t, r)).join(", ") })} size={TEXT.xs} color={ROLE.cost} wrap />
              </View>
            </View>
          )}
          {owned ? (
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon icon={Check} size={14} color={accent} />
              <Label text={t("tree.owned")} size={TEXT.xs} weight="700" color={accent} />
            </View>
          ) : (
            <ArcadeButton onTap={can ? () => { onBuyNode(node.id, price); setOpenNode(null); } : undefined} disabled={!can} variant={can ? "primary" : "secondary"}>
              <ArcadeText text={t("tree.buyFor", { hours: price })} color={arcadeInk(can ? "primary" : "secondary")} size={TEXT.sm} />
            </ArcadeButton>
          )}
        </View>
      </Modal>
    );
  })();

  const branches = TREE_BRANCHES.filter(b => b !== "balls");

  return (
    <PipelineFrame
      plan={plan}
      at="store"
      accent={accent}
      headline={{
        value: hours, unit: "h",
        caption: plan.last ? t("pipeline.toSpendLast") : t("pipeline.toSpend", { level: completedLevel + 1 }),
      }}
      overlay={ballModal || nodeModal || undefined}
      footer={
        <Appear fromY={20} delay={0.3}>
          <ArcadeButton onTap={onContinue} iconAfter={ArrowRight}>
            <ArcadeText text={continueLabel(plan, "store", t)} color={arcadeInk("primary")} size={TEXT.sm} />
          </ArcadeButton>
        </Appear>
      }
    >
      {/* The roster: the build's face. */}
      <Appear fromY={-8} delay={0.08}>
        <View layout={{ gap: 8 }}>
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon icon={Layers} size={14} color={ROLE.muted} />
            <Label text={t("tree.yourBalls")} size={TEXT.xs} weight="700" upper letterSpacing={1} color={ROLE.muted} />
          </View>
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {roster.map(ball => (
              <Pressable
                key={ball.slot}
                onTap={() => setOpenBall(ball.slot)}
                label={t("tree.ballN", { n: ball.slot })}
                layout={{ minWidth: 140, flex: 1, padding: 10, gap: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: tint(accent, 0.5), backgroundColor: ROLE.surface }}
              >
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View layout={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 0xff5b5b, alignItems: "center", justifyContent: "center" }}>
                    <Label text={String(ball.slot)} size={TEXT.xs} weight="700" color={0x000000} />
                  </View>
                  <View layout={{ flex: 1 }}>
                    <Label text={ball.name ?? t("tree.ballN", { n: ball.slot })} size={TEXT.sm} weight="700" color={ROLE.ink} truncate />
                  </View>
                </View>
                <RungChips ball={ball} />
                <Label text={t("tree.tapForRungs")} size={TEXT.xs} color={ROLE.muted} />
              </Pressable>
            ))}
            {roster.length < ROSTER_MAX && nextBallPrice !== null && (
              <Pressable
                onTap={hours >= nextBallPrice ? () => onBuyBall(nextBallPrice) : undefined}
                alpha={hours >= nextBallPrice ? 1 : 0.5}
                label={t("tree.addBall", { hours: nextBallPrice })}
                layout={{ minWidth: 140, flex: 1, padding: 10, gap: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: ROLE.edge, alignItems: "center", justifyContent: "center" }}
              >
                <Icon icon={Plus} size={18} color={hours >= nextBallPrice ? accent : ROLE.muted} />
                <Label text={t("tree.addBall", { hours: nextBallPrice })} size={TEXT.xs} weight="700" color={hours >= nextBallPrice ? accent : ROLE.muted} align="center" wrap />
              </Pressable>
            )}
          </View>
          {nextMap && (
            <Label
              text={nextMap.features.length > 0
                ? t("cardDraft.nextMap", { level: nextMap.level, name: nextMap.name, features: nextMap.features.join(", ") })
                : t("cardDraft.nextMapPlain", { level: nextMap.level, name: nextMap.name })}
              size={TEXT.xs} color={ROLE.muted} wrap
            />
          )}
        </View>
      </Appear>

      {/* The branches: every node, always in view. */}
      {branches.map((branch, bi) => {
        const list = nodesOf(branch, nodes);
        if (list.length === 0) return null;
        return (
          <Appear key={branch} fromY={-8} delay={0.12 + bi * 0.05}>
            <View layout={{ gap: 8, marginTop: 8 }}>
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon icon={BRANCH_ICON[branch]} size={14} color={ROLE.muted} />
                <Label text={t(`tree.branch.${branch}`)} size={TEXT.xs} weight="700" upper letterSpacing={1} color={ROLE.muted} />
              </View>
              <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {list.map(node => {
                  const owned = ownedIds.includes(node.id);
                  const locked = !owned && isLocked(node.id, ownedIds);
                  const price = priceOf(node);
                  const can = !owned && !locked && hours >= price;
                  const icon = getUpgradeIcon(node, nodes);
                  const ink = owned ? accent : locked ? ROLE.muted : can ? ROLE.ink : ROLE.muted;
                  return (
                    <Pressable
                      key={node.id}
                      onTap={() => setOpenNode(node.id)}
                      label={contentText.upgradeName(t, node)}
                      layout={{
                        flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
                        borderRadius: RADIUS.sm, borderWidth: 1,
                        borderColor: owned ? accent : can ? tint(accent, 0.6) : ROLE.edge,
                        backgroundColor: owned ? tint(accent, 0.12) : ROLE.surface,
                      }}
                    >
                      {owned ? <Icon icon={Check} size={12} color={accent} /> : locked ? <Icon icon={Lock} size={12} color={ROLE.muted} /> : icon ? <Icon icon={icon} size={12} color={ink} /> : <Icon icon={Sparkles} size={12} color={ink} />}
                      <Label text={contentText.upgradeName(t, node)} size={TEXT.xs} weight="600" color={ink} />
                      {!owned && <Label text={`${price}h`} size={TEXT.xs} weight="700" color={can ? ROLE.hours : ROLE.muted} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Appear>
        );
      })}
    </PipelineFrame>
  );
}

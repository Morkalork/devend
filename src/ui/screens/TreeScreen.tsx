/**
 * The tree stage (BALL_TREE_PLAN.md phase 4): where a run under the tree rule
 * set spends its hours between maps, and where it picks its first ball's
 * trait before map 1.
 *
 * The roster first, because the balls are the build's face: each ball with
 * its rungs, tappable for the rungs it could take next and what they cost,
 * and a slot for the next ball while the roster is under its cap. The tree
 * below, by branch, every node always in view WITH its description on it:
 * what the player cannot afford they can still read, which is the planning the store's shelf never allowed.
 * A node opens a ticket with its words, its price and what it requires, and
 * the buy is a button on that ticket, so nothing is bought by a brush of the
 * thumb while scrolling.
 *
 * Purchases apply at once (the session updates hours, roster and owned ids),
 * so the screen is a view over the run, and Continue only goes to the map.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Lock, Plus, Sparkles } from "lucide-react";
import type { Graphics } from "pixi.js";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";
import { getUpgradeIcon } from "@/components/game/upgradeIcons";
import { resolveUpgradeCost, getLivePricing } from "@/lib/upgradePricing";
import { RUNG_IDS, RUNG_META, ROSTER_MAX, type Roster, type RosterBall, type RungId } from "@/lib/roster";
import { ballPrice, rungOffers } from "@/lib/tree";
import { NODE_H, NODE_W, layoutTree, type LayoutNode } from "./treeLayout";
import {
  Appear, ArcadeButton, ArcadeText, Icon, Label, Modal, PanView, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, arcadeInk, hex, tint, useUiScreen,
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

  // ── The map ───────────────────────────────────────────────────────────────
  // A ball is a node of the balls branch, each hanging off the one before it,
  // and the next slot hangs off the last; a general node hangs off what it
  // requires. Placed once per catalogue and roster size.
  const addId = "ball:add";
  const tree = useMemo(() => {
    const items: LayoutNode[] = [];
    roster.forEach((b, i) => items.push({ id: `ball:${b.slot}`, branch: "balls", requires: i === 0 ? [] : [`ball:${roster[i - 1].slot}`] }));
    if (roster.length < ROSTER_MAX) {
      items.push({ id: addId, branch: "balls", requires: [`ball:${roster[roster.length - 1].slot}`] });
    }
    for (const n of nodes) {
      if (!n.branch || n.branch === "balls") continue;
      items.push({ id: n.id, branch: n.branch, requires: [...(n.prerequisites ?? []), ...(n.upgradeOf ? [n.upgradeOf] : [])] });
    }
    return layoutTree(items);
  }, [nodes, roster]);


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
    const detail = contentText.treeDetail(t, node);
    return (
      <Modal screen={screen} maxWidth={400} onClose={() => setOpenNode(null)} accent={accent}>
        <View layout={{ gap: 10 }}>
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {icon && <Icon icon={icon} size={28} color={accent} />}
            <View layout={{ flex: 1 }}>
              <Label text={contentText.upgradeName(t, node)} size={TEXT.base} font="display" weight="700" color={accent} wrap />
            </View>
          </View>
          <Label text={contentText.treeBrief(t, node)} size={TEXT.sm} lineHeight={20} color={ROLE.ink} wrap />
          {detail && <Label text={detail} size={TEXT.xs} lineHeight={17} color={ROLE.muted} wrap />}
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

  const PAD = 80;
  const contentWidth = tree.maxX - tree.minX + PAD * 2;
  const contentHeight = tree.maxY - tree.minY + PAD * 2;
  const toContent = (x: number, y: number) => ({ x: x - tree.minX + PAD, y: y - tree.minY + PAD });
  const mapWidth = screen.width;
  const mapHeight = Math.max(360, screen.height - 300);
  const origin = toContent(0, 0);

  type NodeState = "owned" | "canBuy" | "tooDear" | "locked";
  const stateOf = (id: string): NodeState => {
    if (id.startsWith("ball:")) {
      if (id === addId) return nextBallPrice !== null && hours >= nextBallPrice ? "canBuy" : "tooDear";
      return "owned";
    }
    const node = byId.get(id);
    if (!node) return "locked";
    if (ownedIds.includes(node.id)) return "owned";
    if (isLocked(node.id, ownedIds)) return "locked";
    return hours >= priceOf(node) ? "canBuy" : "tooDear";
  };
  const INK_OF: Record<NodeState, number> = { owned: 0x000000, canBuy: ROLE.ink, tooDear: ROLE.muted, locked: ROLE.muted };
  const FILL_OF: Record<NodeState, number> = { owned: accent, canBuy: ROLE.surface, tooDear: ROLE.surface, locked: ROLE.surface };
  const EDGE_OF: Record<NodeState, number> = { owned: accent, canBuy: accent, tooDear: ROLE.edge, locked: ROLE.edge };
  // The description under a node's name: quieter than the name, and still
  // readable on a node the player cannot buy yet, since reading ahead is the point.
  const BRIEF_SIZE = 10.5;
  const BRIEF_LINE = 13;
  const BRIEF_INK: Record<NodeState, number> = { owned: 0x0b1f14, canBuy: ROLE.ink, tooDear: ROLE.muted, locked: ROLE.muted };
  const ALPHA_OF: Record<NodeState, number> = { owned: 1, canBuy: 1, tooDear: 0.8, locked: 0.55 };

  const drawEdges = (g: Graphics) => {
    g.clear();
    const at = new Map(tree.nodes.map(n => [n.id, toContent(n.x, n.y)]));
    // The trunks: the root to every first-ring node.
    for (const n of tree.nodes) {
      if (n.depth !== 0) continue;
      const p = at.get(n.id)!;
      const s = stateOf(n.id);
      g.moveTo(origin.x, origin.y).lineTo(p.x, p.y).stroke({ width: 2, color: s === "locked" ? ROLE.edge : accent, alpha: s === "owned" ? 0.9 : s === "canBuy" ? 0.45 : 0.18 });
    }
    for (const e of tree.edges) {
      const a = at.get(e.from), b = at.get(e.to);
      if (!a || !b) continue;
      const s = stateOf(e.to);
      const lit = stateOf(e.from) === "owned";
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: lit && s !== "locked" ? accent : ROLE.edge, alpha: lit ? (s === "owned" ? 0.9 : 0.6) : 0.35 });
    }
    g.circle(origin.x, origin.y, 16).fill({ color: ROLE.surface }).stroke({ width: 2, color: accent, alpha: 0.9 });
  };

  const legend: { state: NodeState; text: string }[] = [
    { state: "owned", text: t("tree.legendOwned") },
    { state: "canBuy", text: t("tree.legendCanBuy") },
    { state: "locked", text: t("tree.legendLocked") },
  ];

  const map = (
    <PanView
      layout={{ width: mapWidth, height: mapHeight, backgroundColor: ROLE.raised }}
      contentWidth={contentWidth}
      contentHeight={contentHeight}
      initialX={origin.x - mapWidth / 2}
      initialY={origin.y - mapHeight / 2}
    >
      <View layout={{ width: contentWidth, height: contentHeight }}>
        <pixiGraphics draw={drawEdges} layout={false} />
        <View layout={{ position: "absolute", left: origin.x - 16, top: origin.y - 16, width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <Label text={`${hours}h`} size={TEXT.xs} weight="700" color={accent} />
        </View>
        {tree.nodes.map(n => {
          const p = toContent(n.x, n.y);
          const state = stateOf(n.id);
          const head = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 };
          const box = { position: "absolute" as const, left: p.x - NODE_W / 2, top: p.y - NODE_H / 2, width: NODE_W, height: NODE_H,
            flexDirection: "column" as const, justifyContent: "flex-start" as const, gap: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 7, paddingBottom: 6,
            borderRadius: RADIUS.sm, borderWidth: state === "canBuy" ? 2 : 1, borderColor: EDGE_OF[state], backgroundColor: FILL_OF[state] };
          if (n.id.startsWith("ball:")) {
            if (n.id === addId) {
              return (
                <Pressable key={n.id} onTap={state === "canBuy" && nextBallPrice !== null ? () => onBuyBall(nextBallPrice) : undefined} alpha={ALPHA_OF[state]} label={t("tree.addBall", { hours: nextBallPrice ?? 0 })} layout={box}>
                  <View layout={head}>
                    <Icon icon={Plus} size={14} color={INK_OF[state]} />
                    <View layout={{ flex: 1 }}><Label text={t("tree.nextBall")} size={TEXT.xs} weight="700" color={INK_OF[state]} truncate /></View>
                    <Label text={`${nextBallPrice ?? 0}h`} size={TEXT.xs} weight="700" color={state === "canBuy" ? ROLE.hours : ROLE.muted} />
                  </View>
                  <Label text={t("tree.nextBallBrief")} size={BRIEF_SIZE} lineHeight={BRIEF_LINE} color={BRIEF_INK[state]} wrap />
                </Pressable>
              );
            }
            const slot = Number(n.id.slice(5));
            const ball = roster.find(b => b.slot === slot);
            const held = ball ? RUNG_IDS.filter(id => (ball.rungs[id] ?? 0) > 0) : [];
            return (
              <Pressable key={n.id} onTap={() => setOpenBall(slot)} label={t("tree.ballN", { n: slot })} layout={box}>
                <View layout={head}>
                  <View layout={{ width: 16, height: 16, borderRadius: 8, backgroundColor: 0xff5b5b, alignItems: "center", justifyContent: "center" }}>
                    <Label text={String(slot)} size={10} weight="700" color={0x000000} />
                  </View>
                  <View layout={{ flex: 1 }}><Label text={ball?.name ?? t("tree.ballN", { n: slot })} size={TEXT.xs} weight="700" color={INK_OF.owned} truncate /></View>
                </View>
                <Label
                  text={held.length > 0 ? held.map(id => `${RUNG_META[id].label} ${ball!.rungs[id]}`).join(", ") : t("tree.tapForRungs")}
                  size={BRIEF_SIZE} lineHeight={BRIEF_LINE} color={BRIEF_INK.owned} wrap
                />
              </Pressable>
            );
          }
          const node = byId.get(n.id);
          if (!node) return null;
          const icon = getUpgradeIcon(node, nodes);
          const price = priceOf(node);
          return (
            <Pressable key={n.id} onTap={() => setOpenNode(node.id)} alpha={ALPHA_OF[state]} label={contentText.upgradeName(t, node)} layout={box}>
              <View layout={head}>
                {state === "owned" ? <Icon icon={Check} size={12} color={INK_OF.owned} /> : state === "locked" ? <Icon icon={Lock} size={12} color={INK_OF.locked} /> : icon ? <Icon icon={icon} size={12} color={INK_OF[state]} /> : <Icon icon={Sparkles} size={12} color={INK_OF[state]} />}
                <View layout={{ flex: 1 }}><Label text={contentText.upgradeName(t, node)} size={TEXT.xs} weight="700" color={INK_OF[state]} truncate /></View>
                {state !== "owned" && <Label text={`${price}h`} size={TEXT.xs} weight="700" color={state === "canBuy" ? ROLE.hours : ROLE.muted} />}
              </View>
              <Label text={contentText.treeBrief(t, node)} size={BRIEF_SIZE} lineHeight={BRIEF_LINE} color={BRIEF_INK[state]} wrap />
            </Pressable>
          );
        })}
      </View>
    </PanView>
  );

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
      shelf={map}
      footer={
        <Appear fromY={20} delay={0.3}>
          <ArcadeButton onTap={onContinue} iconAfter={ArrowRight}>
            <ArcadeText text={continueLabel(plan, "store", t)} color={arcadeInk("primary")} size={TEXT.sm} />
          </ArcadeButton>
        </Appear>
      }
    >
      <Appear fromY={-8} delay={0.08}>
        <View layout={{ gap: 8 }}>
          {nextMap && (
            <Label
              text={nextMap.features.length > 0
                ? t("cardDraft.nextMap", { level: nextMap.level, name: nextMap.name, features: nextMap.features.join(", ") })
                : t("cardDraft.nextMapPlain", { level: nextMap.level, name: nextMap.name })}
              size={TEXT.xs} color={ROLE.muted} wrap
            />
          )}
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Label text={t("tree.dragHint")} size={TEXT.xs} color={ROLE.muted} />
            {legend.map(l => (
              <View key={l.state} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View layout={{ width: 12, height: 12, borderRadius: 3, borderWidth: l.state === "canBuy" ? 2 : 1, borderColor: EDGE_OF[l.state], backgroundColor: FILL_OF[l.state] }} alpha={ALPHA_OF[l.state]} />
                <Label text={l.text} size={TEXT.xs} color={ROLE.muted} />
              </View>
            ))}
          </View>
        </View>
      </Appear>
    </PipelineFrame>
  );
}

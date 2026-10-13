/**
 * Gallery entries: the play screen's HUD (top bar, chips, banners and the
 * bottom stack), with props shaped like GameScreen's, each placed where it
 * really sits: the top bar at the top, the bottom bars at the bottom edge.
 */
import { getAllAbilities } from "@/lib/abilities";
import { getAllFenceTypes } from "@/lib/fences";
import { BALL_MARKS } from "@/lib/rendering/sleek/ballMark";
import { View } from "../../kit/ui";
import type { GalleryEntry } from "../galleryTypes";
import { GoalChip } from "../../game/GoalChip";
import { ConditionChip } from "../../game/ConditionChip";
import { TagChip } from "../../game/TagChip";
import { BallMark } from "../../game/BallMark";
import { MapRuleBanner } from "../../game/MapRuleBanner";
import { BossBanner } from "../../game/BossBanner";
import { PlayChips } from "../../game/PlayChips";
import { FenceSlotBar } from "../../game/FenceSlotBar";
import { AbilityIcon } from "../../game/AbilityIcon";
import { AbilityCountdownBar } from "../../game/AbilityCountdownBar";
import { PushExitBar } from "../../game/PushExitBar";
import { topBarHeight } from "../../game/hudMetrics";
import { ACCENT, BASIC_GOALS, CHARGES, GRAVITY, LONG_GOALS, TAGS, noop, timers } from "./playData";
import {
  AbilitySample, Bottom, ControlsSample, FenceSample, InLocale, MessageSample, Samples, ShipEarlySample, Stack, TopBarSample, WholeHud,
} from "./playSamples";

// ── Entries ────────────────────────────────────────────────────────────────

export const entries: GalleryEntry[] = [
  // Every state of a group on one screen, for a quick look.
  {
    id: "Sheet-topBars", group: "play", render: () => (
      <Stack>
        <TopBarSample goals={BASIC_GOALS} />
        <TopBarSample goals={BASIC_GOALS} extras />
        <TopBarSample goals={LONG_GOALS} extras />
        <InLocale lng="es"><TopBarSample goals={LONG_GOALS} extras /></InLocale>
        <TopBarSample goals={[]} />
      </Stack>
    ),
  },
  {
    id: "Sheet-bottomBars", group: "play", render: () => (
      <Stack>
        <FenceSample ids={["ice", "guardrail", "flare"]} initial="ice" />
        <FenceSample ids={getAllFenceTypes().map(f => f.id)} initial="standard" />
        <FenceSlotBar slotIds={["guardrail", "mutex"]} selectedId="guardrail" accentColor={ACCENT} onSelect={noop} shieldSpent deferAutoInfo />
        <AbilitySample charges={CHARGES} armed="magnet" />
        <AbilityCountdownBar timers={timers(1)} visible />
        <AbilityCountdownBar timers={timers(3)} visible />
        <MessageSample id="cutWouldTrapBall" />
        <InLocale lng="es"><MessageSample id="guardrailCaught" /></InLocale>
        <ShipEarlySample start={4} />
        <ShipEarlySample start={78} />
        <InLocale lng="es"><PushExitBar bonusSoFar={12} onBank={noop} accentColor={ACCENT} /></InLocale>
        <ControlsSample open={false} />
      </Stack>
    ),
  },
  {
    id: "Sheet-chips", group: "play", render: () => (
      <Samples items={[
        ["goal chips", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <GoalChip goal={BASIC_GOALS[0]} accentColor={ACCENT} onExplain={noop} onHoldStart={noop} onHoldEnd={noop} />
            <GoalChip goal={LONG_GOALS[0]} accentColor={ACCENT} winMet onExplain={noop} />
            <GoalChip goal={LONG_GOALS[0]} accentColor={ACCENT} onExplain={noop} />
            <GoalChip goal={LONG_GOALS[2]} accentColor={ACCENT} atRisk onExplain={noop} />
            <GoalChip goal={LONG_GOALS[3]} accentColor={ACCENT} onExplain={noop} />
            <GoalChip goal={BASIC_GOALS[1]} accentColor={ACCENT} onExplain={noop} />
            <GoalChip goal={LONG_GOALS[6]} accentColor={ACCENT} onExplain={noop} />
          </View>
        )],
        ["condition chips", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <ConditionChip condition={{ kind: "mapHas", feature: "mover" }} live />
            <ConditionChip condition={{ kind: "livesAtMost", value: 1 }} live={false} />
            <ConditionChip condition={{ kind: "ballsAtLeast", value: 4 }} live sizeClass="text-xs" />
            <InLocale lng="es"><ConditionChip condition={{ kind: "bankedAtLeast", value: 20 }} live={false} /></InLocale>
          </View>
        )],
        ["tag chips", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {TAGS.map(tg => <TagChip key={tg} tag={tg} />)}
            {TAGS.map(tg => <TagChip key={`p-${tg}`} tag={tg} pill ringed suffix="2/3" sizeClass="text-xs" />)}
          </View>
        )],
        ["ball marks and ability glyphs", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {Object.keys(BALL_MARKS).map(ability => (
              <View key={ability} layout={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 0x1d4ed8 }}>
                <BallMark ability={ability} color="#1d4ed8" size={24} />
              </View>
            ))}
            {getAllAbilities().map(a => (
              <AbilityIcon key={a.id} kind={a.kind} size={24} color={Number.parseInt((a.color || ACCENT).slice(1), 16)} />
            ))}
          </View>
        )],
        ["boss banners", (
          <View layout={{ gap: 8 }}>
            <BossBanner name="The Auditor" timeLimit={90} activeSeconds={31} hp={3} maxHp={5} defeated={false} />
            <BossBanner name="Legacy Monolith" timeLimit={90} activeSeconds={83} hp={1} maxHp={6} defeated={false} />
            <BossBanner name="The Auditor" timeLimit={null} activeSeconds={40} hp={0} maxHp={5} defeated />
          </View>
        )],
        ["map rule (announcing, then the chip after 5s)", (
          <InLocale lng="es"><MapRuleBanner mutator={GRAVITY} onExplain={noop} layout={{ alignSelf: "stretch", height: 110 }} /></InLocale>
        )],
      ]} />
    ),
  },

  { id: "PlayLayout", group: "play", render: () => <WholeHud abilities pushExit={false} /> },
  { id: "PlayLayout-push", group: "play", render: () => <WholeHud abilities={false} pushExit /> },

  { id: "GameTopBar", group: "play", render: () => <TopBarSample goals={BASIC_GOALS} /> },
  { id: "GameTopBar-extras", group: "play", render: () => <TopBarSample goals={BASIC_GOALS} extras /> },
  { id: "GameTopBar-longGoals", group: "play", render: () => <TopBarSample goals={LONG_GOALS} extras /> },
  { id: "GameTopBar-es", group: "play", render: () => <InLocale lng="es"><TopBarSample goals={LONG_GOALS} extras /></InLocale> },
  { id: "GameTopBar-empty", group: "play", render: () => <TopBarSample goals={[]} /> },

  {
    id: "GoalChip", group: "play", render: () => (
      <Samples items={[
        ["requirement, outstanding (space, holdable)", <GoalChip goal={BASIC_GOALS[0]} accentColor={ACCENT} onExplain={noop} onHoldStart={noop} onHoldEnd={noop} />],
        ["space done, map won: CLEAR", <GoalChip goal={LONG_GOALS[0]} accentColor={ACCENT} winMet onExplain={noop} />],
        ["space done, map not won", <GoalChip goal={LONG_GOALS[0]} accentColor={ACCENT} onExplain={noop} />],
        ["at risk (one ball left)", <GoalChip goal={LONG_GOALS[2]} accentColor={ACCENT} atRisk onExplain={noop} />],
        ["done", <GoalChip goal={LONG_GOALS[3]} accentColor={ACCENT} onExplain={noop} />],
        ["tally", <GoalChip goal={BASIC_GOALS[1]} accentColor={ACCENT} onExplain={noop} />],
        ["budget, over par", <GoalChip goal={LONG_GOALS[6]} accentColor={ACCENT} onExplain={noop} />],
      ]} />
    ),
  },

  {
    id: "ConditionChip", group: "play", render: () => (
      <Samples items={[
        ["live", <ConditionChip condition={{ kind: "mapHas", feature: "mover" }} live />],
        ["not now", <ConditionChip condition={{ kind: "livesAtMost", value: 1 }} live={false} />],
        ["text-xs", <ConditionChip condition={{ kind: "ballsAtLeast", value: 4 }} live sizeClass="text-xs" />],
        ["es, not now", <InLocale lng="es"><ConditionChip condition={{ kind: "bankedAtLeast", value: 20 }} live={false} /></InLocale>],
      ]} />
    ),
  },

  {
    id: "TagChip", group: "play", render: () => (
      <Samples items={[
        ["every tag", <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{TAGS.map(tg => <TagChip key={tg} tag={tg} />)}</View>],
        ["pill, ringed, suffix, text-xs", <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{TAGS.map(tg => <TagChip key={tg} tag={tg} pill ringed suffix="2/3" sizeClass="text-xs" />)}</View>],
      ]} />
    ),
  },

  {
    id: "BallMark", group: "play", render: () => (
      <Samples items={[
        ["every mark, on a light and a dark ball (28px)", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {Object.keys(BALL_MARKS).flatMap(ability => ["#f5f5f5", "#1d4ed8"].map(color => (
              <View key={`${ability}-${color}`} layout={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Number.parseInt(color.slice(1), 16) }}>
                <BallMark ability={ability} color={color} size={28} />
              </View>
            )))}
          </View>
        )],
        ["one large (56px)", (
          <View layout={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 0xf59e0b }}>
            <BallMark ability={Object.keys(BALL_MARKS)[0]} color="#f59e0b" size={56} />
          </View>
        )],
      ]} />
    ),
  },

  {
    id: "AbilityIcon", group: "play", render: () => (
      <Samples items={[
        ["every ability's glyph in its colour, then the fallback sparkle", (
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {getAllAbilities().map(a => (
              <AbilityIcon key={a.id} kind={a.kind} size={24} color={Number.parseInt((a.color || ACCENT).slice(1), 16)} />
            ))}
            <AbilityIcon kind="notAKind" size={24} />
          </View>
        )],
      ]} />
    ),
  },

  {
    id: "MapRuleBanner", group: "play", render: () => (
      // The gutter above a square board on a 390x844 phone: about 150px.
      <MapRuleBanner mutator={GRAVITY} onExplain={noop} layout={{ position: "absolute", left: 0, top: topBarHeight(), width: 390, height: 150 }} />
    ),
  },
  {
    id: "MapRuleBanner-narrow", group: "play", render: () => (
      <InLocale lng="es">
        <MapRuleBanner mutator={GRAVITY} onExplain={noop} layout={{ position: "absolute", left: 0, top: topBarHeight(), width: 320, height: 110 }} />
      </InLocale>
    ),
  },

  {
    id: "BossBanner", group: "play", render: () => (
      <BossBanner name="The Auditor" timeLimit={90} activeSeconds={31} hp={3} maxHp={5} defeated={false}
        layout={{ position: "absolute", left: 0, top: 70 + 75, width: 390, alignItems: "center" }} />
    ),
  },
  {
    id: "BossBanner-urgent", group: "play", render: () => (
      <BossBanner name="Legacy Monolith" timeLimit={90} activeSeconds={83} hp={1} maxHp={6} defeated={false} accentColor="#ff2d55"
        layout={{ position: "absolute", left: 0, top: 70 + 75, width: 390, alignItems: "center" }} />
    ),
  },
  {
    id: "BossBanner-defeated", group: "play", render: () => (
      <BossBanner name="The Auditor" timeLimit={null} activeSeconds={40} hp={0} maxHp={5} defeated
        layout={{ position: "absolute", left: 0, top: 70 + 75, width: 390, alignItems: "center" }} />
    ),
  },

  {
    id: "PlayChips", group: "play", render: () => (
      <PlayChips accentColor={ACCENT} top={topBarHeight()}
        freeze={{ left: 2, total: 3 }} derails={{ left: 0, total: 2 }} bands={{ left: 1, total: 2 }} fenceBudget={{ left: 2, total: 9 }} />
    ),
  },

  { id: "FenceSlotBar", group: "play", render: () => <Bottom><FenceSample ids={[]} initial="standard" /></Bottom> },
  { id: "FenceSlotBar-several", group: "play", render: () => <Bottom><FenceSample ids={["ice", "guardrail", "flare"]} initial="ice" /></Bottom> },
  { id: "FenceSlotBar-all", group: "play", render: () => <Bottom><FenceSample ids={getAllFenceTypes().map(f => f.id)} initial="standard" /></Bottom> },
  {
    id: "FenceSlotBar-shieldSpent", group: "play", render: () => (
      <Bottom><FenceSlotBar slotIds={["guardrail", "mutex"]} selectedId="guardrail" accentColor={ACCENT} onSelect={noop} shieldSpent deferAutoInfo /></Bottom>
    ),
  },

  { id: "AbilityBar", group: "play", render: () => <Bottom><AbilitySample charges={CHARGES} armed="magnet" /></Bottom> },
  {
    id: "AbilityBar-full", group: "play", render: () => (
      <Bottom><AbilitySample charges={Object.fromEntries(getAllAbilities().map((a, i) => [a.id, 1 + (i % 3)]))} /></Bottom>
    ),
  },


  { id: "AbilityCountdownBar", group: "play", render: () => <Bottom><AbilityCountdownBar timers={timers(1)} visible /></Bottom> },
  { id: "AbilityCountdownBar-three", group: "play", render: () => <Bottom><AbilityCountdownBar timers={timers(3)} visible /></Bottom> },

  { id: "GameMessageBar", group: "play", render: () => <Bottom><MessageSample id="wallInTheWay" /></Bottom> },
  {
    id: "GameMessageBar-es", group: "play", render: () => (
      <InLocale lng="es"><Bottom><MessageSample id="guardrailCaught" /></Bottom></InLocale>
    ),
  },
  {
    id: "GameMessageBar-en-long", group: "play", render: () => (
      <Bottom><MessageSample id="cutWouldTrapBall" /></Bottom>
    ),
  },

  { id: "ShipEarlyBar", group: "play", render: () => <Bottom><ShipEarlySample start={4} /></Bottom> },
  { id: "ShipEarlyBar-late", group: "play", render: () => <Bottom><ShipEarlySample start={78} /></Bottom> },

  { id: "PushExitBar", group: "play", render: () => <Bottom><PushExitBar bonusSoFar={6} onBank={noop} accentColor={ACCENT} /></Bottom> },
  {
    id: "PushExitBar-es", group: "play", render: () => (
      <InLocale lng="es"><Bottom><PushExitBar bonusSoFar={12} onBank={noop} accentColor={ACCENT} /></Bottom></InLocale>
    ),
  },

  { id: "ControlsRow", group: "play", render: () => <Bottom><ControlsSample open={false} /></Bottom> },
  { id: "ControlsRow-menu", group: "play", render: () => <Bottom><ControlsSample open admin /></Bottom> },
  {
    id: "ControlsRow-menu-es", group: "play", render: () => (
      <InLocale lng="es"><Bottom><ControlsSample open admin /></Bottom></InLocale>
    ),
  },
];

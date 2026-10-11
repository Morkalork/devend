/**
 * The pipeline kit pieces assembled into the between-map screen's two first
 * stages, with sample figures. Not wired to the game: this is what Phase 2
 * builds the real screen from, shown here so it can be judged on a phone
 * before it replaces anything.
 */
import { useState } from "react";
import {
  ArcadeButton, Headline, Ledger, ROLE, ScrollView, StageRail, TEXT, Label, Ticket, View, formatHours,
  hex, useUiScreen, type Stage,
} from "../../kit/ui";

const ACCENT = hex("#39e38a");

const DEBRIEF: Stage[] = [
  { id: "debrief", title: "Debrief", detail: "lvl-10 pipeline, cleared in 48s", state: "now" },
  { id: "promotion", title: "Promotion", detail: "Pick a permanent perk", state: "todo" },
  { id: "store", title: "Store", detail: "120h to spend", state: "todo" },
  { id: "deploy", title: "Level 11", detail: "Electric blue band", state: "todo" },
];

const STORE: Stage[] = [
  { id: "debrief", title: "Debrief", detail: "+96h, new personal best", state: "done" },
  { id: "promotion", title: "Promotion", detail: "Stock Options", state: "done" },
  { id: "store", title: "Store", detail: "Rates +32%, 2 restocks", state: "now" },
  { id: "deploy", title: "Level 11", detail: "Electric blue band", state: "todo" },
];

function Shell({ step, children }: { step: string; children: React.ReactNode }) {
  const screen = useUiScreen();
  return (
    <View layout={{
      position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
      backgroundColor: ROLE.surface, paddingLeft: 16, paddingRight: 16, paddingTop: 20, paddingBottom: 20, gap: 12,
    }}>
      <Label text={step} size={TEXT.xs} color={ROLE.muted} />
      <ScrollView layout={{ flex: 1, gap: 12 }}>{children}</ScrollView>
    </View>
  );
}

export function PipelineDebriefSample() {
  return (
    <Shell step="Run 12, after level 10">
      <Headline value="+96" unit="h" caption="of 110h possible on this map" />
      <StageRail stages={DEBRIEF} accent={ACCENT}>
        <Ledger accent={ACCENT} rows={[
          { label: "All balls locked", value: "+40h", tone: "pass" },
          { label: "3 cuts under par", value: "+18h", tone: "pass" },
          { label: "Syntax area locks x2", value: "+24h", tone: "pass" },
          { label: "Shipped early", value: "+12h", tone: "pass" },
          { label: "Over the time limit", value: "-6h", tone: "fail" },
          { label: "Earned", value: formatHours(96), tone: "total" },
          { label: "Run total, new best", value: formatHours(1284), tone: "total" },
        ]} />
        <ArcadeButton text="Next stage" onTap={() => {}} />
      </StageRail>
    </Shell>
  );
}

export function PipelineStoreSample() {
  const [picked, setPicked] = useState<string | null>("Memory Footprint");
  const tickets = [
    { title: "Memory Footprint", body: "Balls are 5% smaller.", kicker: "Principal", price: 83, wasPrice: 70 },
    { title: "Hot Start", body: "Your first fence each map builds instantly.", kicker: "Junior", price: 41 },
    { title: "Code Review", body: "See where a cut will land before you release it.", kicker: "Senior", price: 60 },
    { title: "Multithreading", body: "Draw two fences at once. Needs Senior first.", kicker: "Principal", price: 150, locked: true },
  ];
  return (
    <Shell step="Run 12, after level 10">
      <Headline value="120" unit="h" caption="to spend before level 11" />
      <StageRail stages={STORE} accent={ACCENT}>
        {tickets.map(t => (
          <Ticket key={t.title} accent={ACCENT} title={t.title} body={t.body} kicker={t.kicker}
            price={t.price} wasPrice={t.wasPrice} locked={t.locked}
            selected={picked === t.title} onTap={() => setPicked(p => (p === t.title ? null : t.title))} />
        ))}
        <ArcadeButton text={picked ? `Buy and continue` : "Continue"} onTap={() => {}} />
      </StageRail>
    </Shell>
  );
}

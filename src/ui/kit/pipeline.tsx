/**
 * The pieces the between-map pipeline is built from (UI redo, direction B):
 * a stage rail, a headline figure, the debrief ledger and an upgrade ticket.
 *
 * They draw in the ROLE colours (theme.ts) plus the band's accent, which each
 * takes as a prop. No glow anywhere: hierarchy comes from size and weight, and
 * the only coloured thing on a stage is what the colour means (gold for hours,
 * red for a cost, the accent for done).
 */
import type { ReactNode } from "react";
import { ROLE, RADIUS, TEXT } from "../theme";
import { Label, Pressable, View } from "./core";
import { tint } from "./style";
import { useCountTo } from "./motion";
import { formatHours, ledgerHasMarks, ledgerLook, splitLedger, stageMark, type LedgerRow, type Stage } from "./pipelineStyle";

// ── Stage rail ─────────────────────────────────────────────────────────────

/** The marker's size; the rail line runs through its centre. */
const DOT = 12;
/** Width of the column the markers and the rail sit in. */
const GUTTER = 22;

export interface StageRailProps {
  stages: readonly Stage[];
  /** The band's accent: done stages wear it. */
  accent: number;
  /** Drawn under the current stage's title, inside the rail. */
  children?: ReactNode;
}

/**
 * Every between-map stage on one vertical line, the current one open.
 *
 * The run used to stop and restart between maps: Level Complete, Store, a
 * draft, each its own screen with its own header and its own idea of where
 * Continue goes. Here the stages before and after stay visible, so the
 * player always knows how far there is to go before the next map.
 */
export function StageRail({ stages, accent, children }: StageRailProps) {
  return (
    <View layout={{ flexDirection: "column", alignSelf: "stretch" }}>
      {stages.map((s, i) => {
        const mark = stageMark(s.state, accent);
        const last = i === stages.length - 1;
        return (
          <View key={s.id} label={`stage-${s.id}`} layout={{ flexDirection: "row", alignSelf: "stretch" }}>
            <View layout={{ width: GUTTER, alignItems: "center" }}>
              <View layout={{
                width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: 4,
                borderWidth: 2, borderColor: mark.ring, backgroundColor: mark.filled ? mark.ring : ROLE.surface,
              }} />
              {!last && <View layout={{ width: 2, flex: 1, minHeight: 14, backgroundColor: ROLE.edge, marginTop: 2 }} />}
            </View>
            <View layout={{ flex: 1, paddingLeft: 8, paddingBottom: last ? 0 : 14, gap: 2 }}>
              <Label text={s.title} font="display" size={TEXT.base} color={mark.title} />
              {s.detail && <Label text={s.detail} size={TEXT.xs} color={ROLE.muted} wrap />}
              {s.state === "now" && children && <View layout={{ paddingTop: 10, gap: 10, alignSelf: "stretch" }}>{children}</View>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Stage strip ────────────────────────────────────────────────────────────

/**
 * The same stages as the rail, on one line: what the real between-map
 * screens use. The store's shelf is a full-width carousel and the debrief a
 * column of rows, and both need the width a rail's gutter would take, so the
 * stages sit across the top instead. Wraps onto a second line when the names
 * do not fit (Swedish runs long).
 */
export function StageStrip({ stages, accent }: { stages: readonly Stage[]; accent: number }) {
  return (
    <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 6, alignSelf: "stretch" }}>
      {stages.map((s, i) => {
        const mark = stageMark(s.state, accent);
        return (
          <View key={s.id} label={`stage-${s.id}`} layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {i > 0 && <View layout={{ width: 10, height: 2, backgroundColor: ROLE.edge }} />}
            <View layout={{
              width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: mark.ring,
              backgroundColor: mark.filled ? mark.ring : ROLE.surface,
            }} />
            <Label text={s.title} font="display" size={TEXT.xs} weight={s.state === "now" ? "700" : "500"}
              color={s.state === "now" ? ROLE.hours : mark.title} />
          </View>
        );
      })}
    </View>
  );
}

// ── Headline ───────────────────────────────────────────────────────────────

export interface HeadlineProps {
  /**
   * The figure without its unit. A number counts to itself (up from 0 when
   * the stage opens, then to each new value); a string is drawn as given,
   * for a figure the caller already animates or one that is not a count.
   */
  value: string | number;
  /** A number drawn with its sign ("+96"). */
  signed?: boolean;
  /** Set apart in gold after the figure ("h"); omit for a bare number. */
  unit?: string;
  /** One line under it ("of 110h possible"). */
  caption?: string;
  size?: number;
  color?: number;
}

/** The one big figure a stage is about, left-aligned, its unit in gold. */
export function Headline({ value, signed, unit, caption, size = 44, color = ROLE.ink }: HeadlineProps) {
  const counted = useCountTo(typeof value === "number" ? value : 0);
  const text = typeof value === "number" ? `${signed && counted >= 0 ? "+" : ""}${counted}` : value;
  return (
    <View layout={{ gap: 2 }}>
      <View layout={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
        <Label text={text} font="display" weight="700" size={size} color={color} lineHeight={Math.round(size * 1.05)} />
        {unit && (
          <Label text={unit} font="display" weight="700" size={Math.round(size * 0.42)} color={ROLE.hours}
            layout={{ marginBottom: Math.round(size * 0.14) }} />
        )}
      </View>
      {caption && <Label text={caption} size={TEXT.xs} color={ROLE.muted} wrap />}
    </View>
  );
}

// ── Ledger ─────────────────────────────────────────────────────────────────

export interface LedgerProps {
  rows: readonly LedgerRow[];
  accent: number;
}

function LedgerLine({ row, accent, marks }: { row: LedgerRow; accent: number; marks: boolean }) {
  const look = ledgerLook(row.tone, accent);
  return (
    <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8, alignSelf: "stretch" }}>
      {/* The mark column only when some row has a mark; otherwise it was an empty indent. */}
      {marks && (
        <View layout={{ width: 12 }}>
          {look.mark && <Label text={look.mark} font="mono" size={TEXT.sm} color={look.markColor} />}
        </View>
      )}
      <View layout={{ flex: 1 }}>
        <Label text={row.label} font="mono" size={TEXT.sm} color={look.textColor} truncate />
        {row.detail && <Label text={row.detail} font="mono" size={TEXT.xs} color={ROLE.muted} truncate />}
      </View>
      {row.value && (
        <Label text={row.value} font="mono" size={TEXT.sm}
          color={row.tone === "fail" ? ROLE.cost : row.tone === "total" ? ROLE.hours : ROLE.muted}
          weight={row.tone === "total" ? "700" : "400"} />
      )}
    </View>
  );
}

/**
 * The debrief as a log: one line per thing that paid or cost, a rule, then the
 * totals. Monospace here and only here, so the figures line up in a column.
 */
export function Ledger({ rows, accent }: LedgerProps) {
  const { body, totals } = splitLedger(rows);
  const marks = ledgerHasMarks(rows);
  return (
    <View layout={{ alignSelf: "stretch", gap: 6, padding: 12, borderRadius: RADIUS.sm, backgroundColor: ROLE.raised }}>
      {body.map((r, i) => <LedgerLine key={`b${i}`} row={r} accent={accent} marks={marks} />)}
      {body.length > 0 && totals.length > 0 && (
        <View layout={{ height: 1, alignSelf: "stretch", backgroundColor: ROLE.edge, marginTop: 2, marginBottom: 2 }} />
      )}
      {totals.map((r, i) => <LedgerLine key={`t${i}`} row={r} accent={accent} marks={marks} />)}
    </View>
  );
}

// ── Ticket ─────────────────────────────────────────────────────────────────

export interface TicketProps {
  title: string;
  body?: string;
  /** Small line above the title (a tier, "From your last run"). */
  kicker?: string;
  /** Price in hours; drawn in gold. */
  price?: number;
  /** Struck through before the price (a discount). */
  wasPrice?: number;
  selected?: boolean;
  locked?: boolean;
  accent: number;
  onTap?: () => void;
  onHold?: () => void;
  /** Extra content under the body (a progress bar, a chip). */
  children?: ReactNode;
  label?: string;
}

/**
 * One thing to pick: an upgrade, a loadout, a perk. A flat panel with a 1px
 * edge; the edge turns to the accent when it is selected, and a locked ticket
 * dims. Hold opens the explainer, like every holdable element in the game.
 */
export function Ticket({
  title, body, kicker, price, wasPrice, selected, locked, accent, onTap, onHold, children, label,
}: TicketProps) {
  return (
    <Pressable label={label ?? `ticket-${title}`} onTap={onTap} onHold={onHold} disabled={locked && !onHold}
      alpha={locked ? 0.45 : 1} layout={{
        alignSelf: "stretch", gap: 4, padding: 12, borderRadius: RADIUS.sm,
        backgroundColor: selected ? tint(accent, 0.1) : ROLE.raised,
        borderWidth: 1, borderColor: selected ? accent : ROLE.edge,
      }}>
      {kicker && <Label text={kicker} size={TEXT.xs} color={selected ? accent : ROLE.muted} upper letterSpacing={1} />}
      <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8, alignSelf: "stretch" }}>
        <View layout={{ flex: 1 }}>
          <Label text={title} font="display" size={TEXT.base} color={ROLE.ink} wrap />
        </View>
        {price != null && (
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {wasPrice != null && wasPrice !== price && (
              // Canvas text has no strike-through, so the line is drawn over it.
              <View layout={{ justifyContent: "center" }}>
                <Label text={formatHours(wasPrice)} size={TEXT.xs} color={ROLE.muted} />
                <View layout={{ position: "absolute", left: 0, right: 0, height: 1, backgroundColor: ROLE.muted }} />
              </View>
            )}
            <Label text={formatHours(price)} font="display" weight="700" size={TEXT.base} color={ROLE.hours} />
          </View>
        )}
      </View>
      {body && <Label text={body} size={TEXT.sm} color={ROLE.muted} wrap />}
      {children}
    </Pressable>
  );
}

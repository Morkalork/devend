/**
 * Pieces the draft screens share on the canvas: the full-screen scrolling
 * frame, the round header badge, the card grid and the wrapping rich text.
 * Each DOM draft screen wrote these out inline; here they are written once so
 * the four screens cannot drift apart the way their DOM markup did. (The
 * arcade button is the kit's.)
 */
import type { ReactNode } from "react";
import type { TextStyleFontWeight } from "pixi.js";
import type { LucideIcon } from "lucide-react";
import { Appear, COLOR, Icon, Label, RADIUS, ROLE, ScrollView, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { fitTextWidth } from "../kit/arcadeStyle";
import type { FontRole } from "../theme";
import { DRAFT_HINT, DRAFT_TEXT, SM_BREAKPOINT, draftColumns, gridRows, richWords, type RichRun } from "./draftModel";

// ── Screen frame ───────────────────────────────────────────────────────────

/**
 * Full screen on the redo's flat surface (UI_REDO_PLAN.md), its content one
 * left-aligned column capped at the pipeline's width, centred vertically
 * while it fits and scrolling once it does not.
 */
export function DraftFrame({ children, overlay, groundAlpha = 0.96 }: { children?: ReactNode; overlay?: ReactNode; groundAlpha?: number }) {
  const screen = useUiScreen();
  const pad = screen.width >= SM_BREAKPOINT ? 24 : 16;
  const contentW = Math.min(screen.width - pad * 2, 720);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(ROLE.surface, groundAlpha) }}>
      <ScrollView layout={{ width: screen.width, height: screen.height }}>
        <View layout={{ minHeight: screen.height, width: screen.width, alignItems: "center", justifyContent: "center", padding: pad }}>
          <Appear fromY={8} duration={0.3}>
            <View layout={{ width: contentW, gap: 20, paddingTop: 16, paddingBottom: 16 }}>
              {children}
            </View>
          </Appear>
        </View>
      </ScrollView>
      {overlay}
    </View>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

interface DraftHeaderProps {
  icon: LucideIcon;
  accent: number;
  title: string;
  /** Lines under the title, each with its own colour, size and opacity. */
  lines: { text: string; color?: number; size?: number; alpha?: number; weight?: "400" | "600" }[];
}

/**
 * The icon in the screen's accent beside the title, then the lines under it,
 * all on the column's left edge. (It was a round glowing badge over a centred
 * 900-weight title.)
 */
export function DraftHeader({ icon, accent, title, lines }: DraftHeaderProps) {
  const screen = useUiScreen();
  return (
    <View layout={{ alignSelf: "stretch", gap: 4 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <Icon icon={icon} size={28} color={accent} />
        <View layout={{ flex: 1 }}>
          <Label
            text={title}
            size={screen.width >= SM_BREAKPOINT ? TEXT["3xl"] : TEXT["2xl"]}
            font="display" weight="700" color={ROLE.ink}
            wrap
          />
        </View>
      </View>
      {lines.map((l, i) => (
        <Label
          key={i}
          text={l.text}
          size={l.size ?? TEXT.sm}
          color={l.color ?? ROLE.muted}
          alpha={l.alpha === undefined ? undefined : Math.max(l.alpha, 0.9)}
          weight={l.weight}
          wrap
        />
      ))}
    </View>
  );
}

// ── Card grid ──────────────────────────────────────────────────────────────

/**
 * One column on a phone; two (narrowed and centred) for a pair, otherwise
 * three, from `sm` up. Cards in a row share its height.
 */
export function DraftGrid({ count, children, alwaysThree = false }: { count: number; children: ReactNode[]; alwaysThree?: boolean }) {
  const screen = useUiScreen();
  const { columns, maxWidth } = draftColumns(count, screen.width, alwaysThree);
  const rows = gridRows(children, columns);
  return (
    <View layout={{ alignSelf: "stretch", alignItems: "center", gap: 12 }}>
      <View layout={{ alignSelf: "stretch", gap: 12, ...(maxWidth ? { maxWidth, alignSelf: "center", width: maxWidth } : {}) }}>
        {rows.map((row, r) => (
          <View key={r} layout={{ flexDirection: "row", gap: 12, alignItems: "stretch" }}>
            {row.map((cell, c) => (
              <View key={c} layout={{ flex: 1, flexBasis: 0 }}>{cell}</View>
            ))}
            {/* Keep a short last row's cards the width of the rest. */}
            {Array.from({ length: columns - row.length }, (_, k) => <View key={`pad${k}`} layout={{ flex: 1, flexBasis: 0 }} />)}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A `border-t` rule across the top of its parent (put it first in a box with
 * paddingTop). A View draws one border width on every side, so a single side
 * is a 1px box laid over the edge.
 */
export function TopRule({ color = COLOR.border }: { color?: number | string }) {
  return <View layout={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: color }} />;
}

/** The dashed "nothing to draft" box (an empty pool). */
export function DraftEmpty({ text, accent }: { text: string; accent: number }) {
  return (
    <View layout={{ alignSelf: "stretch", borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: tint(accent, 0x44 / 255) }}>
      <Label text={text} size={TEXT.xs} color={DRAFT_HINT} wrap align="center" />
    </View>
  );
}

/** An icon beside a wrapping paragraph: the cards' "glyph, then text" row. */
export function IconRow({ icon, color, size = 20, children }: { icon: LucideIcon; color: number; size?: number; children?: ReactNode }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8, alignSelf: "stretch" }}>
      <Icon icon={icon} size={size} color={color} layout={{ marginTop: 2 }} />
      <View layout={{ flex: 1 }}>{children}</View>
    </View>
  );
}

interface RichParagraphProps {
  runs: RichRun[];
  size: number;
  /** The default ink; a run can override it. */
  color: number;
  align?: "center" | "left";
  font?: FontRole;
  /** The weight of the runs that are not bold. */
  weight?: TextStyleFontWeight;
  upper?: boolean;
  letterSpacing?: number;
  /** Accepted from older callers; the redo draws no text glow. */
  glow?: number;
  /** Laid out before the first word, on its line (an icon leading a heading). */
  lead?: ReactNode;
  /** Space between the lead and the first word. */
  leadGap?: number;
  /** Extra space between wrapped lines (the label's own line height is already there; leading-relaxed wants more). */
  lineGap?: number;
}

/**
 * A wrapping paragraph whose runs may be bold or coloured (see richWords).
 * Each word is its own label in a wrapping row, which is also why it is the
 * way to wrap text that has no definite width to wrap to: the words size
 * themselves, so a centred icon-and-text line can wrap beside its icon.
 */
export function RichParagraph({
  runs, size, color, align = "center", font, weight, upper, letterSpacing, lead, leadGap, lineGap = Math.round(size * 0.1),
}: RichParagraphProps) {
  // One space of the face as it actually measures, plus the tracking it
  // carries. It was a fixed share of the size tuned for Michroma, whose space
  // is far wider than Oxanium's.
  const space = Math.round(fitTextWidth(" ", { size, font, weight }) + (letterSpacing ?? 0));
  return (
    <View layout={{
      alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space, rowGap: lineGap,
      justifyContent: align === "center" ? "center" : "flex-start",
    }}>
      {lead !== undefined && <View layout={{ marginRight: Math.max(0, (leadGap ?? space) - space) }}>{lead}</View>}
      {richWords(runs).map((group, i) => (
        <View key={i} layout={{ flexDirection: "row" }}>
          {group.map((w, j) => (
            <Label key={j} text={w.text} size={size} font={font} color={w.color ?? color} alpha={w.alpha}
              weight={w.bold ? (w.weight ?? "700") : weight} upper={upper} letterSpacing={letterSpacing} />
          ))}
        </View>
      ))}
    </View>
  );
}

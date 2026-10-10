/**
 * Pieces the between-map screens share on the canvas: the arcade buttons
 * (index.css .arcade-button-*), the full-screen scrolling frame, the round
 * header badge and the card grid. Each DOM draft screen wrote these out
 * inline; here they are written once so the four screens cannot drift apart
 * the way their DOM markup did.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, tint, useUiScreen, type Layout,
} from "../kit/ui";
import { DRAFT_HINT, DRAFT_TEXT, SM_BREAKPOINT, draftColumns, gridRows, richWords, type RichRun } from "./draftModel";

// ── Arcade buttons ─────────────────────────────────────────────────────────

interface ArcadeButtonProps {
  variant?: "primary" | "secondary";
  icon?: LucideIcon;
  /** Shown after the text (the shop's trailing arrow). */
  trailingIcon?: LucideIcon;
  text?: string;
  onTap?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  layout?: Layout;
}

/**
 * `.arcade-button-primary` / `-secondary`: Michroma, uppercase, wide
 * tracking, a 2px border. The primary is a primary-tinted ground with primary
 * ink; the secondary is a muted one. Disabled dims (the kit's Pressable does).
 */
export function ArcadeButton({ variant = "primary", icon, trailingIcon, text, onTap, disabled, children, layout }: ArcadeButtonProps) {
  const primary = variant === "primary";
  const ink = primary ? COLOR.primary : COLOR.mutedForeground;
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled}
      label={text}
      pressedAlpha={0.8}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingTop: 13.6, paddingBottom: 13.6, paddingLeft: 27.2, paddingRight: 27.2,
        borderRadius: RADIUS.lg, borderWidth: 2,
        borderColor: primary ? COLOR.primary : tint(COLOR.mutedForeground, 0.3),
        backgroundColor: primary ? tint(COLOR.primary, 0.1) : tint(COLOR.secondary, 0.5),
        ...(layout ?? {}),
      }}
    >
      {icon && <Icon icon={icon} size={20} color={ink} />}
      {text !== undefined && <ArcadeText text={text} color={ink} />}
      {children}
      {trailingIcon && <Icon icon={trailingIcon} size={20} color={ink} />}
    </Pressable>
  );
}

/** The arcade buttons' type: 15px Michroma, uppercase, tracking-widest. */
export function ArcadeText({ text, color, size = 15 }: { text: string; color: number; size?: number }) {
  return <Label text={text} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={color} />;
}

// ── Screen frame ───────────────────────────────────────────────────────────

/**
 * Full screen, the DOM's `min-h-screen bg-background/90 overflow-y-auto` with
 * its content centred vertically while it fits and scrolling once it does not.
 * The CRT background is drawn globally underneath, so the ground here stays
 * translucent, exactly as the DOM's was over it.
 */
export function DraftFrame({ children, overlay, groundAlpha = 0.9 }: { children?: ReactNode; overlay?: ReactNode; groundAlpha?: number }) {
  const screen = useUiScreen();
  const pad = screen.width >= SM_BREAKPOINT ? 24 : 16;
  const contentW = Math.min(screen.width - pad * 2, 768);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, groundAlpha) }}>
      <ScrollView layout={{ width: screen.width, height: screen.height }}>
        <View layout={{ minHeight: screen.height, width: screen.width, alignItems: "center", justifyContent: "center", padding: pad }}>
          <Appear fromScale={0.95} duration={0.4}>
            <View layout={{ width: contentW, alignItems: "center", gap: 24, paddingTop: 24, paddingBottom: 24 }}>
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

/** The round glowing badge, the big display title and the lines under it. */
export function DraftHeader({ icon, accent, title, lines }: DraftHeaderProps) {
  const screen = useUiScreen();
  return (
    <View layout={{ alignSelf: "stretch", alignItems: "center" }}>
      <Appear fromScale={0} duration={0.35} delay={0.1}>
        <View layout={{
          width: 64, height: 64, marginBottom: 12, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center",
          borderWidth: 2, borderColor: accent, backgroundColor: tint(accent, 0x22 / 255),
        }}>
          <Icon icon={icon} size={36} color={accent} />
        </View>
      </Appear>
      <Label
        text={title}
        size={screen.width >= SM_BREAKPOINT ? TEXT["4xl"] : TEXT["3xl"]}
        font="display" weight="900" upper letterSpacing={1.5} color={accent} glow={16}
        wrap align="center"
      />
      {lines.map((l, i) => (
        <Label
          key={i}
          text={l.text}
          size={l.size ?? TEXT.sm}
          color={l.color ?? DRAFT_TEXT}
          alpha={l.alpha}
          weight={l.weight}
          wrap align="center"
          layout={{ marginTop: i === 0 ? 8 : 4 }}
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

/** The dashed "nothing to draft" box (an empty pool). */
export function DraftEmpty({ text, accent }: { text: string; accent: number }) {
  return (
    <View layout={{ alignSelf: "stretch", borderRadius: RADIUS.sm, padding: 16, borderWidth: 1, borderColor: tint(accent, 0x44 / 255) }}>
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

/** A wrapping paragraph whose runs may be bold (see richWords). */
export function RichParagraph({ runs, size, color, align = "center" }: { runs: RichRun[]; size: number; color: number; align?: "center" | "left" }) {
  return (
    <View layout={{
      alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", columnGap: Math.round(size * 0.28), rowGap: Math.round(size * 0.35),
      justifyContent: align === "center" ? "center" : "flex-start",
    }}>
      {richWords(runs).map((group, i) => (
        <View key={i} layout={{ flexDirection: "row" }}>
          {group.map((w, j) => <Label key={j} text={w.text} size={size} color={color} weight={w.bold ? "700" : "400"} />)}
        </View>
      ))}
    </View>
  );
}

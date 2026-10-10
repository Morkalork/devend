/**
 * Small pieces shared by the Specs panel (TopBarDetailsPanel) and its
 * attribute readout (ModifierBreakdown): the panel's mono text, a section with
 * its heading, and a card's "icon + title ... value" header row.
 */
import type { ReactNode } from 'react';
import { COLOR, Icon, Label, TEXT, View, type IconNode, type IconSource, type LabelProps, type Layout } from '../kit/ui';

/** Text in the panel's own face: the DOM panel set JetBrains Mono on its root, so every run inherited it. */
export function SpecsText(p: LabelProps) {
  return <Label font="mono" {...p} />;
}

/** A paragraph of card copy (`text-xs leading-relaxed`), wrapping to the card. */
export function SpecsPara({ text, color, alpha, layout, relaxed = true }: {
  text: string; color: number; alpha?: number; layout?: Layout; relaxed?: boolean;
}) {
  return <SpecsText text={text} size={TEXT.xs} color={color} alpha={alpha} wrap lineHeight={relaxed ? 20 : undefined} layout={layout} />;
}

/** A section heading: Michroma, upper-case, wide-tracked, the accent at 0x88. */
export function SpecsHeading({ text, accent }: { text: string; accent: number }) {
  return (
    <Label text={text} font="display" upper size={11} weight="700" letterSpacing={1.7}
      color={accent} alpha={0x88 / 0xff} layout={{ marginBottom: 12 }} />
  );
}

/** A heading over its content (`space-y-3` between cards by default). */
export function SpecsSection({ heading, accent, children, gap = 12 }: {
  heading: string; accent: number; children?: ReactNode; gap?: number;
}) {
  return (
    <View>
      <SpecsHeading text={heading} accent={accent} />
      <View layout={{ gap }}>{children}</View>
    </View>
  );
}

/**
 * A card's header row: an icon and a bold title on the left, the figure on the
 * right. The title wraps rather than shrinking when a long translation meets a
 * narrow phone.
 */
export function StatHead({ icon, iconColor, iconAlpha, title, titleColor, value, valueColor, valueSize = TEXT.base, marginBottom = 6, glow }: {
  icon?: IconSource | IconNode | null;
  iconColor?: number;
  iconAlpha?: number;
  title: string;
  titleColor: number;
  value?: ReactNode;
  valueColor?: number;
  valueSize?: number;
  marginBottom?: number;
  glow?: number;
}) {
  return (
    <View layout={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom }}>
      <View layout={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon && <Icon icon={icon} size={16} color={iconColor ?? titleColor} alpha={iconAlpha} />}
        <View layout={{ flex: 1 }}>
          <SpecsText text={title} size={TEXT.sm} weight="700" color={titleColor} glow={glow} wrap />
        </View>
      </View>
      {typeof value === 'string'
        ? <SpecsText text={value} size={valueSize} weight="700" color={valueColor ?? COLOR.foreground} glow={glow} />
        : value}
    </View>
  );
}

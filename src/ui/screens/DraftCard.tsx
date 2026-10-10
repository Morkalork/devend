/**
 * DraftCard - the selectable option card used by the between-maps draft
 * screens (canvas port of components/game/DraftCard.tsx). One source for the
 * selected treatment so every draft in the game reads the same.
 *
 * Sized to match the upgrade shop's cards: 20px padding, rounded-xl, a large
 * leading glyph and a text-xl name. A Promotion - a once-per-run reward - used
 * to be presented in a smaller card than a 40-hour Junior upgrade; the card
 * should carry the weight of the decision.
 *
 * Optionally supports press-and-hold: pass `onLongPress` and holding the card
 * opens a detail view instead of selecting it (the kit's Pressable swallows
 * the tap that would follow a hold).
 */
import type { ReactNode } from "react";
import { Appear, HoldHint, Label, Pressable, RADIUS, TEXT, View, hex } from "../kit/ui";
import { draftCardLook, draftCardShowsHoldHint } from "./draftModel";

interface DraftCardProps {
  /** Position in the row, staggers the entrance animation. */
  index: number;
  accentColor: string;
  selected: boolean;
  onClick: () => void;
  name: string;
  /** Rendered to the right of the name (e.g. an archetype TagChip). A canvas node. */
  headerExtra?: ReactNode;
  /**
   * Large leading glyph, matching the upgrade card's identity block (a canvas
   * node, e.g. `<Icon size={40} />`).
   *
   * The shop's cards lead with a big icon, then the kind, then the name, and
   * that block is most of why they read as cards rather than as list rows.
   */
  icon?: ReactNode;
  /** When set, holding the card opens a detail view instead of selecting it. */
  onLongPress?: () => void;
  children: ReactNode;
}

export function DraftCard({ index, accentColor, selected, onClick, name, headerExtra, icon, onLongPress, children }: DraftCardProps) {
  const accent = hex(accentColor);
  const look = draftCardLook(accent, selected);
  return (
    <Appear fromY={20} delay={0.2 + index * 0.1} layout={{ flex: 1, alignSelf: "stretch" }}>
      <Pressable
        onTap={onClick}
        onHold={onLongPress}
        pressedAlpha={0.85}
        label={name}
        layout={{
          flex: 1, padding: 20, gap: 12, borderRadius: RADIUS.xl,
          backgroundColor: look.background, borderWidth: 2, borderColor: look.border,
        }}
      >
        {/* Three rules, each earned by a way this broke:
            paddingRight 32 - the Info glyph is pinned top-right and the
              header must clear it;
            wrap + a min width on the name - so a long single word never paints
              over the tag chip; the chip drops to its own line instead;
            the extra does not shrink - wrap the name and keep the tag whole. */}
        <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: 12, rowGap: 6, paddingRight: 32 }}>
          {icon}
          <Label
            text={name}
            size={TEXT.xl}
            font="display"
            weight="700"
            color={accent}
            glow={look.glow || undefined}
            lineHeight={Math.round(TEXT.xl * 1.25)}
            wrap
            layout={{ flex: 1, minWidth: 112 }}
          />
          {headerExtra && <View layout={{ flexShrink: 0 }}>{headerExtra}</View>}
        </View>
        {children}
        {draftCardShowsHoldHint(onLongPress) && (
          <View layout={{ position: "absolute", top: 12, right: 12 }} alpha={0.4 / 0.8}>
            <HoldHint color={accent} size={16} />
          </View>
        )}
      </Pressable>
    </Appear>
  );
}

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
        {/* The identity block: glyph, then the name with the extra under it.
            paddingRight 32 - the Info glyph is pinned top-right and the
              header must clear it;
            the name wraps in its own column - a long single word never paints
              over the tag chip;
            the extra keeps its own line under the name and never shrinks -
              wrap the name and keep the tag whole. (The DOM let the chip ride
              beside a short name and wrap below a long one; a wrapping flex
              row whose height depends on wrapped text mis-placed the chip on
              the canvas, so it always takes the line below.) */}
        <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 32 }}>
          {icon}
          <View layout={{ flex: 1, alignItems: "flex-start", gap: 6 }}>
            <Label
              text={name}
              size={TEXT.xl}
              font="display"
              weight="700"
              color={accent}
             
              lineHeight={Math.round(TEXT.xl * 1.25)}
              wrap
            />
            {headerExtra}
          </View>
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

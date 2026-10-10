/**
 * TagChip: the archetype-tag pill used everywhere a build is displayed (canvas
 * port of components/game/TagChip.tsx): shop cards, the build readout, the
 * capstone draft and the end-of-run recap. One source for the tag colour
 * treatment, read from TAG_COLORS (see tagChipModel.ts).
 */
import { useTranslation } from "react-i18next";
import type { UpgradeTag } from "@/types/upgrade";
import { Label, RADIUS, View, tint, type Layout } from "../kit/ui";
import { tagChipLook, tagChipText, textSizeOfClass } from "./tagChipModel";

interface TagChipProps {
  tag: UpgradeTag;
  /** Extra text after the localized tag label (e.g. a count or "2/3"). */
  suffix?: string;
  /** Pill shape + ring, used by the build readout when a set is active. */
  pill?: boolean;
  ringed?: boolean;
  /** Tailwind text-size class; the chip is tiny by default. Read for its px size. */
  sizeClass?: string;
  /** Canvas only: placement in the parent (the DOM span was inline). */
  layout?: Layout;
}

export function TagChip({ tag, suffix, pill = false, ringed = false, sizeClass = "text-[9px]", layout }: TagChipProps) {
  const { t } = useTranslation();
  const look = tagChipLook(tag);
  if (!look) return null;
  const size = textSizeOfClass(sizeClass, 9);
  const px = pill ? 8 : 6;
  return (
    <View layout={{
      paddingLeft: px, paddingRight: px, paddingTop: 1, paddingBottom: 1,
      borderRadius: pill ? RADIUS.full : RADIUS.base,
      backgroundColor: tint(look.background, look.backgroundAlpha),
      // ring-1 ring-current: a 1px ring in the text colour.
      ...(ringed ? { borderWidth: 1, borderColor: look.text } : {}),
      alignSelf: "flex-start",
      ...(layout ?? {}),
    }}>
      <Label text={tagChipText(t, tag, suffix)} size={size} weight="600" upper letterSpacing={size * 0.05} color={look.text} />
    </View>
  );
}

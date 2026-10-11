/**
 * MapRuleBanner - the map is not playing by normal rules, said twice (canvas
 * port of components/game/MapRuleBanner.tsx).
 *
 * Third attempt, and the two failures before it are the design.
 *
 * A chip in the top bar's stats row was first, and was reported straight back:
 * "the technical gravity sign isn't working up there, it has to be clearer,
 * like a warning sign." It was competing with six numbers the player reads
 * constantly, in the same size and weight as all of them, so a rule that
 * changes the physics read as another stat and disappeared.
 *
 * A full-width caution strip was second, and was reported as "too big and you
 * can't see all of it". Both halves of that are true and they have one cause:
 * the strip was doing TWO jobs on one line. The name took the whole row and
 * truncated the description to "Everything is pulled ..." - the clause that
 * actually stops bent trajectories reading as a bug.
 *
 * So it is two states in one place instead:
 *
 *   ANNOUNCE, for the first few seconds of the map. The band above the board is
 *     empty - a square board in a taller frame leaves about 150px there - so the
 *     rule gets a real block: named, and what it does underneath in a sentence
 *     that WRAPS instead of truncating. It can afford to be big because it is
 *     temporary.
 *
 *   REMIND, for the rest of the map. It collapses to a compact hazard chip:
 *     glyph and name, no prose. It can afford to be small because it is no
 *     longer the only signal - which is exactly what the first attempt got wrong.
 *
 * Same position for both, so the player learns where the rule lives. Never over
 * the board: it sits in slack that was empty anyway.
 *
 * Placement is the parent's, through `layout` on the outer box (GameScreen
 * centred the DOM one in the gutter above the board). The outer box takes no
 * touches; only the banner itself is pressable. Its children are centred, so a
 * parent that gives it the gutter's full width and height centres it there
 * whichever state it is in. Give it a definite width: the announcing sentence
 * wraps to it.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { MAP_RULE_VIOLET } from "@/components/game/mapRuleTheme";
import type { ActiveMapMutator } from "@/types/mapMutator";
import { Appear, Icon, Label, Pressable, RADIUS, View, hex, tint, useUiScreen, type Layout } from "../kit/ui";
import { ANNOUNCE_MS, mapRuleText } from "./mapRuleModel";

interface MapRuleBannerProps {
  /** The map's mutator. Nothing renders without one, which is most maps. */
  mutator?: ActiveMapMutator | null;
  /** Opens the Specs panel, which carries the full explanation. */
  onExplain?: () => void;
  /** Canvas only: where the parent puts the banner's box. */
  layout?: Layout;
}

const VIOLET = hex(MAP_RULE_VIOLET);
/** The description's soft lilac (the DOM's #d9c9ff). */
const DETAIL = 0xd9c9ff;
/** framer-motion `layout` transition between the two states. */
const MORPH_S = 0.35;
/** Tailwind's `sm` breakpoint: the announcement steps up a size from here. */
const SM = 640;

export function MapRuleBanner({ mutator, onExplain, layout }: MapRuleBannerProps) {
  const { t } = useTranslation();
  const [announcing, setAnnouncing] = useState(true);
  const wide = useUiScreen().width >= SM;

  // Keyed on the mutator, so a new map announces its rule again rather than
  // inheriting the previous map's collapsed chip.
  useEffect(() => {
    if (!mutator) return;
    setAnnouncing(true);
    const timer = setTimeout(() => setAnnouncing(false), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mutator]);

  const text = mapRuleText(t, mutator, announcing);
  if (!text) return null;

  return (
    <View layout={{ alignItems: "center", justifyContent: "center", ...(layout ?? {}) }}>
      {/* Remounted per state, so each one fades in where the DOM morphed the
          box between sizes (a layout animation the canvas has no equivalent
          of). Both are centred in the same box, so the chip appears exactly
          where the block was. */}
      <Appear
        key={announcing ? "announce" : "remind"}
        duration={MORPH_S}
        layout={{ alignSelf: announcing ? "stretch" : "center" }}
      >
        {announcing ? (
          // Announcing spans the frame, so a hazard rule top and bottom rather
          // than a box, which would read as a second top bar. (The DOM's
          // fade-out-at-the-edges gradient is its dominant colour here.)
          <Pressable onTap={onExplain} label={text.ariaLabel} layout={{ backgroundColor: tint(VIOLET, 0x1f / 255) }}>
            <View layout={{ height: 1, backgroundColor: tint(VIOLET, 0x55 / 255) }} />
            <View layout={{ alignItems: "center", gap: 4, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
              <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon icon={TriangleAlert} size={20} color={VIOLET} />
                <Label text={text.name} font="display" size={wide ? 18 : 16} weight="900" upper letterSpacing={wide ? 1.8 : 1.6} color={VIOLET} glow={14} />
              </View>
              {/* WRAPPING rather than truncating: what it does is the clause
                  that stops bent trajectories reading as a bug. */}
              {text.detail && (
                <Label text={text.detail} wrap align="center" size={wide ? 14 : 12} weight="600" lineHeight={wide ? 19 : 17} color={DETAIL} alpha={0.9} />
              )}
            </View>
            <View layout={{ height: 1, backgroundColor: tint(VIOLET, 0x55 / 255) }} />
          </Pressable>
        ) : (
          // The chip is a bordered pill: it has to look like an object, not a heading.
          <Pressable onTap={onExplain} label={text.ariaLabel} layout={{
            flexDirection: "row", alignItems: "center", gap: 8,
            paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
            borderRadius: RADIUS.full, borderWidth: 1,
            borderColor: tint(VIOLET, 0x77 / 255), backgroundColor: tint(VIOLET, 0x22 / 255),
          }}>
            <Icon icon={TriangleAlert} size={14} color={VIOLET} />
            <Label text={text.name} font="display" size={11} weight="700" upper letterSpacing={0.55} color={VIOLET} />
          </Pressable>
        )}
      </Appear>
    </View>
  );
}

/** What the map-rule banner says, in each of its two states (canvas MapRuleBanner). */
import type { TFunction } from "i18next";
import { contentText } from "@/i18n/content";
import type { ActiveMapMutator } from "@/types/mapMutator";

/**
 * How long the rule is announced before it collapses to the chip.
 *
 * Long enough to read a short sentence twice at a glance, short enough that it
 * is gone before the board gets busy. It is not a modal and costs no tap, so
 * erring long is cheap; erring short means the player never read it, which is
 * the whole defect.
 */
export const ANNOUNCE_MS = 5000;

export interface MapRuleText {
  name: string;
  /** The sentence saying what the rule DOES; null once collapsed or when there is none. */
  detail: string | null;
  /** Named for a reader who cannot see the colour. */
  ariaLabel: string;
}

/** Null on an ordinary map: most maps have no mutator, and then nothing renders. */
export function mapRuleText(t: TFunction, mutator: ActiveMapMutator | null | undefined, announcing: boolean): MapRuleText | null {
  if (!mutator) return null;
  const name = contentText.mutatorName(t, mutator);
  const detail = contentText.mutatorDesc(t, mutator);
  return {
    name,
    // Only while announcing, and never truncated: a version ending in an
    // ellipsis says there was an explanation and withholds it.
    detail: announcing && detail ? detail : null,
    ariaLabel: t("topBar.mutatorTitle", { name }),
  };
}

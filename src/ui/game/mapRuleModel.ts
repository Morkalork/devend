/** What the map-rule banner says, in each of its two states (canvas MapRuleBanner). */
import type { TFunction } from "i18next";
import { contentText } from "@/i18n/content";
import type { ActiveMapMutator } from "@/types/mapMutator";
import type { Contract } from "@/lib/contracts";

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

/**
 * Null on an ordinary map: most maps have no mutator and no contract, and then
 * nothing renders.
 *
 * A CONTRACT (lib/contracts.ts, the draft's elite map) is a rule too, taken in
 * the store for this one map, and it used to be named nowhere but there. It
 * takes the same banner: alone it is the whole text, and beside a mutator it
 * is the second line of the announcement and the second name on the chip, so
 * the board says every rule it is playing by in one place.
 */
export function mapRuleText(
  t: TFunction, mutator: ActiveMapMutator | null | undefined, announcing: boolean,
  contract?: Contract | null,
): MapRuleText | null {
  if (!mutator && !contract) return null;
  const contractName = contract ? contentText.contractName(t, contract) : null;
  const contractDetail = contract ? contentText.contractDesc(t, contract) : null;
  if (!mutator) {
    return {
      name: contractName!,
      detail: announcing && contractDetail ? contractDetail : null,
      ariaLabel: t("cardDraft.contractTitle", { name: contractName }),
    };
  }
  const name = contentText.mutatorName(t, mutator);
  const detail = contentText.mutatorDesc(t, mutator);
  const both = contractName ? `${name} + ${contractName}` : name;
  const bothDetail = [detail, contractDetail && contractName ? `${contractName}: ${contractDetail}` : null]
    .filter((d): d is string => !!d).join(" ");
  return {
    name: both,
    // Only while announcing, and never truncated: a version ending in an
    // ellipsis says there was an explanation and withholds it.
    detail: announcing && bothDetail ? bothDetail : null,
    ariaLabel: t("topBar.mutatorTitle", { name: both }),
  };
}

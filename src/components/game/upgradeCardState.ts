/**
 * How an upgrade card is drawn, by state.
 *
 * Pulled out of UpgradeShop for one reason: the states are mutually exclusive
 * and there are six of them, so "selected" and "unaffordable" and "owned" were
 * decided inside a nested ternary in the middle of a className template, where
 * the only way to check that two of them look different is to run the game and
 * look at it. That is how the selected state ended up as a thin white ring on
 * an otherwise unchanged card: nothing was wrong with any single branch, they
 * were just too close together to tell apart.
 */

/** The class string for each mutually exclusive card state. */
export const UPGRADE_CARD_STATE_CLASSES = {
  /**
   * Chosen, not yet paid for. Tinted ground, solid border, outward glow and a
   * small lift - the same three-part treatment DraftCard uses on the drafting
   * screens, so the shop and the drafts read as one system.
   */
  selected:
    'bg-primary/20 border-primary ring-2 ring-primary/60 ring-offset-2 ring-offset-black ' +
    'shadow-[0_0_24px_hsl(var(--primary)/0.45)] -translate-y-0.5',
  /** Already bought, in an earlier visit or this one. */
  owned: 'bg-green-500/20 border-green-500/50',
  /** Prerequisites unmet: present, but not yet a choice. */
  locked: 'bg-muted/30 border-muted/30 opacity-40 cursor-not-allowed',
  /** Affordable and available: the ordinary card. */
  purchasable: 'bg-card border-current hover:border-primary cursor-pointer',
  /** Affordable in principle, but not with what is left in the budget. */
  cantAfford: 'bg-card/50 border-muted-foreground/30 opacity-60 cursor-pointer',
  /** Out of reach entirely (store closed, or over the run's total). */
  unavailable: 'bg-card/50 border-muted cursor-not-allowed opacity-40',
} as const;

/**
 * The store's ability slot, drawn INVERTED.
 *
 * Every upgrade card is a dark ground carrying light text. An ability retainer
 * is a different kind of object - it is not an upgrade, it does not carry tags,
 * it is not priced on the same curve - and it sits in the same strip as three
 * things that are. Tinting it would say "an upgrade, but purple"; flipping the
 * ground to light with dark text says "not one of these" from across the room,
 * before a single word is read.
 *
 * Selection and refusal still have to read on it, so the states below invert
 * with it rather than falling back to the dark set: a selected retainer keeps
 * its light ground and gains the ring, and an unaffordable one dims without
 * turning back into an upgrade.
 */
export const ABILITY_CARD_STATE_CLASSES = {
  selected:
    'bg-foreground text-background border-primary ring-2 ring-primary/70 ring-offset-2 ring-offset-black ' +
    'shadow-[0_0_28px_hsl(var(--primary)/0.5)] -translate-y-0.5',
  owned: 'bg-foreground/80 text-background border-green-600',
  purchasable: 'bg-foreground text-background border-foreground hover:border-primary cursor-pointer',
  cantAfford: 'bg-foreground/60 text-background border-foreground/40 opacity-70 cursor-pointer',
  unavailable: 'bg-foreground/40 text-background border-foreground/30 cursor-not-allowed opacity-50',
} as const;

export interface UpgradeCardState {
  selected?: boolean;
  owned?: boolean;
  locked?: boolean;
  purchasable?: boolean;
  cantAfford?: boolean;
}

/**
 * The state classes for one card.
 *
 * SELECTED wins over everything. It used to be applied alongside the other
 * states rather than instead of them, which meant an unaffordable card you had
 * selected kept its dashed "no" border while also wearing the selected ring:
 * the strongest yes and the strongest no drawn on the same card.
 *
 * `tierBorder` is the per-tier border colour used only by the ordinary
 * purchasable card; every other state supplies its own.
 */
/**
 * The state classes for one card, in whichever palette it belongs to.
 *
 * `inverted` picks the ability-slot set. It is a parameter rather than a second
 * exported function because the ORDER of the state checks is the thing that
 * must not drift between the two: selected beating owned beating unaffordable
 * is a rule about the shop, not about a palette.
 */
export function selectedCardClasses(
  state: UpgradeCardState,
  tierBorder = 'border-current',
  inverted = false,
): string {
  if (inverted) {
    if (state.selected) return ABILITY_CARD_STATE_CLASSES.selected;
    if (state.owned) return ABILITY_CARD_STATE_CLASSES.owned;
    if (state.purchasable) return ABILITY_CARD_STATE_CLASSES.purchasable;
    if (state.cantAfford) return ABILITY_CARD_STATE_CLASSES.cantAfford;
    return ABILITY_CARD_STATE_CLASSES.unavailable;
  }
  if (state.selected) return UPGRADE_CARD_STATE_CLASSES.selected;
  if (state.owned) return UPGRADE_CARD_STATE_CLASSES.owned;
  if (state.locked) return UPGRADE_CARD_STATE_CLASSES.locked;
  if (state.purchasable) {
    return UPGRADE_CARD_STATE_CLASSES.purchasable.replace('border-current', tierBorder);
  }
  if (state.cantAfford) return UPGRADE_CARD_STATE_CLASSES.cantAfford;
  return UPGRADE_CARD_STATE_CLASSES.unavailable;
}

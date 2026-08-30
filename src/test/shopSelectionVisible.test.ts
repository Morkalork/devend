/**
 * A selected shop item has to look selected.
 *
 * Reported as "it should be more visible when a store item is selected". The
 * cue was a thin white ring and nothing else - the card kept its ordinary
 * background and border, so on a phone, in a horizontal strip with a
 * neighbouring card half in frame, "chosen" and "not chosen" differed by two
 * pixels of outline. The tick in the corner was a bare glyph that vanished
 * against a bright tier icon.
 *
 * These assert the DIFFERENCE between a selected and an unselected card rather
 * than any particular class, because the point is contrast, not a palette: a
 * restyle that keeps the two states distinct should keep passing, and one that
 * quietly makes them similar again should not. That is the failure being
 * guarded, and it is the one a screenshot review misses when only one card is
 * on screen.
 */
import { describe, it, expect } from "vitest";
import { UPGRADE_CARD_STATE_CLASSES, selectedCardClasses } from "@/components/game/upgradeCardState";

describe("the selected state is more than an outline", () => {
  const selected = selectedCardClasses({ selected: true });
  const plain = selectedCardClasses({ selected: false, purchasable: true });

  it("changes the card's ground, not just its edge", () => {
    // The whole complaint: an unchanged background is what made two cards look
    // alike from half a metre away.
    expect(selected).toMatch(/bg-primary/);
    expect(plain, "an unselected card already looks selected").not.toMatch(/bg-primary\//);
  });

  it("carries a solid border, a ring and a glow", () => {
    expect(selected).toMatch(/border-primary/);
    expect(selected).toMatch(/ring-2/);
    expect(selected).toMatch(/shadow-\[/);
  });

  it("never draws a selected card with a dashed border", () => {
    // An unaffordable card is dashed. Selecting one used to keep the dashes, so
    // the strongest "no" and the strongest "yes" were drawn on the same card.
    expect(selectedCardClasses({ selected: true, cantAfford: true }))
      .not.toMatch(/border-dashed/);
  });

  it("is visibly different from the OWNED state", () => {
    // Owned is green-tinted too. If selecting looked the same as owning, a
    // player could not tell what this shop visit is about to charge them for.
    const owned = selectedCardClasses({ selected: false, owned: true });
    expect(owned).not.toEqual(selected);
    expect(owned).toMatch(/green/);
  });

  it("gives every other card state a distinct look", () => {
    const states = Object.values(UPGRADE_CARD_STATE_CLASSES);
    expect(new Set(states).size, "two card states are drawn identically").toBe(states.length);
  });
});

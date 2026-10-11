/**
 * A detail modal can never lose text off the top and bottom of the screen
 * (carried over from modalOverflow.test.tsx, which scanned the DOM modals'
 * class names).
 *
 * The defect: a card with no height limit, centred in a full-screen overlay
 * that does not scroll. A card taller than the screen overflows out of BOTH
 * ends and neither end can be reached. The fix is one contract with three
 * parts: the card is bounded by the screen, its body scrolls, and the close
 * button sits outside that scroller so it cannot scroll away from a long entry.
 *
 * On the canvas the hold-to-explain modals share one card (InfoCardModal), so
 * the contract is checked there and the explainers are held to using it; the
 * board-entity card has its own, checked in canvas/BoardEntityInfoModal.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the shared explainer card", () => {
  const src = read("src/ui/game/modalParts.tsx");
  const card = src.slice(src.indexOf("export function InfoCardModal"));

  it("is bounded by the screen", () => {
    expect(card).toMatch(/maxHeight: screen\.height - 32/);
  });

  it("has a body that scrolls", () => {
    expect(card).toMatch(/<ScrollView layout=\{\{ flexShrink: 1 \}\}>/);
  });

  it("keeps the close button out of the scrolling area", () => {
    const close = card.indexOf('label="close"');
    const scroller = card.indexOf("<ScrollView");
    expect(close, "no close button").toBeGreaterThan(0);
    expect(scroller, "no scrolling body").toBeGreaterThan(0);
    expect(close, "the close button scrolls with the text").toBeLessThan(scroller);
  });
});

describe("the hold-to-explain modals", () => {
  it.each(["SuperiorLockInfoModal", "FenceTypeInfoModal", "AbilityInfoModal"])(
    "%s draws through the shared card rather than a copy of it", name => {
      expect(read(`src/ui/game/${name}.tsx`)).toMatch(/<InfoCardModal\b/);
    },
  );
});

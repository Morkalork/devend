/**
 * A detail modal can never lose text off the top and bottom of the screen.
 *
 * Reported against the Promotion and Assignment screens: boxes get cut off when
 * they contain too much text. The cause is a shape that had been copy-pasted
 * into twelve places - a `fixed inset-0` overlay with `items-center`, holding a
 * card with no height limit. When the card is taller than the viewport it
 * overflows out of BOTH ends, and neither end can be reached: the overlay is
 * fixed so it does not scroll, and the card has no scroller of its own. The
 * text is not merely off-screen, it is unreachable.
 *
 * The fix bounds the card at the overlay's padding box and gives it a scrolling
 * body, with the close button left outside that scroller so it cannot scroll
 * away from a long entry.
 *
 * This is checked against the SOURCE as well as the DOM, which needs saying.
 * jsdom performs no layout - every height it reports is zero - so a rendered
 * test cannot observe clipping at all. What can be checked is the contract that
 * prevents it, and the reason to check it across the source is that the defect
 * spread by copy-paste in the first place: the next modal will be pasted from
 * one of these twelve, and if that copy drops the bound, this fails.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import "@/i18n";
import { BoardEntityInfoModal } from "@/components/game/BoardEntityInfoModal";
import type { BoardEntityHit } from "@/lib/boardEntityInfo";

afterEach(cleanup);

/** Every component source in the app. */
function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) out.push({ file: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(resolve(process.cwd(), "src/components"));
  return out;
}

/** The copy-pasted detail-card shape, wherever it appears. */
const CARD = /className="([^"]*\bborder-2 bg-card\b[^"]*)"/g;

describe("the detail-card shape, everywhere it was pasted", () => {
  it("is used in more than one place, or this guard is pointless", () => {
    // If the cards are ever consolidated into one shared component this drops
    // to 1, and that is a better world - but the assertion below would then be
    // guarding almost nothing, so it should be noticed rather than left green.
    const count = sources().reduce(
      (n, s) => n + [...s.text.matchAll(CARD)].length, 0);
    expect(count).toBeGreaterThan(1);
  });

  it("always declares a height bound", () => {
    // Without this the card grows past the viewport inside a fixed, centered
    // overlay, and the overflow goes somewhere no scroll can reach.
    const unbounded: string[] = [];
    for (const { file, text } of sources()) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(CARD)) {
          if (!/\bmax-h-/.test(m[1])) unbounded.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(unbounded, "modal cards with no height bound").toEqual([]);
  });

  it("always has something inside it that scrolls", () => {
    // A bound alone would only turn unreachable text into clipped text. The
    // bound and the scroller are one fix and neither half is any use alone.
    const noScroller: string[] = [];
    for (const { file, text } of sources()) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (![...line.matchAll(CARD)].length) return;
        // The scroller is the card's body, a few lines below the open tag.
        const window = lines.slice(i, i + 20).join("\n");
        if (!/overflow-y-(auto|scroll)/.test(window)) noScroller.push(`${file}:${i + 1}`);
      });
    }
    expect(noScroller, "bounded modal cards with nothing scrollable inside").toEqual([]);
  });

  it("keeps the close button out of the scrolling area", () => {
    // The button is absolutely positioned against the card. Were it inside the
    // scroller it would position against the SCROLLED content and slide off the
    // top of a long entry, leaving the reader with no visible way out.
    const buried: string[] = [];
    for (const { file, text } of sources()) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (![...line.matchAll(CARD)].length) return;
        const window = lines.slice(i, i + 20);
        const scroller = window.findIndex(l => /overflow-y-(auto|scroll)/.test(l));
        const closeBtn = window.findIndex(l => /absolute top-2 right-2/.test(l));
        if (scroller >= 0 && closeBtn >= 0 && closeBtn > scroller) {
          buried.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(buried, "close buttons that scroll away with the content").toEqual([]);
  });
});

describe("a detail modal as actually rendered", () => {
  const hit = { kind: "wall" } as unknown as BoardEntityHit;

  it("puts the bound and the scroller in the real DOM", () => {
    // The source scan above proves the classes are WRITTEN. This proves they
    // survive into the tree, so a refactor that stops passing className through
    // does not leave the scan passing over a modal that clips again.
    const { container } = render(<BoardEntityInfoModal hit={hit} onClose={() => {}} />);
    const card = container.querySelector(".border-2.bg-card");
    expect(card, "no detail card rendered").toBeTruthy();
    expect(card!.className).toMatch(/max-h-/);
    expect(card!.querySelector(".overflow-y-auto"), "no scrolling body").toBeTruthy();
  });

  it("leaves the close button outside the scrolling body", () => {
    const { container } = render(<BoardEntityInfoModal hit={hit} onClose={() => {}} />);
    const scroller = container.querySelector(".overflow-y-auto")!;
    const closer = container.querySelector("button[aria-label]");
    expect(closer, "no close button").toBeTruthy();
    expect(scroller.contains(closer!), "the close button scrolls with the text").toBe(false);
  });
});

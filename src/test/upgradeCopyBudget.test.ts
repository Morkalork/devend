/**
 * How much an upgrade card is allowed to say.
 *
 * Testers reported the shop as too much text. Half of that was layout (five
 * cards at once, fixed by the strip in Carousel.tsx) and half was copy: the
 * longest description ran 180 characters, and descriptions had been growing one
 * clause at a time as upgrades gained synergy scaling. Nobody wrote a long one
 * on purpose; each author added a sentence to a description that was already
 * fine, which is exactly how this comes back.
 *
 * So the budget is a RULE, not a preference, and it is derived rather than
 * chosen: the card is 340px wide with 20px of padding either side, so about
 * 300px of text. The description is set at 18px (raised from 16px on the same
 * readability feedback that produced this file), which is roughly 33 characters
 * a line, so 100 characters is about three lines. That is the number.
 *
 * Note which way that trade runs. Bigger type spends the same budget on FEWER
 * lines, so the next increase in font size has to come with a smaller character
 * count rather than on its own. 100 at 18px is where the two currently balance.
 *
 * Translations get more room because they legitimately need it: Spanish and
 * Swedish run 10-20% longer than English for the same content, and squeezing a
 * translator to an English character count produces worse Spanish, not a
 * shorter card.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "../..");

/** Chars that fit in just under three lines of the card's description. */
const ENGLISH_BUDGET = 100;
/** Same three lines, with the headroom other languages actually need. */
const TRANSLATION_BUDGET = 120;

interface Upgrade { id: string; name?: string; description?: string }

const upgrades = (yaml.load(
  fs.readFileSync(path.join(ROOT, "public/upgrades.yml"), "utf8"),
) as { upgrades: Upgrade[] }).upgrades;

describe("what an upgrade card is allowed to say", () => {
  it("keeps every description inside the card", () => {
    // The whole point of the bigger card is that its text is readable. Spending
    // that width back on more words is a straight trade away from the fix.
    const over = upgrades
      .filter(u => (u.description ?? "").length > ENGLISH_BUDGET)
      .map(u => `${u.id} (${u.description!.length})`);
    expect(over, `over the ${ENGLISH_BUDGET}-character budget`).toEqual([]);
  });

  it("gives every upgrade a description at all", () => {
    // A blank card is not a short card.
    expect(upgrades.filter(u => !(u.description ?? "").trim()).map(u => u.id)).toEqual([]);
  });

  for (const lang of ["es", "sv"] as const) {
    it(`keeps the ${lang} translations inside the card too`, () => {
      // A budget that only binds English ships the fix to English players only.
      const locale = JSON.parse(
        fs.readFileSync(path.join(ROOT, `src/i18n/locales/${lang}.json`), "utf8"),
      ) as { content?: { upgrades?: Record<string, { description?: string }> } };
      const entries = Object.entries(locale.content?.upgrades ?? {});
      const over = entries
        .filter(([, v]) => (v.description ?? "").length > TRANSLATION_BUDGET)
        .map(([id, v]) => `${id} (${v.description!.length})`);
      expect(over, `over the ${TRANSLATION_BUDGET}-character budget`).toEqual([]);
    });
  }
});

/**
 * How much the game is allowed to say.
 *
 * Testers reported the shop as too much text, and later that there was too much
 * to read in the game generally. Half of the first was layout (five cards at
 * once, fixed by the strip in Carousel.tsx) and half was copy: descriptions had
 * been growing one clause at a time as content gained synergy scaling. Nobody
 * wrote a long one on purpose; each author added a sentence to a description
 * that was already fine, which is exactly how this comes back.
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
 * TWO budgets, because a ceiling alone does not control how much there is to
 * read. A hundred and eighteen upgrades all sitting at 99 characters would pass
 * a ceiling and still be a wall, and the complaint was about the wall rather
 * than about any one card. So each surface also has an AVERAGE it has to come
 * in under, which is the number that actually moves when copy creeps.
 *
 * The averages below sit about 7% above where the content is today. That
 * margin is deliberate and it was measured, not guessed: at a looser setting
 * this guard let four certificates have their duplicated provenance restored
 * without noticing, which is precisely the regression it exists to catch.
 * Adding one wordy description is fine, adding four is not.
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

interface Described { id: string; name?: string; description?: string }

/** Every list of player-facing descriptions the game reads at runtime. */
function load(file: string, key: string): Described[] {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, `public/${file}`), "utf8"));
  return (doc as Record<string, Described[]>)[key];
}

const upgrades = load("upgrades.yml", "upgrades");

/**
 * Per-surface average budgets, set just above where each sits today.
 *
 * Certificates are the tightest because they were the worst: eight of the
 * eighteen ended in "a reward for mastering <upgrade>", repeating the unlock
 * line the store already renders directly above the description from
 * sourceUpgradeId. Cutting duplicated provenance took that surface down 53%
 * without losing a single rule, which is why its average sits so much lower
 * than the others rather than being held to the same number.
 */
const SURFACES: { name: string; file: string; key: string; avg: number }[] = [
  { name: "upgrades",     file: "upgrades.yml",     key: "upgrades",     avg: 63 },
  { name: "balls",        file: "balls.yml",        key: "balls",        avg: 72 },
  { name: "certificates", file: "certificates.yml", key: "certificates", avg: 45 },
  { name: "abilities",    file: "abilities.yml",    key: "abilities",    avg: 66 },
];

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

describe("how much there is to read across a surface", () => {
  for (const s of SURFACES) {
    it(`keeps ${s.name} inside the per-card ceiling`, () => {
      const over = load(s.file, s.key)
        .filter(x => (x.description ?? "").length > ENGLISH_BUDGET)
        .map(x => `${x.id} (${x.description!.length})`);
      expect(over, `over the ${ENGLISH_BUDGET}-character ceiling`).toEqual([]);
    });

    it(`keeps the average ${s.name} description short`, () => {
      // The ratchet. A ceiling passes a surface where every entry is at 99;
      // this is what notices copy creeping back across the whole file.
      const lens = load(s.file, s.key)
        .map(x => (x.description ?? "").length).filter(n => n > 0);
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      expect(avg, `${s.name} averages ${avg.toFixed(1)} chars`).toBeLessThanOrEqual(s.avg);
    });

    it(`gives every ${s.name} entry a description at all`, () => {
      // A blank card is not a short card, and an average is trivially gamed by
      // deleting descriptions rather than tightening them.
      expect(load(s.file, s.key).filter(x => !(x.description ?? "").trim()).map(x => x.id))
        .toEqual([]);
    });
  }
});

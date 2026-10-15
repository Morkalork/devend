/**
 * Bangla (bn): a complete locale, and a face that can draw it.
 *
 * The locale is checked against English key for key, so a string added later
 * without its Bangla fails here the same way it would for Spanish or Swedish
 * in the per-feature tests. The font half exists because none of the bundled
 * Latin faces has a single Bengali glyph, and canvas text is rasterised once:
 * without its own face loaded first, Bangla is drawn in whatever the device
 * falls back to, or as boxes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import bn from "@/i18n/locales/bn.json";
import i18n, { languageNames, supportedLanguages } from "@/i18n";
import { FONT } from "@/ui/theme";

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [[prefix + k, v] as [string, string]] : leaves(v, `${prefix}${k}.`));
}

const EN = new Map(leaves(en as Tree));
const BN = new Map(leaves(bn as Tree));
const PLACEHOLDER = /\{\{[^}]+\}\}|\{n\}/g;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the Bangla locale", () => {
  it("is offered in the language picker, under its own name", () => {
    expect(supportedLanguages).toContain("bn");
    expect(languageNames.bn).toBe("বাংলা");
  });

  it("has every string English has", () => {
    const missing = [...EN.keys()].filter(k => !BN.has(k));
    expect(missing).toEqual([]);
  });

  it("keeps every placeholder the game fills in", () => {
    const broken = [...EN].filter(([k, v]) => {
      const want = (v.match(PLACEHOLDER) ?? []).sort().join();
      const got = (BN.get(k)?.match(PLACEHOLDER) ?? []).sort().join();
      return want !== got;
    }).map(([k]) => k);
    expect(broken).toEqual([]);
  });

  it("is written in Bengali, not left in English", () => {
    // A string with real words in it must have Bengali letters in its Bangla.
    // Symbols, units and number patterns ("{{hours}}h", "x{{n}}") are fine as is.
    const untranslated = [...EN].filter(([k, v]) =>
      /[A-Za-z]{3,}/.test(v.replace(PLACEHOLDER, "")) && !/[ঀ-৿]/.test(BN.get(k) ?? ""))
      .map(([k]) => k);
    expect(untranslated).toEqual([]);
  });

  it("uses no em-dash and no stray Devanagari", () => {
    for (const [k, v] of BN) {
      expect(v, k).not.toContain("—");
      // The danda (U+0964/0965) is shared with Devanagari and is Bengali punctuation too.
      expect(/[ऀ-ॣ०-ॿ]/.test(v), k).toBe(false);
    }
  });

  it("resolves through i18next, including its plural rules", () => {
    const t = i18n.getFixedT("bn");
    expect(t("welcome.startGame")).toMatch(/[ঀ-৿]/);
    expect(t("upgradeConditions.ballsAtLeast", { count: 1 })).not.toBe(t("upgradeConditions.ballsAtLeast", { count: 3 }));
  });

  it("translates the YAML content the cards show", () => {
    const t = i18n.getFixedT("bn");
    expect(t("content.upgrades.runtime_optimisation_junior.name")).toMatch(/[ঀ-৿]/);
    expect(t("content.offers.reliability.description")).toMatch(/[ঀ-৿]/);
    expect(t("content.tiers.Junior")).toMatch(/[ঀ-৿]/);
  });
});

describe("a face that can draw it", () => {
  it("ships Noto Sans Bengali for every weight the interface uses, limited to Bengali", () => {
    const css = read("src/index.css");
    for (const w of [400, 500, 600, 700]) {
      expect(css).toContain(`/assets/fonts/NotoSansBengali-${w}.woff2`);
    }
    expect(css).toMatch(/font-family: 'Noto Sans Bengali';[\s\S]*?unicode-range: U\+0951-0952, U\+0964-0965, U\+0980-09FE/);
  });

  it("names it in every interface font stack, before the generic family", () => {
    for (const [role, stack] of Object.entries(FONT)) {
      expect(stack, role).toMatch(/'Noto Sans Bengali', (sans-serif|monospace)$/);
    }
  });

  it("loads it before Bangla is first drawn, at startup and on a switch", () => {
    const fonts = read("src/ui/fonts.ts");
    expect(fonts).toMatch(/language === "bn" \? \[loadBengaliFonts\(\)\]/);
    expect(fonts).toMatch(/setScriptFontLoader\(lang => \(lang === "bn" \? loadBengaliFonts\(\)/);
    expect(read("src/ui/UiHost.tsx")).toMatch(/loadUiFonts\(i18n\.language\)/);
    expect(read("src/i18n/index.ts")).toMatch(/if \(scriptFontLoader\) await scriptFontLoader\(lang\)/);
  });
});

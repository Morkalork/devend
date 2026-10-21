/**
 * Only English ships in the main bundle; every other language is fetched when
 * it is first needed (src/i18n/index.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n, { loadLanguage, supportedLanguages } from "@/i18n";

const src = readFileSync("src/i18n/index.ts", "utf8");

describe("the locales", () => {
  it("bundle English alone; the rest are separate chunks", () => {
    const staticImports = [...src.matchAll(/^import \w+ from '\.\/locales\/(\w+)\.json';$/gm)].map(m => m[1]);
    expect(staticImports).toEqual(["en"]);
    expect(src).toContain("import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*.json', '!./locales/en.json'])");
  });

  it("fetch a language before switching to it, and before the app first renders", () => {
    expect(src).toMatch(/await loadLanguage\(lang\);\s*if \(scriptFontLoader\)/);
    expect(readFileSync("src/main.tsx", "utf8")).toMatch(/i18nReady\.finally\(\(\) => \{\s*createRoot/);
  });

  it("load every supported language", async () => {
    for (const lang of supportedLanguages) {
      await loadLanguage(lang);
      expect(i18n.hasResourceBundle(lang, "translation"), lang).toBe(true);
    }
    expect(i18n.getFixedT("sv")("welcome.startGame")).not.toBe(i18n.getFixedT("en")("welcome.startGame"));
  });
});

describe("the rest of the main bundle", () => {
  it("leaves the game screen to its own chunk, fetched while the menu is idle", () => {
    const index = readFileSync("src/pages/Index.tsx", "utf8");
    expect(index).not.toMatch(/^import \{ GameScreen \} from/m);
    expect(index).toContain("const loadGameScreen = () => import('@/components/game/GameScreen');");
    expect(index).toContain("const fetch = () => { void loadGameScreen(); };");
  });

  it("fetches posthog-js only when a key is set", () => {
    const analytics = readFileSync("src/lib/analytics.ts", "utf8");
    expect(analytics).not.toMatch(/^import posthog from/m);
    expect(analytics).toMatch(/if \(!key \|\| \(import\.meta\.env\.DEV && !devOptIn\)\) return;\s*import\('posthog-js'\)/);
  });
});

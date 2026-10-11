/**
 * The way out of a push on the canvas (src/ui/game/PushExitBar.tsx), carried
 * over from pushExitBar.test.tsx.
 *
 * The exit that came before it was real, wired and drawn - and was reported as
 * missing, because it was a 10%-opacity outline strip between the ability bar
 * and the countdowns. So these check what made it invisible: that it is filled
 * rather than ghosted, and that it carries the number that makes the decision
 * worth making. A render needs a canvas, so the bar is read at its source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { pushBonusEarned } from "@/lib/pushLuck";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SRC = read("src/ui/game/PushExitBar.tsx");
const t = i18n.getFixedT("en");

describe("the way out of a push", () => {
  it("is a button the player can press, and it banks", () => {
    expect(SRC).toMatch(/<Pressable\s+label=\{label\}\s+onTap=\{onBank\}/);
  });

  it("is filled with the accent rather than ghosted over it", () => {
    // THE reason the old one was missed.
    expect(SRC).toMatch(/const accent = hex\(accentColor\);/);
    expect(SRC).toMatch(/backgroundColor: accent,/);
    // Dark ink on a bright accent: light text on it disappears outdoors.
    expect(SRC).toMatch(/const INK = 0x04140b;/);
    expect(SRC).toMatch(/<Label text=\{label\} size=\{TEXT\.base\} weight="700" color=\{INK\} \/>/);
  });

  it("names the action whatever the bonus", () => {
    expect(SRC).toContain('const label = t("pushYourLuck.bankAndContinue");');
    expect(t("pushYourLuck.bankAndContinue").trim().length).toBeGreaterThan(0);
  });

  it("says how many hours stopping now would bank", () => {
    expect(SRC).toContain('t("pushYourLuck.bankedSoFar", { hours: bonusSoFar })');
    expect(t("pushYourLuck.bankedSoFar", { hours: 3 })).toMatch(/\+3h/);
  });

  it("says nothing about hours before a chunk is complete", () => {
    // "+0h" reads as "this button pays nothing", which is the opposite of the
    // truth: the map's own score was already safe before the push began.
    expect(SRC).toMatch(/\{bonusSoFar > 0 && \(\s*<Label text=\{t\("pushYourLuck\.bankedSoFar"/);
  });

  it("shows the same number the payout will actually pay", () => {
    // The bar does no arithmetic of its own: the game hands it the figure from
    // pushBonusEarned, the function the results screen pays out through.
    expect(SRC).not.toMatch(/pushBonusEarned|Math\./);
    expect(read("src/components/game/GameCanvas.tsx"))
      .toMatch(/const pushBonusSoFar = pushMode === "pushing"\s*\?\s*pushBonusEarned\(/);
    expect(read("src/components/game/GameScreen.tsx")).toContain("bonusSoFar={gameState.pushBonusSoFar}");
    // 40% left at the prompt, 15% left now: two whole chunks of ten.
    expect(pushBonusEarned(40, 15, 1)).toBe(2);
  });
});

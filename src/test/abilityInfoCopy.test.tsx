/**
 * What the ability explainer says, and the one thing it stopped saying.
 *
 * Reported from the Slow All card: it "refers to the old way of obtaining it".
 * The footer under every ability read "smash a box to drop this, then tap the
 * gem within 2 seconds to grab it. Miss it and it is gone", and it was wrong
 * twice over.
 *
 *   THE DEADLINE IS GONE. chests.ts says it outright: LOOT_TTL_SECONDS "used to
 *   be a deadline ... It is now purely how long the receipt stays up - the
 *   reward is banked the moment the chest breaks". So the sentence told players
 *   to hurry for something already theirs, and that missing it cost them the
 *   ability. Both false, and the second is the kind of false that makes someone
 *   play worse.
 *
 *   A CHEST IS NOT THE ONLY SOURCE. The store's ability slot sells a retainer,
 *   and level 10 grants Shockwave for good.
 *
 * It is deleted rather than corrected, because the modal opens off an ability
 * the player is ALREADY HOLDING: "how do you get one" is the one question the
 * situation has answered for itself.
 *
 * The rest of these check the claims that remain, against the code that makes
 * them true. A card is the only place most of these numbers are ever stated.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { AbilityInfoModal } from "@/components/game/AbilityInfoModal";
import { getAllAbilities, getAbility } from "@/lib/abilities";
import { LOOT_TTL_SECONDS } from "@/lib/chests";

const LOCALES = ["en", "es", "sv"] as const;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const locale = (loc: string) => JSON.parse(read(`src/i18n/locales/${loc}.json`));

afterEach(cleanup);

describe("the acquisition footer", () => {
  it("is gone from the card", () => {
    render(<AbilityInfoModal ability={getAbility("slowAll")!} onClose={() => {}} />);
    expect(screen.queryByText(/smash a box/i), "the stale hint is still drawn").toBeNull();
    expect(screen.queryByText(/gem/i)).toBeNull();
    expect(screen.queryByText(/2 seconds/i)).toBeNull();
  });

  it("is gone from every locale, not just the one that was read", () => {
    for (const loc of LOCALES) {
      expect(
        locale(loc).abilityInfo.collectHint,
        `${loc} still carries the retired hint, ready to come back`,
      ).toBeUndefined();
    }
  });

  it("was describing a deadline the game no longer has", () => {
    // The fact that made it wrong, pinned so it cannot quietly become right
    // again without someone noticing this test.
    const src = read("src/lib/chests.ts");
    expect(src).toMatch(/reward is banked the moment the chest breaks/);
    expect(LOOT_TTL_SECONDS).toBeGreaterThan(0);   // still a fade, no longer a race
  });

  it("leaves the card saying what it does and how to use it", () => {
    // Deleting the footer must not leave an empty box: those two are the card.
    render(<AbilityInfoModal ability={getAbility("slowAll")!} onClose={() => {}} />);
    expect(screen.getByText(/Slows every ball/i)).toBeTruthy();
    expect(screen.getByText(/HOW TO USE/i)).toBeTruthy();
    expect(screen.getByText(/line up your cuts/i)).toBeTruthy();
  });
});

describe("every ability has a card worth opening", () => {
  it.each(getAllAbilities().map(a => [a.id, a] as const))(
    "%s says what it does and how to use it", (_id, ability) => {
      expect(ability.description, `${ability.id} has no description`).toBeTruthy();
      expect(ability.howTo, `${ability.id} has no howTo`).toBeTruthy();
      // CLAUDE.md: never in user-facing strings.
      expect(ability.description).not.toContain("—");
      expect(ability.howTo).not.toContain("—");
    },
  );

  it("names no acquisition route in the copy itself", () => {
    // The footer is gone; a per-ability line saying the same thing would put it
    // straight back, one card at a time.
    for (const a of getAllAbilities()) {
      for (const [field, text] of [["description", a.description], ["howTo", a.howTo]]) {
        expect(text, `${a.id}.${field}`).not.toMatch(/\bchest\b|\bgem\b|smash a box/i);
      }
    }
  });
});

describe("the claims that remain are true", () => {
  it("Shockwave is the only one that promises to come back, and it does", () => {
    // `replenishTo` is what makes "you always start a map with one" true.
    for (const a of getAllAbilities()) {
      const promises = /comes back|start a map with/i.test(`${a.description} ${a.howTo}`);
      expect(
        promises, `${a.id} promises a refill it does not have`,
      ).toBe(a.replenishTo !== undefined && a.replenishTo > 0);
    }
  });

  it("Slow Area really is half speed, as its card says", () => {
    expect(getAbility("slowArea")!.factor).toBe(0.5);
  });

  it("Descope really does refuse the two things its card names", () => {
    const src = read("src/lib/physics/descope.ts");
    expect(src).toMatch(/if \(d\.chest\) return "chest"/);
    expect(src).toMatch(/if \(d\.objective\) return "objective"/);
    expect(getAbility("descope")!.howTo).toMatch(/Objectives and treasure chests cannot be descoped/);
  });

  it("the armed banner has words for every targeted ability but the band", () => {
    // The rubber band is excluded on purpose (its own overlay carries a
    // header), so a missing entry there is correct rather than a hole. Every
    // other targeted ability falling through to "Tap the board to aim" would be
    // a vaguer instruction than the one it deserves.
    const armed = locale("en").abilityInfo.armed as Record<string, string>;
    for (const a of getAllAbilities()) {
      if (!a.targeted || a.kind === "rubberBand") continue;
      expect(armed[a.kind], `no armed prompt for ${a.id}`).toBeTruthy();
    }
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas, "the band lost its exemption and now shows two prompts at once")
      .toMatch(/getAbility\(armedAbility\)\?\.kind !== 'rubberBand'/);
  });
});

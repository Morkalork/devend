/**
 * The economy is one currency, and everything that quotes it must agree.
 *
 * Overtime hours were deflated by four (src/lib/economyDeflation.ts): a good
 * map went from paying ~136h to ~34h, and "every price, ceiling, threshold and
 * flat bonus moved together". The sweep went file by file through public/*.yml,
 * so three kinds of thing were invisible to it and stayed at the old scale:
 *
 *   CONFIG IT DID NOT OPEN. objectives.yml and mapMutators.yml both pay into
 *     the same `flatBonus` term and were never edited, so a map's spice went
 *     from ~4% of its pay to ~29% of it.
 *   NUMBERS LIVING IN CODE. The ability retainer's rate (a card priced at 132h
 *     against a 34h map), the tutorial map's base, the bumper bank, the break
 *     bonus, and the in-code fallbacks that mirror a YAML block.
 *   SENTENCES. Seven player-facing strings kept promising the old number after
 *     the value under them was correctly quartered: a capstone that says it
 *     raises the cap by 20h and raises it by 5.
 *
 * Every class is here, because the next rescale will have the same three blind
 * spots and a comment asking for care will not survive it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { DEFAULT_UPGRADE_PRICING } from "@/lib/upgradePricing";
import { DEFAULT_PICKUP_CONFIG } from "@/types/pickups";
import { ONBOARDING_MAP } from "@/lib/onboardingMap";
import { BOUNCER_HOURS, BOUNCER_HOURS_PER_BUMP, BOUNCER_SLOW } from "@/lib/physics/bouncer";
import { ABILITY_HOURS_PER_MAP, ABILITY_MIN_COST, abilityOfferCost } from "@/lib/abilityOffer";
import type { UpgradeData } from "@/types/upgrade";
import type { LevelData } from "@/types/level";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const load = <T>(p: string): T => yaml.load(read(p)) as T;

const upgradeDoc = load<UpgradeData>("public/upgrades.yml");
const mapDoc = load<LevelData>("public/map.yml");
const gameConfig = load<{ pickups: { effects: Record<string, { weight?: number; value?: number }> } }>(
  "public/game-config.yml",
);

/** What a good map pays today, from upgrades.yml's own measured pricing note. */
const GOOD_MAP_HOURS = 48 * 0.7;   // the anchor x the cheapest tier = 34h

describe("in-code defaults mirror the config they stand in for", () => {
  it("prices upgrades the way upgrades.yml does", () => {
    // These were left at the pre-deflation 8/190 while the YAML went to 2/48,
    // which let upgradePricing.ts's own header claim "190 puts the cheapest
    // tier at 34h" when 190 x 0.70 is 133.
    expect(DEFAULT_UPGRADE_PRICING.minCost).toBe(upgradeDoc.pricing!.minCost);
    expect(DEFAULT_UPGRADE_PRICING.anchorHours).toBe(upgradeDoc.pricing!.anchorHours);
    expect(DEFAULT_UPGRADE_PRICING.tierFactor).toEqual(upgradeDoc.pricing!.tierFactor);
  });

  it("gives the tutorial map the base every shipped map has", () => {
    // The tutorial map is authored in code, so map.yml's `points: 20 -> 5`
    // sweep never reached it and the first map anyone plays paid four times
    // what every later map pays.
    const shipped = new Set(mapDoc.levels.map(l => l.points));
    expect(shipped.size, "the ladder no longer shares one base").toBe(1);
    expect(ONBOARDING_MAP.points).toBe([...shipped][0]);
  });

  /**
   * The pickup fallback is not decoration: parsePickupConfig builds the live
   * effect list FROM it and only lets the YAML override a weight or a value.
   * So an effect present here and absent there is present in the game, which
   * is how tokens could drop a free extra life against a config whose comment
   * says lives are deliberately not a pickup reward.
   */
  it("offers exactly the pickup effects game-config.yml lists", () => {
    const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const shipped = Object.keys(gameConfig.pickups.effects).map(camel).sort();
    const fallback = DEFAULT_PICKUP_CONFIG.effects.map(e => e.effect).sort();
    expect(fallback).toEqual(shipped);
    expect(fallback, "lives are not a pickup reward").not.toContain("extraLife");
  });

  it("matches game-config.yml on every pickup weight and value", () => {
    const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    for (const [rawKey, e] of Object.entries(gameConfig.pickups.effects)) {
      const def = DEFAULT_PICKUP_CONFIG.effects.find(d => d.effect === camel(rawKey));
      expect(def, `${rawKey} missing from the fallback`).toBeTruthy();
      if (e.weight !== undefined) expect(def!.weight, `${rawKey} weight`).toBe(e.weight);
      if (e.value !== undefined) expect(def!.value, `${rawKey} value`).toBe(e.value);
    }
  });
});

describe("hour figures in code sit in the economy that ships", () => {
  it("prices an ability retainer under one good map, even on the first map", () => {
    // The rate is per map REMAINING and deliberately skips block inflation, so
    // it is most expensive at the start. At the pre-deflation rate of 4 that
    // was 132h on map 2, against a 34h good map and a 101h Wizard upgrade:
    // open, priced, and unbuyable exactly where an ability matters most.
    expect(ABILITY_HOURS_PER_MAP).toBe(1);
    expect(ABILITY_MIN_COST).toBe(2);
    expect(abilityOfferCost(33)).toBeLessThanOrEqual(Math.round(GOOD_MAP_HOURS));
    expect(abilityOfferCost(0), "a last-map retainer is still a transaction")
      .toBe(ABILITY_MIN_COST);
  });

  it("keeps a bumper's brake budget while paying a bumper's worth of hours", () => {
    // The bank is two numbers in one coat: what it pays, and (since a bumper
    // brakes only while it has hours) how many brakes it holds. Quartering the
    // bank alone would have taken the brakes with it, so the RATE moved
    // instead. BOUNCER_SLOW's own note depends on the count being five.
    expect(BOUNCER_HOURS / BOUNCER_HOURS_PER_BUMP).toBe(5);
    expect(BOUNCER_HOURS).toBe(1);
    expect(BOUNCER_SLOW ** 5).toBeCloseTo(0.774, 3);
  });

  it("drains a bumper in exactly five bumps, despite the fractional rate", () => {
    // A fifth of an hour does not subtract cleanly from one, so `charged` is an
    // epsilon test rather than `> 0`. Without it a drained bumper brakes once
    // more than its bank paid for.
    let hours = BOUNCER_HOURS;
    let bumps = 0;
    while (hours > 1e-9 && bumps < 50) {
      hours -= Math.min(BOUNCER_HOURS_PER_BUMP, hours);
      bumps++;
    }
    expect(bumps).toBe(5);
  });
});

describe("flat bonuses are spice, not a second income", () => {
  /**
   * An objective's reward and a mutator's hazard premium are summed into one
   * `flatBonus` term and paid under the per-map backstop. Both files were
   * missed by the deflation, so a map carrying one of each paid 29% of itself
   * in bonuses that were designed to be worth about 4%.
   */
  const objectives = load<{ objectives: { id: string; reward: number }[] }>("public/objectives.yml").objectives;
  const mutators = load<{ mutators: { id: string; overtimePremium?: number }[] }>("public/mapMutators.yml").mutators;

  it("keeps the worst objective and mutator stack in single figures of a map", () => {
    const worstObjective = Math.max(...objectives.map(o => o.reward));
    const worstMutator = Math.max(...mutators.map(m => m.overtimePremium ?? 0));
    const share = (worstObjective + worstMutator) / GOOD_MAP_HOURS;
    expect(share, `worst stack is ${Math.round(share * 100)}% of a good map`).toBeLessThan(0.15);
  });

  it("pays every objective and every mutator in whole hours", () => {
    // mutatorOvertimePremium returns the raw number and the scorer rounds the
    // summed flatBonus, so a fractional author here is a payout that depends on
    // what else happened to land on the map.
    for (const o of objectives) expect(Number.isInteger(o.reward), o.id).toBe(true);
    for (const m of mutators) expect(Number.isInteger(m.overtimePremium ?? 0), m.id).toBe(true);
  });
});

describe("what a card promises is what its modifier does", () => {
  /**
   * The class of bug this catches: the deflation quartered `overtimeCapBonus`
   * from 20 to 5 and left both of Stock Options' strings saying 20h, so the
   * player was told four times what they got. Each case pairs a live number
   * with every displayed string that quotes it.
   */
  const upgradesRaw = read("public/upgrades.yml");
  const capstonesRaw = read("public/capstones.yml");
  const certificatesRaw = read("public/certificates.yml");
  const en = JSON.parse(read("src/i18n/locales/en.json"));
  const es = JSON.parse(read("src/i18n/locales/es.json"));
  const sv = JSON.parse(read("src/i18n/locales/sv.json"));

  /** The live hour figures, read from where the game actually reads them. */
  const capRaise = 5;      // overtimeCapBonus: Stock Options and Technical Debt
  const spendChunk = 15;   // SPEND_CHUNK_HOURS in src/lib/treasury.ts
  const bankedStep = 13;   // BANKED_SLOW_STEP_HOURS in src/hooks/useGameSession.ts

  it("reads those live figures from their source, not from this file", () => {
    // Otherwise the pairs below drift the moment someone retunes the real one.
    expect(read("src/lib/treasury.ts")).toContain(`SPEND_CHUNK_HOURS = ${spendChunk}`);
    expect(read("src/hooks/useGameSession.ts")).toContain(`BANKED_SLOW_STEP_HOURS = ${bankedStep}`);
    expect(capstonesRaw).toContain(`overtimeCapBonus: ${capRaise}`);
  });

  it("quotes the cap raise as the hours it actually grants", () => {
    expect(capstonesRaw).toContain(`cap rises by ${capRaise}h`);
    expect(capstonesRaw).toContain(`raises the cap by ${capRaise}h`);
    expect(upgradesRaw).toContain(`+${capRaise}h to this run's per-map overtime ceiling`);
    for (const [name, loc] of [["es", es], ["sv", sv]] as const) {
      expect(loc.content.upgrades.technical_debt_architect.description, name)
        .toContain(`+${capRaise}h`);
    }
  });

  it("quotes the spend chunk as the hours a chunk actually is", () => {
    expect(upgradesRaw).toContain(`Each ${spendChunk}h chunk spent per visit`);
    for (const [name, loc] of [["es", es], ["sv", sv]] as const) {
      expect(loc.content.upgrades.budget_cycle_junior.description, name)
        .toContain(`${spendChunk}h`);
    }
  });

  it("quotes the banked-slow step as the hours it actually steps on", () => {
    expect(upgradesRaw).toContain(`per ${bankedStep}h banked`);
    expect(certificatesRaw).toContain(`per ${bankedStep}h banked`);
    for (const [name, loc] of [["en", en], ["es", es], ["sv", sv]] as const) {
      expect(loc.bottomBarDetails.bankedSlowValue, name).toContain(`${bankedStep}h`);
      expect(loc.bottomBarDetails.bankedSlowActive, name).toContain(`${bankedStep}h`);
    }
  });

  /**
   * The general form, and the one with teeth: every "<n>h" a card SAYS must be
   * a number that card HAS, or one of the two shared constants a card is
   * allowed to quote. It needs no list of known-bad figures, so it catches the
   * next stale promise rather than the last four.
   *
   * Pairing per card is what makes it usable: "50h" is a lie on the banked-slow
   * line and the plain truth on the Runway concurrent-fence line, which is
   * exactly the distinction a blanket search for old numbers cannot draw.
   */
  it("never quotes an hour figure the card does not actually have", () => {
    const SHARED = new Set([spendChunk, bankedStep]);
    const numbersIn = (o: unknown, out: Set<number>): Set<number> => {
      if (Array.isArray(o)) o.forEach(v => numbersIn(v, out));
      else if (o && typeof o === "object") Object.values(o).forEach(v => numbersIn(v, out));
      else if (typeof o === "number" && Number.isFinite(o)) out.add(o);
      return out;
    };
    const entries: Array<[string, Record<string, unknown>[]]> = [
      ["upgrades.yml", (yaml.load(upgradesRaw) as { upgrades: Record<string, unknown>[] }).upgrades],
      ["capstones.yml", (yaml.load(capstonesRaw) as { capstones: Record<string, unknown>[] }).capstones],
      ["certificates.yml",
        (yaml.load(certificatesRaw) as { certificates: Record<string, unknown>[] }).certificates],
    ];
    const unexplained: string[] = [];
    for (const [file, list] of entries) {
      for (const entry of list ?? []) {
        const live = numbersIn(entry, new Set<number>());
        for (const field of ["description", "clarify", "name"]) {
          const text = entry[field];
          if (typeof text !== "string") continue;
          for (const [, n] of text.matchAll(/(\d+(?:\.\d+)?)h\b/g)) {
            const hours = Number(n);
            if (!live.has(hours) && !SHARED.has(hours)) {
              unexplained.push(`${file} ${String(entry.id)}: says ${hours}h, has none`);
            }
          }
        }
      }
    }
    expect(unexplained).toEqual([]);
  });

  it("keeps the translated cards on the same figures as the English ones", () => {
    // es and sv carry their own copies of three of these descriptions, so the
    // YAML being right is only two thirds of the fix.
    for (const [name, loc] of [["es", es], ["sv", sv]] as const) {
      const body = JSON.stringify(loc.content ?? {});
      for (const stale of ["20h", "50h", "60h", "150h"]) {
        expect(body.includes(stale), `${name}.json content still says ${stale}`).toBe(false);
      }
    }
  });
});

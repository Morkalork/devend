/**
 * The canvas ModifierBreakdown's rows (ui/game/specsModel.ts), carrying over
 * the behavioural assertions bugSquash.test.tsx and onboardingHeadStart.test.tsx
 * make against the DOM readout: a row is listed with its value and plain-language
 * description when owned, and reads as inactive (not absent) when not.
 */
import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import i18n from "@/i18n";
import {
  computeGameModifiers, DEFAULT_MODIFIERS, MAX_STARTING_CAPTURE_PERCENT,
  type GameModifiers, type ModifierSource,
} from "@/hooks/useActiveModifiers";
import type { UpgradeConfig } from "@/types/upgrade";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { getShipEarlyThresholds } from "@/lib/scoring";
import {
  contributionFor, formatContribution, modifierRows, rowContributors, shipEarlyTopPercent, splitRows,
} from "@/ui/game/specsModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const rows = (m: GameModifiers, lockedBalls = 0) => modifierRows(t, m, lockedBalls);
const row = (m: GameModifiers, label: string) => rows(m).find(r => r.label === label);

describe("Bug Squash in the Specs panel", () => {
  it("lists the odds and the hold when owned", () => {
    const r = row({ ...DEFAULT_MODIFIERS, bugSquashChance: 8, bugSquashSeconds: 3 }, "Bug Squash");
    expect(r).toBeTruthy();
    expect(r!.changed).toBe(true);
    expect(r!.value).toBe("8%");
    expect(r!.description).toMatch(/squash the ball flat for 3s/);
  });

  it("reads as inactive when not owned", () => {
    const r = row(DEFAULT_MODIFIERS, "Bug Squash")!;
    expect(r.changed).toBe(false);
    expect(r.description).toMatch(/No Bug Squash owned/);
  });
});

describe("Head Start in the Specs panel", () => {
  const UPGRADES = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
  ) as { upgrades: UpgradeConfig[] }).upgrades;
  const lookup = new Map(UPGRADES.map(u => [u.id, u]));
  const modsWith = (p: number) => ({ ...DEFAULT_MODIFIERS, startingCapturePercent: p }) as GameModifiers;

  it("lists the head start as active, at the map's actual size", () => {
    const r = row(modsWith(8), "Head Start")!;
    expect(r.changed).toBe(true);
    expect(r.value).toBe("+8%");
  });

  it("shows the capped number, not a stacked-past-the-ceiling one", () => {
    const stacked = computeGameModifiers(
      ["onboarding_junior", "onboarding_senior", "onboarding_principal_a"],
      lookup,
      { startingCapturePercent: 30 },
    );
    const r = row(stacked, "Head Start")!;
    expect(r.value).toBe(`+${MAX_STARTING_CAPTURE_PERCENT}%`);
    expect(r.value).not.toMatch(/\+46%/);
  });

  it("reads as inactive, not merely absent, when nobody owns it", () => {
    const r = row(modsWith(0), "Head Start");
    expect(r).toBeTruthy();
    expect(r!.changed).toBe(false);
    expect(r!.description).toMatch(/No head start/);
  });
});

describe("rows and their sources", () => {
  it("splits changed rows from the ones at default, losing none", () => {
    const all = rows({ ...DEFAULT_MODIFIERS, bugSquashChance: 8, bugSquashSeconds: 3 });
    const { active, inactive } = splitRows(all);
    expect(active.map(r => r.label)).toContain("Bug Squash");
    expect(active.length + inactive.length).toBe(all.length);
    expect(splitRows(rows(DEFAULT_MODIFIERS)).active).toHaveLength(0);
  });

  it("attributes a row only to sources that move it off identity", () => {
    const speed = rows({ ...DEFAULT_MODIFIERS, ballSpeedMultiplier: 0.9 })[0];
    const sources: ModifierSource[] = [
      { kind: "upgrade", id: "a", name: "A", modifiers: { ballSpeedMultiplier: 0.9 } },
      { kind: "upgrade", id: "b", name: "B", modifiers: { ballSpeedMultiplier: 1 } },
      { kind: "upgrade", id: "c", name: "C", modifiers: { extraLives: 1 } },
    ];
    const c = rowContributors(speed, sources);
    expect(c.map(x => x.source.id)).toEqual(["a"]);
    expect(c[0].text).toBe("-10%");
  });

  it("formats each key the way it reads elsewhere", () => {
    expect(formatContribution("ballSpeedMultiplier", 1.25)).toBe("+25%");
    expect(formatContribution("fenceSpeedPerLock", 0.05)).toBe("+5%");
    expect(formatContribution("extraLives", 2)).toBe("+2");
    expect(formatContribution("extraLives", -1)).toBe("-1");
    expect(contributionFor({ kind: "upgrade", id: "x", name: "X", modifiers: { extraLives: 0 } }, ["extraLives"])).toBeNull();
  });

  it("explains the Ship Early countdown from config", () => {
    // The top rung of the configured ladder, so the copy cannot drift from the payouts.
    const top = getShipEarlyThresholds().reduce((mx, s) => Math.max(mx, s.percent), 0);
    expect(shipEarlyTopPercent()).toBe(top);
  });
});

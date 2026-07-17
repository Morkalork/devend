/**
 * runRng (HIGHSCORES.md Phase D): the seeded-run context behind Daily
 * Stand-up. Same seed + context must always replay the same rolls; no armed
 * seed must fall through to Math.random.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createRng,
  setRunSeedText,
  getRunSeedText,
  getRunRng,
  todayKey,
  previousDayKey,
  dailySeedText,
} from "@/lib/runRng";
import { drawRandom } from "@/lib/yamlCatalogue";
import { drawOffers } from "@/lib/loadoutDraft";

afterEach(() => setRunSeedText(null));

describe("createRng", () => {
  it("is deterministic per seed text and diverges across seeds", () => {
    const a1 = createRng("daily:2026-07-16::levels");
    const a2 = createRng("daily:2026-07-16::levels");
    const b = createRng("daily:2026-07-17::levels");
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA1) expect(v).toBeLessThan(1);
  });
});

describe("getRunRng", () => {
  it("falls through to Math.random when no seed is armed", () => {
    expect(getRunSeedText()).toBeNull();
    expect(getRunRng("anything")).toBe(Math.random);
  });

  it("armed: same context replays the same sequence (fresh generator per call)", () => {
    setRunSeedText(dailySeedText("2026-07-16"));
    const first = getRunRng("shop:5");
    const second = getRunRng("shop:5");
    expect([first(), first()]).toEqual([second(), second()]);
    // Different contexts roll differently.
    expect(getRunRng("shop:5")()).not.toBe(getRunRng("shop:6")());
  });

  it("seeded draws are shared: drawRandom and drawOffers replay identically", () => {
    setRunSeedText(dailySeedText("2026-07-16"));
    const pool = ["a", "b", "c", "d", "e", "f"].map(id => ({ id }));
    const draw1 = drawRandom(pool, 3, getRunRng("doors:5")).map(d => d.id);
    const draw2 = drawRandom(pool, 3, getRunRng("doors:5")).map(d => d.id);
    expect(draw1).toEqual(draw2);

    const loadouts = pool.map(p => ({ id: p.id, name: p.id, modifiers: {} })) as never[];
    const offers1 = drawOffers(loadouts, [], 3, getRunRng("runDraft")).map((l: { id: string }) => l.id);
    const offers2 = drawOffers(loadouts, [], 3, getRunRng("runDraft")).map((l: { id: string }) => l.id);
    expect(offers1).toEqual(offers2);
  });
});

describe("day keys", () => {
  it("todayKey is a UTC YYYY-MM-DD", () => {
    expect(todayKey(Date.UTC(2026, 6, 16, 23, 59))).toBe("2026-07-16");
    expect(todayKey(Date.UTC(2026, 6, 17, 0, 1))).toBe("2026-07-17");
  });

  it("previousDayKey crosses month and year boundaries", () => {
    expect(previousDayKey("2026-07-16")).toBe("2026-07-15");
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { CapstoneConfig, CapstoneData } from "@/types/capstone";
import { drawCapstoneOffers } from "@/lib/capstones";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";

// Guard the capstone pool straight from the YAML source of truth.
const doc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/capstones.yml"), "utf8"),
) as CapstoneData;
const capstones = doc.capstones;

const VALID_KEYS = new Set(Object.keys(computeGameModifiers([], new Map())));
const VALID_TAGS = ["lock", "freeze", "bank", "tempo", "risk", "safety"];

describe("capstone pool integrity", () => {
  it("has at least 3 capstones (a 1-of-3 draft needs a full hand)", () => {
    expect(capstones.length).toBeGreaterThanOrEqual(3);
  });

  it("offers the draft at a sensible trigger level", () => {
    expect(doc.offeredAfterLevel).toBeGreaterThanOrEqual(2);
  });

  it("has unique ids", () => {
    const ids = capstones.map(c => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every capstone a name, description, valid tag and modifiers", () => {
    const offenders = capstones
      .filter(c =>
        !c.name || !c.description ||
        !c.modifiers || Object.keys(c.modifiers).length === 0 ||
        (c.tag != null && !VALID_TAGS.includes(c.tag)))
      .map(c => c.id);
    expect(offenders).toEqual([]);
  });

  it("uses only known GameModifiers keys (typos would be silently ignored)", () => {
    const offenders: string[] = [];
    for (const c of capstones) {
      for (const key of Object.keys(c.modifiers)) {
        if (!VALID_KEYS.has(key)) offenders.push(`${c.id} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("covers every archetype so any build can find its crown", () => {
    const tags = capstones.map(c => c.tag).filter(Boolean).sort();
    expect([...new Set(tags)]).toEqual([...VALID_TAGS].sort());
  });
});

describe("drawCapstoneOffers", () => {
  const mk = (id: string): CapstoneConfig => ({ id, name: id, description: "d", modifiers: { overtimeCapBonus: 1 } });
  const pool = ["a", "b", "c", "d", "e"].map(mk);

  it("draws n distinct capstones without mutating the pool", () => {
    const before = pool.map(c => c.id).join(",");
    for (let i = 0; i < 20; i++) {
      const drawn = drawCapstoneOffers(pool, 3);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn.map(c => c.id)).size).toBe(3);
    }
    expect(pool.map(c => c.id).join(",")).toBe(before);
  });

  it("clamps to the pool size", () => {
    expect(drawCapstoneOffers(pool, 10)).toHaveLength(5);
  });
});

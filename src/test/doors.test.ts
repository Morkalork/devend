import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { DoorConfig, DoorData } from "@/types/door";
import { drawDoorOffers } from "@/lib/doorDraft";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";

// Guard the door pool straight from the YAML source of truth.
const doc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/doors.yml"), "utf8"),
) as DoorData;
const doors = doc.doors;

// All valid GameModifiers keys, derived from the canonical defaults so this
// test can never drift from the engine.
const VALID_KEYS = new Set(Object.keys(computeGameModifiers([], new Map())));

describe("door pool integrity", () => {
  it("has at least 2 doors (so a draw of two risk doors is meaningful)", () => {
    expect(doors.length).toBeGreaterThanOrEqual(2);
  });

  it("has unique ids", () => {
    const ids = doors.map(d => d.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every door a name, risk, reward and modifiers", () => {
    const offenders = doors
      .filter(d => !d.name || !d.risk || !d.reward || !d.modifiers || Object.keys(d.modifiers).length === 0)
      .map(d => d.id);
    expect(offenders).toEqual([]);
  });

  it("gives every door a clarify blurb (shown in the hold-to-detail view)", () => {
    const offenders = doors.filter(d => !d.clarify || d.clarify.trim().length === 0).map(d => d.id);
    expect(offenders).toEqual([]);
  });

  it("uses only known GameModifiers keys (typos would be silently ignored)", () => {
    const offenders: string[] = [];
    for (const d of doors) {
      for (const key of Object.keys(d.modifiers)) {
        if (!VALID_KEYS.has(key)) offenders.push(`${d.id} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gates doors behind the early ramp (offeredAfterLevel is a real level)", () => {
    // Early maps stay clean; doors start once this level is completed.
    expect(doc.offeredAfterLevel).toBeGreaterThanOrEqual(1);
  });

  it("pairs every reward with a real risk (no free lunches)", () => {
    // Every door must carry at least one adverse modifier: a multiplicative
    // curse (>1 speed/size, <1 fence/score) or losing something additive.
    const isAdverse = (key: string, v: number): boolean => {
      if (key === "ballSpeedMultiplier" || key === "ballSizeMultiplier") return v > 1;
      if (key === "fenceGenerationSpeedMultiplier" || key === "scoreMultiplier") return v < 1;
      return v < 0;
    };
    const offenders = doors
      .filter(d => !Object.entries(d.modifiers).some(([k, v]) => isAdverse(k, v)))
      .map(d => d.id);
    expect(offenders).toEqual([]);
  });
});

describe("drawDoorOffers", () => {
  const mk = (id: string): DoorConfig => ({ id, name: id, risk: "r", reward: "b", modifiers: { scoreMultiplier: 1.1, ballSpeedMultiplier: 1.1 } });
  const pool = ["a", "b", "c", "d"].map(mk);

  it("draws n distinct doors from the pool", () => {
    for (let i = 0; i < 20; i++) {
      const drawn = drawDoorOffers(pool, 2);
      expect(drawn).toHaveLength(2);
      expect(new Set(drawn.map(d => d.id)).size).toBe(2);
    }
  });

  it("clamps to the pool size and never mutates the pool", () => {
    const before = pool.map(d => d.id).join(",");
    expect(drawDoorOffers(pool, 10)).toHaveLength(4);
    expect(drawDoorOffers(pool, 0)).toHaveLength(0);
    expect(pool.map(d => d.id).join(",")).toBe(before);
  });
});

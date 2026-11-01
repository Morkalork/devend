/**
 * The two late mutators (LATE_GAME_PLAN.md): Traffic Spike (rolled from 31,
 * pinned on 34) and Slow Build (rolled from 36).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  mutatorFenceSpeedFactor, mutatorSpeedFactor, parseMutatorEntry, spikeActive,
} from "@/lib/mapMutators";
import type { ActiveMapMutator } from "@/types/mapMutator";
import { LADDER } from "./fixtures/maps";

const doc = yaml.load(readFileSync("public/mapMutators.yml", "utf8")) as { mutators: unknown[] };
const catalogue = doc.mutators.map(parseMutatorEntry).filter((m): m is NonNullable<typeof m> => m !== null);
const byId = (id: string) => catalogue.find(m => m.id === id) as ActiveMapMutator;

describe("Traffic Spike", () => {
  const spike = byId("spike");

  it("parses, and is rolled only from act IV on", () => {
    expect(spike.behavior).toBe("spike");
    expect(spike.minLevel).toBe(31);
  });

  it("opens calm, then surges for the last three seconds of every fifteen", () => {
    expect(spikeActive(spike, 0)).toBe(false);
    expect(spikeActive(spike, 11.9)).toBe(false);
    expect(spikeActive(spike, 12.1)).toBe(true);
    expect(spikeActive(spike, 14.9)).toBe(true);
    expect(spikeActive(spike, 15.1)).toBe(false);
    expect(spikeActive(spike, 27.5)).toBe(true);
  });

  it("speeds the board up only during the surge", () => {
    expect(mutatorSpeedFactor(spike, 0, 5)).toBe(1);
    expect(mutatorSpeedFactor(spike, 0, 13)).toBe(1.5);
  });

  it("is pinned on 34, the act's skill check", () => {
    expect(LADDER.find(l => l.level === 34)?.mutator).toBe("spike");
  });
});

describe("Slow Build", () => {
  const lag = byId("lag");

  it("parses, and is rolled only from act V on", () => {
    expect(lag.behavior).toBe("lag");
    expect(lag.minLevel).toBe(36);
  });

  it("slows every fence and leaves the balls alone", () => {
    expect(mutatorFenceSpeedFactor(lag)).toBe(0.8);
    expect(mutatorSpeedFactor(lag, 3, 10)).toBe(1);
  });

  it("does nothing on a map without it", () => {
    expect(mutatorFenceSpeedFactor(null)).toBe(1);
    expect(mutatorFenceSpeedFactor(byId("overclock"))).toBe(1);
  });
});

/**
 * A fence must always be breakable.
 *
 * Ghost Protocol makes a growing fence completely intangible for its first
 * `fenceGraceMs`. That is a good upgrade right up until the grace covers the
 * whole build, at which point the fence cannot be hit at all and the game
 * cannot be lost - which is exactly what happened, and was reported from play
 * as "I can't seem to lose a fence".
 *
 * The numbers, measured rather than estimated:
 *
 *     minimum build time (MINIMUM_WALL_TIME)   350 ms
 *     longest realistic cut                   ~850 ms
 *     Ghost Protocol Junior + Senior           400 ms   <- already immune on
 *                                                          short cuts, by L4
 *     Ghost Protocol full chain               1000 ms   <- immune on every cut
 *
 * It was not a stacking-of-many-upgrades problem. One family did it alone; the
 * shields the player also had (Defensive Programming, the Second Wind capstone)
 * were absorbing hits that could no longer happen.
 *
 * So the fix is arithmetic, not tuning: the TOTAL grace, from every source, is
 * capped below the build floor. This file pins that relationship rather than
 * the numbers on either side of it, because either may legitimately move and
 * the thing that must not break is the gap between them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { computeGameModifiers, MAX_FENCE_GRACE_MS } from "@/hooks/useActiveModifiers";
import { MINIMUM_WALL_TIME } from "@/lib/gameConstants";
import type { UpgradeConfig } from "@/types/upgrade";

const UPGRADES = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;

const lookup = new Map(UPGRADES.map(u => [u.id, u]));
const graceOf = (ids: string[]) => computeGameModifiers(ids, lookup).fenceGraceMs;

const GHOST_CHAIN = [
  "ghost_protocol_junior", "ghost_protocol_senior", "ghost_protocol_principal_b",
];

describe("the cap that keeps a fence breakable", () => {
  it("sits below the shortest build a fence can possibly have", () => {
    // THE invariant. Grace at or above the floor means a fence that finishes
    // before it can be touched, on every map, forever.
    expect(MAX_FENCE_GRACE_MS).toBeLessThan(MINIMUM_WALL_TIME * 1000);
  });

  it("leaves a real window on even the shortest cut", () => {
    // Not merely "less than": a 349ms cap against a 350ms floor is immunity in
    // all but name. The window has to be big enough for a ball to arrive in.
    const windowMs = MINIMUM_WALL_TIME * 1000 - MAX_FENCE_GRACE_MS;
    expect(windowMs).toBeGreaterThanOrEqual(100);
  });

  it("lands the full chain exactly ON the cap, not clipped by it", () => {
    // The chain used to sum to 1000ms and would now be silently clipped to 250,
    // which fixes the exploit and leaves every card lying about what it gives.
    // So the values were re-authored to reach the cap instead of exceed it, and
    // this asserts they still add up rather than having drifted under.
    const authored = GHOST_CHAIN
      .map(id => lookup.get(id)?.modifiers?.fenceGraceMs ?? 0)
      .reduce((a, b) => a + b, 0);
    // Via Principal B on a busy map, which is the family's highest reachable
    // total and the one that has to land on the ceiling rather than through it.
    expect(authored, "the authored chain no longer reaches the cap").toBe(MAX_FENCE_GRACE_MS);
    expect(graceOf(GHOST_CHAIN)).toBe(MAX_FENCE_GRACE_MS);
  });

  it("caps the TOTAL, not one upgrade, because grace has other sources", () => {
    // The loadout and the Fence Shield ability grant it too. Three sources that
    // are each reasonable can still add up to immunity, so the ceiling has to
    // be on the sum.
    const withExtra = computeGameModifiers(GHOST_CHAIN, lookup, { fenceGraceMs: 5000 });
    expect(withExtra.fenceGraceMs).toBe(MAX_FENCE_GRACE_MS);
  });

  it("does not touch a partial chain that is under the cap", () => {
    // The cap is a ceiling, not a replacement: a player one upgrade in should
    // still feel the difference between one tier and two.
    const one = graceOf(["ghost_protocol_junior"]);
    const two = graceOf(["ghost_protocol_junior", "ghost_protocol_senior"]);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(MAX_FENCE_GRACE_MS);
  });

  it("is zero for a player who bought none of it", () => {
    expect(graceOf([])).toBe(0);
  });
});

describe("where the immunity chain now sits on the ladder", () => {
  const levelOf = (id: string) => lookup.get(id)!.unlockLevel;

  it("keeps Ghost Protocol out of the first two acts entirely", () => {
    // It used to run 1 / 4 / 8, so the whole chain was owned before act II.
    expect(levelOf("ghost_protocol_junior")).toBeGreaterThanOrEqual(18);
    expect(levelOf("ghost_protocol_senior")).toBeGreaterThanOrEqual(24);
    expect(levelOf("ghost_protocol_principal_a")).toBeGreaterThanOrEqual(30);
    expect(levelOf("ghost_protocol_principal_b")).toBeGreaterThanOrEqual(30);
  });

  it("puts it behind a door rather than leaving it a free root", () => {
    // A root can simply be offered. Hanging it off Defensive Programming's
    // Senior makes it the specialist end of a safety build, which is a choice
    // the player has to have already committed to.
    expect(lookup.get("ghost_protocol_junior")!.prerequisites)
      .toEqual(["defensive_programming_senior"]);
  });

  it("does not carry a first-hire price it no longer qualifies for", () => {
    // It was explicitly priced at 30 to sit alongside the other level-1
    // Juniors. At 18, behind a door, that price is a leftover.
    expect(lookup.get("ghost_protocol_junior")!.cost).toBeUndefined();
  });

  it("moves Fast Compile's multipliers late but leaves its doors alone", () => {
    // Junior and Senior are prerequisites for Hot Start, Multithreading and
    // Clean Release. Moving them would strand three families behind a
    // late-game gate, which is a bigger change than the one being made.
    expect(levelOf("fast_compile_junior")).toBe(1);
    expect(levelOf("fast_compile_senior")).toBe(5);
    expect(levelOf("fast_compile_principal")).toBeGreaterThanOrEqual(26);
    expect(levelOf("fast_compile_principal_b")).toBeGreaterThanOrEqual(26);
  });

  it("keeps one early shield, and pushes the stack of them back", () => {
    // The first Defensive Programming shield is the beginner safety net and is
    // now also the road to Ghost Protocol, so it stays early. The pile of five
    // is what needed moving.
    expect(levelOf("defensive_programming_junior")).toBeLessThanOrEqual(5);
    expect(levelOf("defensive_programming_principal")).toBeGreaterThanOrEqual(26);
    expect(levelOf("defensive_programming_architect_a")).toBeGreaterThanOrEqual(32);
  });
});

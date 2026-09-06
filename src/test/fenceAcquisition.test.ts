/**
 * Step 7 of FENCE_TYPES_PLAN: how a fence type is acquired.
 *
 * Two channels, not the three the plan named. The plan had "the store" and
 * "the upgrade chains" as separate, and in this game they are one thing: the
 * upgrade shop IS the store, so four types are ordinary chain entries and
 * building a parallel shelf mechanism would have been a second way to buy the
 * same thing. The certificate store is genuinely separate, because what it
 * sells outlives the run.
 *
 * OWNING IS HOLDING A SLOT. There is no inventory and no swap screen: five
 * acquirable types against four slots means a swap would matter exactly once
 * per run, and only for a player who bought all five. So a purchase goes
 * straight into a slot, and the shop stops offering once the four are full -
 * which makes the purchase a decision, and costs the player the ability to
 * change their mind. Worth stating rather than discovering.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  fenceSlotsFrom, hasFreeFenceSlot, grantFenceType, resolveSelection, ACQUIRABLE_SLOTS,
} from "@/lib/fenceOwnership";
import { getAllFenceTypes, STANDARD_FENCE_ID } from "@/lib/fences";
import type { UpgradeData } from "@/types/upgrade";
import type { CertConfig } from "@/types/certificate";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const upgrades = (yaml.load(read("public/upgrades.yml")) as UpgradeData).upgrades;
const certificates = (yaml.load(read("public/certificates.yml")) as CertConfig).certificates;

describe("the slot list", () => {
  it("keeps acquisition order", () => {
    // The bar must not rearrange itself when a type arrives: the slot a player
    // has learned to reach for has to stay where it was.
    expect(fenceSlotsFrom(["redeploy", "ice", "flare"])).toEqual(["redeploy", "ice", "flare"]);
  });

  it("drops standard, unknowns and duplicates", () => {
    // Each would otherwise reach the bar and either draw a duplicate the player
    // cannot remove or push a real type out of view.
    expect(fenceSlotsFrom([STANDARD_FENCE_ID, "ice", "ice", "nonsense", "flare"]))
      .toEqual(["ice", "flare"]);
  });

  it("never exceeds the slots", () => {
    const many = getAllFenceTypes().map(f => f.id);
    expect(many.length).toBeGreaterThan(ACQUIRABLE_SLOTS + 1);
    expect(fenceSlotsFrom(many).length).toBe(ACQUIRABLE_SLOTS);
  });
});

describe("granting", () => {
  it("refuses what would take hours and do nothing", () => {
    // The one outcome a shop must never have.
    expect(grantFenceType(["ice"], "ice"), "sold a type the player already has").toBeNull();
    expect(grantFenceType([], "nonsense"), "sold a type that does not exist").toBeNull();
    expect(grantFenceType([], STANDARD_FENCE_ID), "sold the free fence").toBeNull();
  });

  it("refuses once the bar is full", () => {
    const full = getAllFenceTypes().filter(f => f.id !== STANDARD_FENCE_ID)
      .slice(0, ACQUIRABLE_SLOTS).map(f => f.id);
    expect(hasFreeFenceSlot(full)).toBe(false);
    const spare = getAllFenceTypes().find(f => !full.includes(f.id) && f.id !== STANDARD_FENCE_ID)!;
    expect(grantFenceType(full, spare.id), "sold a fifth type into four slots").toBeNull();
  });

  it("accepts an ordinary purchase", () => {
    const after = grantFenceType(["ice"], "flare");
    expect(after).not.toBeNull();
    expect(fenceSlotsFrom(after!)).toEqual(["ice", "flare"]);
  });
});

describe("the selection follows the slots", () => {
  it("falls back when the selected type leaves the bar", () => {
    // A run ends, a save loads, a flag is edited. A selection with no lit
    // button anywhere reads as the bar being broken, not as a stale choice.
    expect(resolveSelection("ice", ["flare"])).toBe(STANDARD_FENCE_ID);
    expect(resolveSelection("ice", ["ice", "flare"])).toBe("ice");
    expect(resolveSelection(undefined, ["ice"])).toBe(STANDARD_FENCE_ID);
  });
});

describe("what the catalogue actually sells", () => {
  const granted = new Map<string, string[]>();
  for (const u of upgrades) if (u.grantsFenceType) {
    granted.set(u.grantsFenceType, [...(granted.get(u.grantsFenceType) ?? []), `upgrade:${u.id}`]);
  }
  for (const c of certificates) for (const l of c.levels) {
    if (l.effect.type === "grantsFenceType" && l.effect.fenceType) {
      granted.set(l.effect.fenceType, [...(granted.get(l.effect.fenceType) ?? []), `cert:${c.id}`]);
    }
  }

  it("has a way to get every type that is not free", () => {
    // A type in the catalogue with no source is content nobody can ever reach,
    // which is the failure mechanicSpread exists to catch for map mechanics and
    // this catches for fences.
    for (const f of getAllFenceTypes()) {
      if (f.id === STANDARD_FENCE_ID) continue;
      expect(granted.get(f.id), `${f.id} cannot be acquired at all`).toBeTruthy();
    }
  });

  it("sells each type exactly once", () => {
    // Two sources for one type would let a player spend twice for nothing.
    for (const [id, sources] of granted) {
      expect(sources, `${id} is sold in more than one place`).toHaveLength(1);
    }
  });

  it("says the same thing in the catalogue and in the shop", () => {
    // The fences.yml `source` field is documentation, and documentation that
    // disagrees with the shop is worse than none.
    for (const f of getAllFenceTypes()) {
      if (f.id === STANDARD_FENCE_ID) continue;
      const from = granted.get(f.id)![0].split(":")[0];
      const expected = from === "cert" ? "certificate" : "upgrade";
      expect(f.source, `${f.id} says ${f.source} and is sold as ${expected}`).toBe(expected);
    }
  });

  it("puts exactly one type behind a certificate, and it is the drill", () => {
    // The only ACCOUNT-scoped grant. It earns that because it is the only type
    // that changes what a cut can be AIMED at, and because a mechanic you meet
    // once per run and then lose is a mechanic nobody learns.
    const certTypes = [...granted].filter(([, s]) => s[0].startsWith("cert:")).map(([id]) => id);
    expect(certTypes).toEqual(["drill"]);
  });

  it("keeps ONE open shelf and gates the rest", () => {
    // This used to read "hangs every upgrade grant off a real chain", and that
    // rule was half right. A fence type is a change of VERB and worth walking
    // to - but with every one of them gated, a player who spread their buys
    // finished a run with a bar of empty slots and no idea what filled them.
    // They never met the system at all.
    //
    // So exactly one is open: a root, eligible in any shop for any build, which
    // is what "open" means in a game whose store IS the upgrade tree. Every
    // other one is earned, and the count is pinned because "one" is the whole
    // design - two would make the gated ones optional, none takes the
    // introduction away again.
    const ids = new Set(upgrades.map(u => u.id));
    const grants = upgrades.filter(u => u.grantsFenceType);
    const open = grants.filter(u =>
      (u.prerequisites ?? []).length === 0 && !u.unlockAfterChoice);
    expect(open.map(u => u.id)).toEqual(["set_a_breakpoint"]);

    for (const u of grants) {
      if (open.includes(u)) continue;
      const gated = (u.prerequisites ?? []).length > 0 || !!u.unlockAfterChoice;
      expect(gated, `${u.id} is a second open shelf`).toBe(true);
      for (const p of u.prerequisites ?? []) {
        expect(ids.has(p), `${u.id} requires ${p}, which does not exist`).toBe(true);
      }
    }
  });
});

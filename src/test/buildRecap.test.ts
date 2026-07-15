import { describe, it, expect } from "vitest";
import { computeBuildIdentity, BUILD_IDENTITY_MIN_COUNT } from "@/lib/buildRecap";

const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("computeBuildIdentity", () => {
  it("names the dominant archetype as primary", () => {
    const id = computeBuildIdentity(counts({ lock: 4, freeze: 2, bank: 1 }));
    expect(id.primary).toBe("lock");
    expect(id.secondary).toBe("freeze");
  });

  it("is a Generalist when nothing reaches the minimum lean", () => {
    const id = computeBuildIdentity(counts({ lock: 1, bank: 1, tempo: 1 }));
    expect(id.primary).toBeNull();
    expect(id.secondary).toBeNull();
  });

  it("has a primary but no secondary when only one tag leans", () => {
    const id = computeBuildIdentity(counts({ safety: 5, risk: 1 }));
    expect(id.primary).toBe("safety");
    expect(id.secondary).toBeNull();
  });

  it("breaks count ties deterministically by archetype order", () => {
    // lock precedes freeze in TAG_ORDER, so equal counts rank lock first.
    const id = computeBuildIdentity(counts({ freeze: 3, lock: 3 }));
    expect(id.primary).toBe("lock");
    expect(id.secondary).toBe("freeze");
  });

  it("handles an empty run", () => {
    const id = computeBuildIdentity(new Map());
    expect(id.primary).toBeNull();
    expect(id.secondary).toBeNull();
  });

  it("respects the exported minimum-lean constant", () => {
    const exactlyAtMin = computeBuildIdentity(counts({ tempo: BUILD_IDENTITY_MIN_COUNT }));
    expect(exactlyAtMin.primary).toBe("tempo");
  });
});

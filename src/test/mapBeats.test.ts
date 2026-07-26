import { describe, it, expect } from "vitest";
import { tickMapBeats } from "@/lib/physics/mapBeats";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig, MapBeat } from "@/types/level";

function makeGame(overrides: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: null,
    activePlaySeconds: 0,
    firedBeats: [],
    beatSpeedMult: 1,
    destructibles: [],
    pendingDestroys: [],
    balls: [],
    ...overrides,
  } as unknown as CanvasGameState;
}

const level = (beats: MapBeat[]): LevelConfig => ({ beats } as unknown as LevelConfig);

describe("tickMapBeats", () => {
  it("does nothing with no beats", () => {
    const g = makeGame({ activePlaySeconds: 100 });
    expect(() => tickMapBeats(g, {} as LevelConfig, 5)).not.toThrow();
    expect(g.firedBeats).toEqual([]);
  });

  it("fires a time beat once when the threshold is crossed", () => {
    const g = makeGame({ activePlaySeconds: 5 });
    const lv = level([{ id: "b1", atSeconds: 5, speedSpike: 0.5 }]);

    tickMapBeats(g, lv, 5);
    expect(g.firedBeats).toContain("b1");
    expect(g.beatSpeedMult).toBeCloseTo(1.5);

    // Re-ticking must not re-apply the effect.
    tickMapBeats(g, lv, 5);
    expect(g.beatSpeedMult).toBeCloseTo(1.5);
    expect(g.firedBeats.filter(id => id === "b1")).toHaveLength(1);
  });

  it("does not fire before its threshold", () => {
    const g = makeGame({ activePlaySeconds: 3 });
    tickMapBeats(g, level([{ id: "b1", atSeconds: 5, speedSpike: 0.5 }]), 5);
    expect(g.firedBeats).toEqual([]);
    expect(g.beatSpeedMult).toBe(1);
  });

  it("does not fire a space beat while the board is full (100% remaining)", () => {
    // spaceGrid null => remaining treated as 100.
    const g = makeGame({ activePlaySeconds: 999 });
    tickMapBeats(g, level([{ id: "s1", atSpaceRemaining: 40, spawnAdds: 3 }]), 5);
    expect(g.firedBeats).toEqual([]);
  });

  it("force-breaks a destructible by id and queues it for processing", () => {
    const gate = { id: "gate", destroyed: false, hits: 0, maxHits: 3 };
    const g = makeGame({
      activePlaySeconds: 10,
      destructibles: [gate] as unknown as CanvasGameState["destructibles"],
    });
    tickMapBeats(g, level([{ id: "b2", atSeconds: 1, breakId: "gate" }]), 5);
    expect(gate.destroyed).toBe(true);
    expect(gate.hits).toBe(3);
    expect(g.pendingDestroys).toHaveLength(1);
  });

  it("is a safe no-op when breakId targets a missing/destroyed object", () => {
    const g = makeGame({ activePlaySeconds: 10 });
    tickMapBeats(g, level([{ id: "b3", atSeconds: 1, breakId: "nope" }]), 5);
    expect(g.pendingDestroys).toHaveLength(0);
    expect(g.firedBeats).toContain("b3"); // still marked fired (one-shot)
  });

  it("a beat with no threshold never fires", () => {
    const g = makeGame({ activePlaySeconds: 999 });
    tickMapBeats(g, level([{ id: "b4", speedSpike: 1 }]), 5);
    expect(g.firedBeats).toEqual([]);
    expect(g.beatSpeedMult).toBe(1);
  });
});

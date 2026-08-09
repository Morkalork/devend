import { describe, it, expect } from "vitest";
import { tickMapBeats } from "@/lib/physics/mapBeats";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig, MapBeat } from "@/types/level";
import { createSpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";

function makeGame(overrides: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: null,
    activePlaySeconds: 0,
    firedBeats: [],
    warnedBeats: [],
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

  it("telegraphs a time beat ahead of firing (leadMs), without firing early", () => {
    const g = makeGame({ activePlaySeconds: 23 });
    const warns: string[] = [];
    const lv = level([{ id: "crunch", atSeconds: 24, speedSpike: 0.2, announce: "game.beatCrunchTime", leadMs: 2000 }]);

    // 23s: inside the 2s lead window (>= 22), before the 24s effect.
    tickMapBeats(g, lv, 5, a => warns.push(a));
    expect(warns).toEqual(["game.beatCrunchTime"]);
    expect(g.warnedBeats).toContain("crunch");
    expect(g.firedBeats).toEqual([]);        // not fired yet
    expect(g.beatSpeedMult).toBe(1);

    // Re-tick still before 24s: warning must not repeat.
    tickMapBeats(g, lv, 5, a => warns.push(a));
    expect(warns).toHaveLength(1);

    // Reach 24s: the effect fires.
    g.activePlaySeconds = 24;
    tickMapBeats(g, lv, 5, a => warns.push(a));
    expect(g.firedBeats).toContain("crunch");
    expect(g.beatSpeedMult).toBeCloseTo(1.2);
    expect(warns).toHaveLength(1);           // still only one warning
  });

  it("does not telegraph a beat without an announce label", () => {
    const g = makeGame({ activePlaySeconds: 24 });
    const warns: string[] = [];
    tickMapBeats(g, level([{ id: "silent", atSeconds: 24, spawnAdds: 1 }]), 5, a => warns.push(a));
    expect(warns).toEqual([]);
    expect(g.warnedBeats).toEqual([]);
  });
});

describe("beat spawnAdds placement (issue: 'the ball duplicated')", () => {
  // A beat's add used to bud off the anchor's rim at 0.75 radii — the boss
  // placement, where a big boss visibly spits out a small minion. On a normal
  // map the anchor is an ordinary ball the SAME size, so an add appearing half
  // a radius away (with a random type that may match its colour) read as the
  // anchor cloning itself. Beat adds must arrive clear of every live ball.
  it("spawns a beat add well clear of the anchor, not on top of it", () => {
    const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
    const anchor = {
      id: "blue-1", typeId: "blue", state: "active", speed: 200, baseSpeed: 200,
      radius: 18, position: { x: 450, y: 450 }, velocity: { x: 100, y: 0 },
      regionId: "r1",
    } as unknown as CanvasGameState["balls"][number];

    const g = makeGame({
      spaceGrid: grid,
      activePlaySeconds: 10,
      balls: [anchor],
    });
    // Grid is fully active => 100% remaining, so drive it with a time beat.
    tickMapBeats(g, level([{ id: "standup", atSeconds: 5, spawnAdds: 1 }]), 5);

    expect(g.balls).toHaveLength(2);
    const added = g.balls[1];
    const dist = Math.hypot(added.position.x - anchor.position.x, added.position.y - anchor.position.y);
    // Two radii would still visually overlap; three is the placement floor.
    // Epsilon because the placement lands exactly ON the threshold and the trig
    // that gets it there can leave it a float hair short (53.999... vs 54).
    expect(dist).toBeGreaterThanOrEqual(anchor.radius * 3 - 1e-9);
  });
});

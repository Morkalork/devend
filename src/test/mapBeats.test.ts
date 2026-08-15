import { describe, it, expect } from "vitest";
import { tickMapBeats, beatEffectLines, type BeatEffectLine } from "@/lib/physics/mapBeats";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig, MapBeat } from "@/types/level";
import { createSpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

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

/**
 * A space beat is crossed by the player's own cut, so its warning used to fire
 * in the SAME tick as its effect: the banner appeared at the top of the screen
 * at the instant the ball appeared mid-board, while the player was watching
 * their fence. map.yml calls level 2's standup beat "a banner so it is never an
 * ambush"; simultaneous is an ambush.
 *
 * The lead runs on activePlaySeconds, so a pause or a hold cannot eat it.
 */
describe("a telegraphed space beat warns BEFORE it lands", () => {
  const spaceBeat = (): MapBeat => ({
    id: "standup", atSpaceRemaining: 60, spawnAdds: 1, announce: "game.beatStandup",
  });

  /**
   * A game reporting 50% space remaining, i.e. already past a 60% threshold.
   * The cells stay open so the placement search has somewhere to work; only the
   * counter getRemainingPercent reads is moved.
   */
  function halfCaptured(activePlaySeconds = 0) {
    const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
    grid.activeCount = Math.floor(grid.initialActiveCount * 0.5);
    return makeGame({
      spaceGrid: grid,
      activePlaySeconds,
      balls: [{
        id: "blue-1", typeId: "blue", state: "active", speed: 200, baseSpeed: 200,
        radius: 18, position: { x: 450, y: 800 }, velocity: { x: 100, y: 0 }, regionId: "r1",
      } as unknown as CanvasGameState["balls"][number]],
    });
  }

  it("shows the banner on the cut that crosses the threshold", () => {
    const g = halfCaptured();
    const warns: string[] = [];
    tickMapBeats(g, level([spaceBeat()]), 5, a => warns.push(a));
    expect(warns).toEqual(["game.beatStandup"]);
  });

  it("does NOT spawn the ball in that same tick", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    expect(g.balls).toHaveLength(1);
    expect(g.pendingBeats).toHaveLength(1);
  });

  it("spawns it once the telegraph has had its lead", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    expect(g.balls).toHaveLength(1);

    g.activePlaySeconds = 1.6; // default leadMs
    tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    expect(g.balls).toHaveLength(2);
    expect(g.pendingBeats).toHaveLength(0);
  });

  it("honours a custom leadMs", () => {
    const beat: MapBeat = { ...spaceBeat(), leadMs: 3000 };
    const g = halfCaptured();
    tickMapBeats(g, level([beat]), 5, () => {});

    g.activePlaySeconds = 2.9;
    tickMapBeats(g, level([beat]), 5, () => {});
    expect(g.balls).toHaveLength(1);

    g.activePlaySeconds = 3.1;
    tickMapBeats(g, level([beat]), 5, () => {});
    expect(g.balls).toHaveLength(2);
  });

  it("holds the ball back for as long as play is paused", () => {
    // activePlaySeconds does not advance while paused, so ticking many frames
    // must not release the beat early.
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    for (let frame = 0; frame < 200; frame++) tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    expect(g.balls).toHaveLength(1);
  });

  it("fires once, not once per frame after it comes due", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    g.activePlaySeconds = 5;
    for (let frame = 0; frame < 10; frame++) tickMapBeats(g, level([spaceBeat()]), 5, () => {});
    expect(g.balls).toHaveLength(2);
  });

  /**
   * A beat with nothing to announce has no telegraph to wait for, so it must
   * still land at once — the lead exists to give the banner time, not to delay
   * effects on principle.
   */
  it("does not delay a beat that has no banner", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([{ id: "silent", atSpaceRemaining: 60, spawnAdds: 1 }]), 5);
    expect(g.balls).toHaveLength(2);
    expect(g.pendingBeats).toHaveLength(0);
  });

  it("does not delay a time beat, which already warned early", () => {
    const g = halfCaptured(24);
    tickMapBeats(g, level([{ id: "t", atSeconds: 24, spawnAdds: 1, announce: "x" }]), 5, () => {});
    expect(g.balls).toHaveLength(2);
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

/**
 * The telegraph lead only helps a beat that HAS a telegraph. An extra ball
 * arriving with no banner at all is the ambush in its purest form, so the rule
 * is enforced against the shipped maps rather than left to reviewer memory.
 */
describe("every ball-spawning beat in map.yml announces itself", () => {
  const MAP = yaml.load(
    readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
  ) as { levels: { id: string; beats?: MapBeat[] }[] };

  it("carries an announce wherever spawnAdds is set", () => {
    const silent = MAP.levels.flatMap(lvl =>
      (lvl.beats ?? [])
        .filter(b => (b.spawnAdds ?? 0) > 0 && !b.announce)
        .map(b => `${lvl.id}/${b.id}`),
    );
    expect(silent).toEqual([]);
  });
});

/**
 * The banner used to show only a flavour name ("Standup Interrupt"), which
 * telegraphs that something is coming but not WHAT. An extra ball therefore
 * still arrived unexplained even once the lead time existed. The consequence is
 * derived from the beat rather than written per map, so a beat added later
 * cannot ship without one.
 */
describe("a beat says what it is about to do", () => {
  it("names the arriving ball, singular or plural", () => {
    expect(beatEffectLines({ id: "b", spawnAdds: 1 })).toEqual([
      { key: "game.beatEffectBalls", values: { count: 1 } },
    ]);
    expect(beatEffectLines({ id: "b", spawnAdds: 3 })[0].values).toEqual({ count: 3 });
  });

  it("names a speed spike as a percentage", () => {
    expect(beatEffectLines({ id: "b", speedSpike: 0.2 })).toEqual([
      { key: "game.beatEffectSpeed", values: { percent: 20 } },
    ]);
  });

  it("names a forced break", () => {
    expect(beatEffectLines({ id: "b", breakId: "gate" })).toEqual([
      { key: "game.beatEffectBreak" },
    ]);
  });

  it("lists every effect a beat combines", () => {
    const lines = beatEffectLines({ id: "b", spawnAdds: 2, speedSpike: 0.5, breakId: "g" });
    expect(lines.map(l => l.key)).toEqual([
      "game.beatEffectBalls", "game.beatEffectSpeed", "game.beatEffectBreak",
    ]);
  });

  it("says nothing about a beat with no effect", () => {
    expect(beatEffectLines({ id: "b" })).toEqual([]);
    expect(beatEffectLines({ id: "b", spawnAdds: 0, speedSpike: 0 })).toEqual([]);
  });

  it("hands the effects to the telegraph, alongside the flavour name", () => {
    const g = makeGame({ activePlaySeconds: 24 });
    const seen: { announce: string; effects: BeatEffectLine[] }[] = [];
    tickMapBeats(
      g,
      level([{ id: "crunch", atSeconds: 24, speedSpike: 0.2, announce: "game.beatCrunchTime" }]),
      5,
      (announce, effects) => seen.push({ announce, effects }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].announce).toBe("game.beatCrunchTime");
    expect(seen[0].effects).toEqual([{ key: "game.beatEffectSpeed", values: { percent: 20 } }]);
  });
});

/** Every key the banner can render must exist in every locale, or a player on
 *  Spanish or Swedish reads a raw i18n key at the moment of the ambush. */
describe("the beat copy exists in every language", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  const KEYS = [
    "beatEffectBalls_one", "beatEffectBalls_other", "beatEffectSpeed", "beatEffectBreak",
    "beatStandup", "beatCrunchTime",
  ];

  for (const locale of LOCALES) {
    it(`${locale} has them all`, () => {
      const game = (JSON.parse(
        readFileSync(resolve(__dirname, `../i18n/locales/${locale}.json`), "utf8"),
      ) as { game: Record<string, string> }).game;
      for (const key of KEYS) expect(game[key], `${locale}.game.${key}`).toBeTruthy();
      // No em-dashes in UI text (CLAUDE.md).
      for (const key of KEYS) expect(game[key]).not.toContain("\u2014");
    });
  }
});

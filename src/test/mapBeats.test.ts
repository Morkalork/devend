import { describe, it, expect } from "vitest";
import {
  tickMapBeats, beatEffectLines, beatSpawnCount, DUPLICATION_MIN_LEVEL,
  type BeatEffectLine,
} from "@/lib/physics/mapBeats";
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
    tickMapBeats(g, level([{ id: "s1", atSpaceRemaining: 40, spawnAdds: 3 }]), 12);
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
    tickMapBeats(g, level([{ id: "silent", atSeconds: 24, spawnAdds: 1 }]), 12, a => warns.push(a));
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
  /** Level 12, the map that carries the Reorg beat. */
  const LEVEL = DUPLICATION_MIN_LEVEL + 1;
  const spaceBeat = (): MapBeat => ({
    id: "reorg", atSpaceRemaining: 60, spawnAdds: 1, announce: "game.beatReorg",
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
    tickMapBeats(g, level([spaceBeat()]), LEVEL, a => warns.push(a));
    expect(warns).toEqual(["game.beatReorg"]);
  });

  it("does NOT spawn the ball in that same tick", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    expect(g.balls).toHaveLength(1);
    expect(g.pendingBeats).toHaveLength(1);
  });

  it("spawns it once the telegraph has had its lead", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    expect(g.balls).toHaveLength(1);

    g.activePlaySeconds = 1.6; // default leadMs
    tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    expect(g.balls).toHaveLength(2);
    expect(g.pendingBeats).toHaveLength(0);
  });

  it("honours a custom leadMs", () => {
    const beat: MapBeat = { ...spaceBeat(), leadMs: 3000 };
    const g = halfCaptured();
    tickMapBeats(g, level([beat]), LEVEL, () => {});

    g.activePlaySeconds = 2.9;
    tickMapBeats(g, level([beat]), LEVEL, () => {});
    expect(g.balls).toHaveLength(1);

    g.activePlaySeconds = 3.1;
    tickMapBeats(g, level([beat]), LEVEL, () => {});
    expect(g.balls).toHaveLength(2);
  });

  it("holds the ball back for as long as play is paused", () => {
    // activePlaySeconds does not advance while paused, so ticking many frames
    // must not release the beat early.
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    for (let frame = 0; frame < 200; frame++) tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    expect(g.balls).toHaveLength(1);
  });

  it("fires once, not once per frame after it comes due", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    g.activePlaySeconds = 5;
    for (let frame = 0; frame < 10; frame++) tickMapBeats(g, level([spaceBeat()]), LEVEL, () => {});
    expect(g.balls).toHaveLength(2);
  });

  /**
   * A beat with nothing to announce has no telegraph to wait for, so it must
   * still land at once — the lead exists to give the banner time, not to delay
   * effects on principle.
   */
  it("does not delay a beat that has no banner", () => {
    const g = halfCaptured();
    tickMapBeats(g, level([{ id: "silent", atSpaceRemaining: 60, spawnAdds: 1 }]), LEVEL);
    expect(g.balls).toHaveLength(2);
    expect(g.pendingBeats).toHaveLength(0);
  });

  it("does not delay a time beat, which already warned early", () => {
    const g = halfCaptured(24);
    tickMapBeats(g, level([{ id: "t", atSeconds: 24, spawnAdds: 1, announce: "x" }]), LEVEL, () => {});
    expect(g.balls).toHaveLength(2);
  });
});

/**
 * A beat's extra ball is a CELL DIVISION, the level-10 boss's move: the anchor
 * stops dead and swells, a bud grows out of its body, and it pinches off.
 *
 * The earlier attempt at this had the ball arrive somewhere else on the board
 * entirely, to stop it reading as a split. It reads as a split because it IS
 * one, so this commits to the reading and animates it, and gates it to level
 * 11+ so the boss has taught the visual before an ordinary map borrows it.
 */
describe("a beat's add divides out of a ball, boss-style", () => {
  const LEVEL = DUPLICATION_MIN_LEVEL + 1;

  function withAnchor() {
    const anchor = {
      id: "blue-1", typeId: "blue", state: "active", speed: 200, baseSpeed: 200,
      radius: 18, position: { x: 450, y: 450 }, velocity: { x: 100, y: 0 },
      regionId: "r1",
    } as unknown as CanvasGameState["balls"][number];
    const g = makeGame({
      spaceGrid: createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15),
      activePlaySeconds: 10,
      balls: [anchor],
    });
    return { g, anchor };
  }

  /** Grid is fully active => 100% remaining, so drive it with a time beat. */
  const fire = (g: CanvasGameState, levelNumber = LEVEL) =>
    tickMapBeats(g, level([{ id: "reorg", atSeconds: 5, spawnAdds: 1 }]), levelNumber);

  it("is born attached to the ball it came out of", () => {
    const { g, anchor } = withAnchor();
    fire(g);

    expect(g.balls).toHaveLength(2);
    const bud = g.balls[1];
    expect(bud.birthParentId).toBe(anchor.id);
    expect(bud.regionId).toBe(anchor.regionId);
  });

  it("starts as a speck and knows the size to grow into", () => {
    const { g, anchor } = withAnchor();
    fire(g);

    const bud = g.balls[1];
    expect(bud.bornRadius).toBe(anchor.radius);
    expect(bud.radius).toBeLessThan(anchor.radius / 2);
    expect(bud.bornAt).toBeGreaterThan(0);
  });

  it("sits on the parent's rim, which is the whole point of the read", () => {
    const { g, anchor } = withAnchor();
    fire(g);

    const bud = g.balls[1];
    const dist = Math.hypot(bud.position.x - anchor.position.x, bud.position.y - anchor.position.y);
    expect(dist).toBeCloseTo(anchor.radius * 0.85, 5);
    // ...and it heads outward along the direction it emerged, not back through.
    const dot = ((bud.position.x - anchor.position.x) / dist) * (bud.birthDirX ?? 0)
      + ((bud.position.y - anchor.position.y) / dist) * (bud.birthDirY ?? 0);
    expect(dot).toBeCloseTo(1, 5);
  });

  it("stops the parent dead and swells it while it divides", () => {
    const { g, anchor } = withAnchor();
    fire(g);

    expect(anchor.splitAnimAt).toBeGreaterThan(0);
    expect(anchor.bornSplashAt).toBeGreaterThan(0);
  });
});

/**
 * Duplication is a level-11+ idea. On level 2 it was a ball becoming two with
 * nothing having taught what that means, which is exactly how it was reported.
 */
describe("duplication is gated to level 11 and up", () => {
  const beat = { id: "reorg", atSeconds: 5, spawnAdds: 1, announce: "game.beatReorg" };

  const gameAt = () => makeGame({
    spaceGrid: createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15),
    activePlaySeconds: 10,
    balls: [{
      id: "blue-1", typeId: "blue", state: "active", speed: 200, baseSpeed: 200,
      radius: 18, position: { x: 450, y: 450 }, velocity: { x: 100, y: 0 }, regionId: "r1",
    } as unknown as CanvasGameState["balls"][number]],
  });

  it("counts nothing below the gate, the full count at or above it", () => {
    expect(beatSpawnCount(beat, 2)).toBe(0);
    expect(beatSpawnCount(beat, DUPLICATION_MIN_LEVEL - 1)).toBe(0);
    expect(beatSpawnCount(beat, DUPLICATION_MIN_LEVEL)).toBe(1);
    expect(beatSpawnCount({ ...beat, spawnAdds: 3 }, 30)).toBe(3);
  });

  it("spawns no ball on an early map, even if a map asks for one", () => {
    for (const levelNumber of [2, 5, 10]) {
      const g = gameAt();
      tickMapBeats(g, level([beat]), levelNumber, () => {});
      g.activePlaySeconds = 99;
      tickMapBeats(g, level([beat]), levelNumber, () => {});
      expect(g.balls, `level ${levelNumber}`).toHaveLength(1);
    }
  });

  it("spawns from level 11", () => {
    const g = gameAt();
    tickMapBeats(g, level([beat]), DUPLICATION_MIN_LEVEL, () => {});
    g.activePlaySeconds = 99;
    tickMapBeats(g, level([beat]), DUPLICATION_MIN_LEVEL, () => {});
    expect(g.balls).toHaveLength(2);
  });

  /** The banner must not promise a ball the gate is going to swallow. */
  it("does not announce a ball that the gate blocks", () => {
    expect(beatEffectLines(beat, 2)).toEqual([]);
    expect(beatEffectLines(beat, DUPLICATION_MIN_LEVEL)).toEqual([
      { key: "game.beatEffectBalls", values: { count: 1 } },
    ]);
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
  ) as { levels: { id: string; level: number; beats?: MapBeat[] }[] };

  it("carries an announce wherever spawnAdds is set", () => {
    const silent = MAP.levels.flatMap(lvl =>
      (lvl.beats ?? [])
        .filter(b => (b.spawnAdds ?? 0) > 0 && !b.announce)
        .map(b => `${lvl.id}/${b.id}`),
    );
    expect(silent).toEqual([]);
  });

  /**
   * The code gate makes an early duplication beat a no-op; this makes it a
   * build failure. A beat that silently does nothing is worse than one that
   * does the wrong thing, because nothing on screen or in the file says so.
   */
  it("puts no duplication beat on a map below the gate", () => {
    const early = MAP.levels
      .filter(lvl => (lvl.level ?? 0) < DUPLICATION_MIN_LEVEL)
      .flatMap(lvl =>
        (lvl.beats ?? [])
          .filter(b => (b.spawnAdds ?? 0) > 0)
          .map(b => `${lvl.id}/${b.id} (level ${lvl.level})`),
      );
    expect(early).toEqual([]);
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
    expect(beatEffectLines({ id: "b", spawnAdds: 1 }, 30)).toEqual([
      { key: "game.beatEffectBalls", values: { count: 1 } },
    ]);
    expect(beatEffectLines({ id: "b", spawnAdds: 3 }, 30)[0].values).toEqual({ count: 3 });
  });

  it("names a speed spike as a percentage", () => {
    expect(beatEffectLines({ id: "b", speedSpike: 0.2 }, 30)).toEqual([
      { key: "game.beatEffectSpeed", values: { percent: 20 } },
    ]);
  });

  it("names a forced break", () => {
    expect(beatEffectLines({ id: "b", breakId: "gate" }, 30)).toEqual([
      { key: "game.beatEffectBreak" },
    ]);
  });

  it("lists every effect a beat combines", () => {
    const lines = beatEffectLines({ id: "b", spawnAdds: 2, speedSpike: 0.5, breakId: "g" }, 30);
    expect(lines.map(l => l.key)).toEqual([
      "game.beatEffectBalls", "game.beatEffectSpeed", "game.beatEffectBreak",
    ]);
  });

  it("says nothing about a beat with no effect", () => {
    expect(beatEffectLines({ id: "b" }, 30)).toEqual([]);
    expect(beatEffectLines({ id: "b", spawnAdds: 0, speedSpike: 0 }, 30)).toEqual([]);
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
    "beatReorg", "beatCrunchTime",
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

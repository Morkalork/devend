/**
 * The feature schedule: which mechanic belongs to which act, and how hard each
 * map is meant to be.
 *
 * The problem this guards is not a bug, it is drift. The ladder had spent its
 * entire vocabulary by level 20 and then coasted: `dataStream`, `charge`,
 * `threadLockRequired` and `gravityWell` appeared on exactly ONE map each,
 * `mover` carried eight of the ten maps in 21-30, and the difficulty curve
 * INVERTED, with levels 31-34 asking for 70-72% of the board when level 15 had
 * asked for 95%. Every one of those was authored in good faith, one map at a
 * time, which is precisely why a per-map review never caught it.
 *
 * So these assertions are about the shape of the whole ladder, which no
 * individual map can be responsible for. They are deliberately cheap: they read
 * map.yml the way gravityWells.test.ts already does.
 *
 * MIGRATED_ACTS is the honest part. Acts are being rewritten one at a time, so
 * the spine is only claimed for the acts that have actually been done. The list
 * may only GROW, and an act is added to it when its maps are authored, never to
 * make a failure go away.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { LevelConfig } from "@/types/level";
import { TILT_MIN_LEVEL } from "@/lib/boardTiltRoll";
import { PROCEDURAL_MIN_LEVEL } from "@/lib/mapSlots";
import { ROTATION_MIN_LEVEL } from "@/lib/mapRotation";

const MAPS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as { levels: LevelConfig[] }).levels;

/** Acts, by the boss that closes each one. */
const ACTS = [
  { name: "I Onboarding", from: 1, to: 10 },
  { name: "II The Sprint", from: 11, to: 20 },
  { name: "III Legacy Code", from: 21, to: 30 },
  { name: "IV Crunch", from: 31, to: 35 },
] as const;

/** Acts whose maps have been authored to the schedule. May only grow. */
const MIGRATED_ACTS: string[] = ["III Legacy Code"];

const BOSS_LEVELS = [10, 20, 30, 35];

const inAct = (a: { from: number; to: number }) =>
  MAPS.filter(l => l.level >= a.from && l.level <= a.to);

/** One entry per level number (variants share a level, so take the first). */
const byLevel = (list: LevelConfig[]) => {
  const seen = new Map<number, LevelConfig>();
  for (const l of list) if (!seen.has(l.level)) seen.set(l.level, l);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]);
};

const has = {
  well: (l: LevelConfig) => (l.gravityWells?.length ?? 0) > 0,
  stream: (l: LevelConfig) => !!l.dataStream,
  charge: (l: LevelConfig) => (l.charges?.length ?? 0) > 0,
  circuit: (l: LevelConfig) => !!l.circuit,
  phasing: (l: LevelConfig) => (l.entities ?? []).some(e => "isPhasing" in e && e.isPhasing),
  chest: (l: LevelConfig) => (l.entities ?? []).some(e => "chest" in e && e.chest),
  wip: (l: LevelConfig) => (l.fenceBudget ?? 0) > 0,
  area: (l: LevelConfig) => (l.coloredAreas?.length ?? 0) > 0,
  slots: (l: LevelConfig) => (l.slots?.length ?? 0) > 0,
};

describe("the ladder is sane at all", () => {
  it("has one entry per level, with variants sharing a number", () => {
    const levels = new Set(MAPS.map(l => l.level));
    for (let n = 1; n <= 35; n++) expect(levels.has(n), `level ${n} missing`).toBe(true);
  });

  it("keeps every id unique", () => {
    const ids = MAPS.map(l => l.id);
    expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
  });

  it("closes each act with a boss", () => {
    for (const n of BOSS_LEVELS) {
      const boss = MAPS.filter(l => l.level === n).find(l => l.boss);
      expect(boss, `level ${n} should be a boss`).toBeTruthy();
    }
  });
});

/**
 * A mechanic debuting before its code gate is the failure mode that hides best:
 * nothing throws, the map simply never does the thing it was authored to do.
 * Wells before TILT_MIN_LEVEL were the live example, ten levels of tilt rolls
 * that could only ever produce a rigid rotation with nothing to break.
 */
describe("no mechanic debuts before its code gate", () => {
  const firstLevelWith = (p: (l: LevelConfig) => boolean) => {
    const hits = MAPS.filter(p).map(l => l.level);
    return hits.length ? Math.min(...hits) : null;
  };

  it("gates gravity wells at the tilt gate", () => {
    const first = firstLevelWith(has.well);
    expect(first, "no map has a well").not.toBeNull();
    expect(first!).toBeGreaterThanOrEqual(TILT_MIN_LEVEL);
  });

  it("gates procedural slots at the procedural gate", () => {
    const first = firstLevelWith(has.slots);
    if (first !== null) expect(first).toBeGreaterThanOrEqual(PROCEDURAL_MIN_LEVEL);
  });

  it("keeps an authored tilt chance on a map that can actually tilt", () => {
    for (const l of MAPS) {
      if (l.tiltChance == null) continue;
      expect(l.tiltChance, `${l.id}: chance out of range`).toBeGreaterThanOrEqual(0);
      expect(l.tiltChance, `${l.id}: chance out of range`).toBeLessThanOrEqual(1);
      expect(l.level, `${l.id}: authors a tilt below the gate`)
        .toBeGreaterThanOrEqual(TILT_MIN_LEVEL);
      expect(has.well(l), `${l.id}: a tilt with no well changes nothing`).toBe(true);
    }
  });

  it("leaves the tutorial band unrotated", () => {
    expect(ROTATION_MIN_LEVEL).toBeGreaterThan(3);
  });
});

/**
 * A mechanic that appears once is a curiosity, not a mechanic. The schedule
 * gives each headline mechanic several beats (Meet / Use / Fight / Break), and
 * the cheapest check on that is simply how many maps carry it.
 */
describe("headline mechanics get developed, not just introduced", () => {
  const BEATS: [string, (l: LevelConfig) => boolean, number][] = [
    ["gravity wells", has.well, 4],
    ["dataStream", has.stream, 2],
    ["colored areas", has.area, 4],
  ];

  for (const [name, pred, want] of BEATS) {
    it(`${name} appear on at least ${want} maps`, () => {
      const on = MAPS.filter(pred).map(l => l.level);
      expect(new Set(on).size, `${name} on levels ${on.join(",") || "none"}`)
        .toBeGreaterThanOrEqual(want);
    });
  }

  /** Act III existed to be the act with nothing of its own. */
  it("gives act III mechanics beyond movers and mirrors", () => {
    const act3 = inAct({ from: 21, to: 29 });
    const owned = [has.well, has.stream, has.charge, has.phasing]
      .filter(p => act3.some(p)).length;
    expect(owned, "act III should carry gravity, stream, charge and phasing")
      .toBeGreaterThanOrEqual(4);
  });
});

/**
 * The difficulty spine. Space demanded (100 - sizeThreshold) climbs within an
 * act and may only fall on the map right after a boss, which is the breather.
 * The inversion this catches was real and large: 31-34 sat at 70-72% while 15
 * and 19 sat at 95%.
 */
describe("the difficulty spine", () => {
  const space = (l: LevelConfig) => 100 - l.sizeThreshold;

  for (const act of ACTS) {
    const migrated = MIGRATED_ACTS.includes(act.name);
    const label = migrated ? "" : " (not yet migrated)";

    it.skipIf(!migrated)(`act ${act.name} climbs${label}`, () => {
      const rows = byLevel(inAct(act)).filter(([n]) => !BOSS_LEVELS.includes(n));
      let prev = -Infinity;
      for (const [n, l] of rows) {
        const s = space(l);
        // The first map of an act is the post-boss breather, so it may sit
        // below the previous act's peak; after that the act only climbs.
        if (n !== act.from) {
          expect(s, `level ${n} drops below level ${n - 1}`).toBeGreaterThanOrEqual(prev);
        }
        prev = s;
      }
    });

    /**
     * `expectedCuts` is NOT monotone by design, and should not be forced to be:
     * it says how many seals a map's topology is built around, so a map of
     * fewer, larger chambers legitimately wants fewer cuts than its neighbour.
     * Demanding a rising staircase would push map design around to satisfy a
     * test, which is backwards.
     *
     * What must never happen is a COLLAPSE, which is what the ladder actually
     * did: 9 cuts at level 19 and then 4 at levels 31-33. So the rule is that a
     * map may sit at most one cut below its act's high-water mark.
     */
    it.skipIf(!migrated)(`act ${act.name} never collapses its cut count${label}`, () => {
      const rows = byLevel(inAct(act)).filter(([n]) => !BOSS_LEVELS.includes(n));
      let high = -Infinity;
      for (const [n, l] of rows) {
        high = Math.max(high, l.expectedCuts);
        expect(l.expectedCuts, `level ${n} sits ${high - l.expectedCuts} cuts below the act's peak of ${high}`)
          .toBeGreaterThanOrEqual(high - 1);
      }
    });
  }

  /** Guard against the whole block passing because nothing was checked. */
  it("is actually checking a migrated act", () => {
    expect(MIGRATED_ACTS.length).toBeGreaterThan(0);
    for (const name of MIGRATED_ACTS) {
      expect(ACTS.some(a => a.name === name), `unknown act ${name}`).toBe(true);
    }
  });
});

/**
 * Necks a ball can actually get through.
 *
 * A ball is 36 world units across and an enlarged one (the level-11 gift) is 47,
 * so a gap between two collinear wall stubs falls into one of three bands:
 *
 *   <= 12   a seam. A chest cover sitting on its chest, two pieces of one
 *           structure. Not a passage, and nobody reads it as one.
 *   >= 60   a real neck. Both ball sizes pass with room to time a cut.
 *   between the two: the trap. Wide enough to LOOK like a way through and
 *           narrow enough that the ball never takes it, so the space behind it
 *           is neither reachable nor sealable. It also silently changes meaning
 *           when the big-ball gift rolls.
 *
 * This was not hypothetical: authoring act I left a 26-unit slot beside level
 * 9's pay shelf and a 40-unit alcove mouth on level 3, the second of which a
 * normal ball squeezed through and an enlarged one could not. Neither is
 * visible by eye in YAML, and neither would fail any other test.
 */
describe("every gap is a seam or a neck, never in between", () => {
  const BALL = 36;         // BASE_BALL_RADIUS * 2
  const SEAM_MAX = 12;     // below this nothing reads as a way through
  const NECK_MIN = 60;     // Code Freeze's proven corner gap

  /**
   * Maps not yet migrated to the feature schedule. May only SHRINK: an entry
   * comes off when its act is authored, and none is ever added to silence a
   * new map.
   */
  const UNMIGRATED: string[] = ["level-32"];

  type Rect = { id: string; x0: number; x1: number; y0: number; y1: number };

  const rectsOf = (l: LevelConfig): Rect[] =>
    (l.entities ?? [])
      .filter(e => e.shape === "rect" && e.kind === "wall")
      .map(e => {
        const r = e as unknown as { id: string; x: number; y: number; width: number; height: number };
        return { id: r.id, x0: r.x, x1: r.x + r.width, y0: r.y, y1: r.y + r.height };
      });

  /** Gaps between stubs that line up, i.e. the places a ball could try to pass. */
  const gapsIn = (l: LevelConfig): { gap: number; between: string }[] => {
    const rs = rectsOf(l);
    const out: { gap: number; between: string }[] = [];
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (xOverlap > 0) {
          const g = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
          if (g > 0) out.push({ gap: g, between: `${a.id}|${b.id}` });
        }
        const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (yOverlap > 0) {
          const g = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
          if (g > 0) out.push({ gap: g, between: `${a.id}|${b.id}` });
        }
      }
    }
    return out;
  };

  it("leaves no gap a ball half-fits through", () => {
    const offenders: string[] = [];
    for (const l of MAPS) {
      if (UNMIGRATED.includes(l.id)) continue;
      for (const { gap, between } of gapsIn(l)) {
        if (gap > SEAM_MAX && gap < NECK_MIN) {
          offenders.push(`${l.id}: ${gap}u between ${between}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a neck wide enough for the enlarged ball too", () => {
    // Not merely wider than a plain ball: a neck that fits 36 but not 47 plays
    // differently depending on a gift roll the player did not ask for.
    expect(NECK_MIN).toBeGreaterThan(BALL);
    expect(NECK_MIN).toBeGreaterThanOrEqual(47);
  });

  it("is checking real maps, not an empty set", () => {
    const measured = MAPS.filter(l => !UNMIGRATED.includes(l.id))
      .reduce((n, l) => n + gapsIn(l).length, 0);
    expect(measured, "no gaps measured at all").toBeGreaterThan(10);
  });

  /** The exception list is a debt, so it has to be visible and finite. */
  it("names only maps that really are unmigrated", () => {
    for (const id of UNMIGRATED) {
      const l = MAPS.find(m => m.id === id);
      expect(l, `${id} is listed as unmigrated but does not exist`).toBeTruthy();
      expect(l!.level, `${id} is in a migrated act`).toBeGreaterThan(30);
    }
  });
});

/**
 * A telegraph that renders as `game.beatWellWakes` is worse than no telegraph:
 * the player gets a warning banner full of a variable name at the exact moment
 * the map is trying to be fair with them. i18n misses fail silently, so this is
 * the only place it would ever be caught.
 */
describe("every telegraph resolves in every language", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  const load = (loc: string) =>
    JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"));

  const announceKeys = (): string[] => {
    const found = new Set<string>();
    const walk = (o: unknown): void => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      for (const [k, v] of Object.entries(o)) {
        if (k === "announce" && typeof v === "string") found.add(v);
        else walk(v);
      }
    };
    walk(MAPS);
    return [...found];
  };

  it("resolves every announce key in map.yml", () => {
    const keys = announceKeys();
    expect(keys.length, "no announce keys found at all").toBeGreaterThan(0);
    for (const loc of LOCALES) {
      const dict = load(loc);
      for (const key of keys) {
        let cursor: unknown = dict;
        for (const part of key.split(".")) {
          cursor = (cursor as Record<string, unknown>)?.[part];
        }
        expect(typeof cursor, `${loc} is missing ${key}`).toBe("string");
      }
    }
  });
});

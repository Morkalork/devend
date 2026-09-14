/**
 * Motes: the air the light travels through (motes.ts, moteLayer.ts).
 *
 * A pool on a flat floor is a decal; what makes it read as a VOLUME is
 * something in between catching it. Three faces of one substrate - an ambient
 * field, a map's weather, and residue from things that break - because they
 * differ only in where a mote is born and how it moves.
 *
 * The rule everything else hangs off is that an unlit mote is INVISIBLE, not
 * merely dim. That is what makes the field honest (a speck you can see on an
 * unlit board is dirt on the screen, which is worse than no effect at all) and
 * it is also what makes it cheap enough to leave on.
 *
 * The performance shape is pinned here too, because it is the whole reason
 * this design looks the way it does: the per-mote cost must not scale with the
 * number of emitters on the board.
 */
import { describe, it, expect } from "vitest";
import {
  createMoteField, stepMotes, spawnResidue, MoteBins, lightAt, moteAlpha,
  binDims, moteRandom, clampWeather, refitMoteField,
  BIN_SIZE, WEATHER_MAX, MOTE_PEAK_ALPHA, MOTE_DARK_ALPHA,
  type MoteLight,
} from "@/lib/rendering/motes";

const BOX = { minX: 0, minY: 0, maxX: 900, maxY: 900 };
const field = (ambient = 40, residue = 10) =>
  createMoteField(BOX.minX, BOX.minY, BOX.maxX, BOX.maxY, ambient, residue);

const light = (over: Partial<MoteLight> = {}): MoteLight => ({
  x: 450, y: 450, reach: 100, intensity: 0.6, color: 0xff4d5a, ...over,
});

function bins(lights: MoteLight[], f = field()) {
  const { cols, rows } = binDims(f);
  const b = new MoteBins();
  b.rebuild(lights, f.minX, f.minY, cols, rows);
  return { b, cols, rows, f };
}

describe("an unlit mote is invisible, not dim", () => {
  it("gives nothing at all where no light reaches", () => {
    const { b, cols, rows, f } = bins([light()]);
    const far = lightAt(b, 50, 50, f.minX, f.minY, cols, rows);
    expect(far.level).toBe(0);
    expect(moteAlpha(f.motes[0], far.level)).toBe(MOTE_DARK_ALPHA);
    expect(MOTE_DARK_ALPHA).toBe(0);
  });

  it("brightens toward the middle of a pool and stops at its edge", () => {
    const { b, cols, rows, f } = bins([light()]);
    const mid = lightAt(b, 450, 450, f.minX, f.minY, cols, rows).level;
    const off = lightAt(b, 450, 520, f.minX, f.minY, cols, rows).level;
    const edge = lightAt(b, 450, 549, f.minX, f.minY, cols, rows).level;
    expect(mid).toBeGreaterThan(off);
    expect(off).toBeGreaterThan(edge);
    // Past the reach, nothing - the rim of a soft light must not get an edge.
    expect(lightAt(b, 450, 551, f.minX, f.minY, cols, rows).level).toBe(0);
  });

  it("never exceeds the peak however many lights pile up", () => {
    const many = Array.from({ length: 6 }, () => light());
    const { b, cols, rows, f } = bins(many);
    const lit = lightAt(b, 450, 450, f.minX, f.minY, cols, rows);
    expect(lit.level).toBeGreaterThan(1);
    expect(moteAlpha(f.motes[0], lit.level)).toBeLessThanOrEqual(MOTE_PEAK_ALPHA);
  });

  it("takes the light-weighted average colour, not whichever was last", () => {
    // A mote between a red ball and a blue one is the colour standing there
    // really is.
    const { b, cols, rows, f } = bins([
      light({ x: 400, y: 450, color: 0xff0000 }),
      light({ x: 500, y: 450, color: 0x0000ff }),
    ]);
    const c = lightAt(b, 450, 450, f.minX, f.minY, cols, rows).color;
    expect((c >> 16) & 255).toBeGreaterThan(40);
    expect(c & 255).toBeGreaterThan(40);
    expect((c >> 8) & 255).toBeLessThan(40);
  });
});

describe("the cost does not scale with the board", () => {
  it("puts an emitter only in the cells its reach touches", () => {
    // The whole design: a mote reads ONE cell, so the emitter does the
    // spreading. An emitter in every cell would be the naive version wearing
    // a grid's clothes.
    const f = field();
    const { cols, rows } = binDims(f);
    const b = new MoteBins();
    b.rebuild([light({ x: 60, y: 60, reach: 50 })], f.minX, f.minY, cols, rows);
    expect(b.at(0, 0)).toHaveLength(1);
    expect(b.at(4, 4)).toBeUndefined();
    expect(cols * BIN_SIZE).toBeGreaterThanOrEqual(900);
  });

  it("drops emitters that are too faint to matter before binning them", () => {
    const f = field();
    const { cols, rows } = binDims(f);
    const b = new MoteBins();
    b.rebuild([light({ intensity: 0.0005 })], f.minX, f.minY, cols, rows);
    expect(b.at(3, 3)).toBeUndefined();
  });

  it("reads nothing at all for a point off the board", () => {
    const { b, cols, rows, f } = bins([light()]);
    expect(lightAt(b, -50, 450, f.minX, f.minY, cols, rows).level).toBe(0);
    expect(lightAt(b, 450, 99999, f.minX, f.minY, cols, rows).level).toBe(0);
  });
});

describe("the ambient field", () => {
  it("drifts and wraps rather than respawning, so its cost never changes", () => {
    const f = field(8, 0);
    const m = f.motes[0];
    m.x = BOX.maxX - 1; m.y = 450; m.vx = 60; m.vy = 0;
    stepMotes(f, 0.5);
    expect(m.x).toBeGreaterThanOrEqual(BOX.minX);
    expect(m.x).toBeLessThan(BOX.maxX);
    expect(f.motes).toHaveLength(8);
  });

  it("is deterministic, so two devices show the same air", () => {
    const a = createMoteField(0, 0, 900, 900, 12, 0, 99);
    const b = createMoteField(0, 0, 900, 900, 12, 0, 99);
    expect(a.motes.map(m => [m.x, m.y])).toEqual(b.motes.map(m => [m.x, m.y]));
    expect(createMoteField(0, 0, 900, 900, 12, 0, 100).motes[0].x).not.toBe(a.motes[0].x);
  });

  it("spreads brightness across the field, because one value reads as texture", () => {
    const f = field(60, 0);
    const gains = f.motes.map(m => m.gain);
    expect(Math.max(...gains) - Math.min(...gains)).toBeGreaterThan(0.3);
  });

  it("survives a board that resizes under it", () => {
    const f = field(6, 0);
    refitMoteField(f, 0, 0, 400, 400);
    expect(() => stepMotes(f, 0.1)).not.toThrow();
    expect(f.maxX).toBe(400);
  });

  it("does nothing on a degenerate box rather than dividing by zero", () => {
    const f = createMoteField(0, 0, 0, 0, 4, 0);
    expect(() => stepMotes(f, 0.1)).not.toThrow();
  });
});

describe("weather", () => {
  it("pushes the whole field on a heading", () => {
    const still = field(4, 0);
    const blown = field(4, 0);
    for (const m of [...still.motes, ...blown.motes]) { m.vx = 0; m.vy = 0; }
    stepMotes(still, 1);
    stepMotes(blown, 1, 0, 20);
    expect(blown.motes[0].y - still.motes[0].y).toBeCloseTo(20, 6);
  });

  it("is clamped, because a gale competes with the balls for attention", () => {
    expect(clampWeather({ x: 9999, y: -9999 })).toEqual({ x: WEATHER_MAX, y: -WEATHER_MAX });
    expect(clampWeather({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("treats still air as absent, so a map that authors none costs nothing", () => {
    expect(clampWeather({ x: 0, y: 0 })).toBeUndefined();
    expect(clampWeather(undefined)).toBeUndefined();
    expect(clampWeather(null)).toBeUndefined();
    expect(clampWeather({ x: Number.NaN, y: Number.NaN })).toBeUndefined();
  });
});

describe("residue", () => {
  const rnd = moteRandom(7);

  it("is born at the event, moving, and dies on its own clock", () => {
    const f = field(4, 6);
    spawnResidue(f, 300, 200, 4, 0xffd24d, 80, 500, rnd);
    const born = f.motes.slice(4, 8);
    for (const m of born) {
      expect(m.x).toBe(300);
      expect(m.y).toBe(200);
      expect(Math.hypot(m.vx, m.vy)).toBeGreaterThan(0);
      expect(m.color).toBe(0xffd24d);
      expect(m.life).toBeGreaterThan(0);
    }
    stepMotes(f, 1);
    expect(born[0].life).toBeLessThan(born[0].maxLife);
  });

  it("settles rather than being sucked away", () => {
    const f = field(2, 4);
    spawnResidue(f, 300, 200, 1, 0xffffff, 200, 2000, rnd);
    const m = f.motes[2];
    const v0 = Math.hypot(m.vx, m.vy);
    stepMotes(f, 0.5);
    expect(Math.hypot(m.vx, m.vy)).toBeLessThan(v0);
  });

  it("fades out over its life, so nothing vanishes mid-frame", () => {
    const f = field(1, 2);
    spawnResidue(f, 0, 0, 1, 0xffffff, 10, 1000, rnd);
    const m = f.motes[1];
    const full = moteAlpha(m, 1);
    m.life = m.maxLife * 0.2;
    expect(moteAlpha(m, 1)).toBeLessThan(full);
    m.life = 0;
    expect(moteAlpha(m, 1)).toBe(0);
  });

  it("overwrites its oldest when a burst arrives on a full ring", () => {
    // The newest event is the one the player is looking at, so losing the tail
    // of an older burst is the right answer rather than a limitation.
    const f = field(2, 3);
    spawnResidue(f, 10, 10, 3, 0x111111, 50, 500, rnd);
    spawnResidue(f, 800, 800, 2, 0x222222, 50, 500, rnd);
    const colors = f.motes.slice(2).map(m => m.color);
    expect(colors.filter(c => c === 0x222222)).toHaveLength(2);
    expect(colors.filter(c => c === 0x111111)).toHaveLength(1);
  });

  it("does nothing at all when there is no ring to spawn into", () => {
    const f = field(4, 0);
    expect(() => spawnResidue(f, 0, 0, 5, 0xffffff, 50, 500, rnd)).not.toThrow();
    expect(f.motes).toHaveLength(4);
  });
});

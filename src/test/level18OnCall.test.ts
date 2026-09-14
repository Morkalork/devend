/**
 * Level 18 "On Call" stays the map the guidelines describe.
 *
 * The structural guards cover it like any map. What they cannot know is what
 * the map is FOR: an arm that fits its room with a seam to spare, two corner
 * doors it closes in turn, and a prize whose only cost is having to cut across
 * it. Every number below is load-bearing on the premise, and each is the kind
 * that can drift by ten units in an editor without looking wrong.
 *
 * The clearance is the one to watch. The arm reaches 100.5 against a room whose
 * inner faces are 110 away, so 9.5 units separate the tip from the wall: under
 * the 12-unit seam cap, which is what makes a closed door actually closed.
 * Widen the room by twenty and the arm stops sealing anything; narrow it by ten
 * and the arm grinds through its own walls.
 */
import { describe, it, expect } from "vitest";
import { LADDER, byLevel } from "./fixtures/maps";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import {
  buildMoverPolygon, buildRotorOutline, updateMoverPolygon,
  moverBoundRadius, type MoverState,
} from "@/lib/physics/moverState";
import type { WallRectEntity, MoverRectEntity } from "@/types/level";

const level = byLevel(LADDER, 18)!;
const walls = (level.entities ?? []).filter(e => e.kind === "wall") as WallRectEntity[];
const wall = (id: string) => walls.find(w => w.id === id)!;
const mover = (level.entities ?? []).find(e => e.kind === "mover") as MoverRectEntity;

/** The windmill, built the way initGame builds it. */
function windmill(): MoverState {
  const homeX = mover.x + mover.width / 2, homeY = mover.y + mover.height / 2;
  const bar: MoverState = {
    id: mover.id, shape: "rect", homeX, homeY, width: mover.width, height: mover.height,
    axis: "horizontal", range: 0, speed: mover.speed, offset: 0, direction: 1,
    motion: "rotate", angle: 0, polygon: { vertices: [] },
  } as MoverState;
  const m: MoverState = {
    ...bar,
    rotorOutline: buildRotorOutline(bar).map(p => ({
      x: p.x + homeX - mover.pivotX!, y: p.y + homeY - mover.pivotY!,
    })),
    homeX: mover.pivotX!, homeY: mover.pivotY!,
  };
  m.polygon = buildMoverPolygon(m);
  return m;
}

describe("level 18 is the windmill map", () => {
  it("exists, and its geometry is exact rather than rolled", () => {
    // variety would jitter the 9.5-unit clearance below by several units in
    // both directions, which is the whole map.
    expect(level).toBeTruthy();
    expect(level.variety ?? 0).toBe(0);
    expect(level.randomShapes ?? 0).toBe(0);
  });

  it("turns a full circle rather than wiping, so both doors are served", () => {
    expect(mover.motion).toBe("rotate");
    expect(mover.sweepDegrees).toBeUndefined();
    expect(mover.speed).toBeGreaterThan(0);
  });

  it("fits its room with a seam to spare, and never touches a wall", () => {
    const m = windmill();
    const reach = moverBoundRadius(m);
    expect(reach).toBeGreaterThan(95);
    expect(reach).toBeLessThan(105);

    let minClear = Infinity;
    for (let i = 0; i <= 720; i++) {
      m.angle = (i / 720) * Math.PI * 2;
      updateMoverPolygon(m);
      for (const v of m.polygon.vertices) {
        for (const w of walls) {
          const inside = v.x >= w.x && v.x <= w.x + w.width
            && v.y >= w.y && v.y <= w.y + w.height;
          expect(inside, `arm inside ${w.id} at ${i}`).toBe(false);
          const dx = Math.max(w.x - v.x, 0, v.x - (w.x + w.width));
          const dy = Math.max(w.y - v.y, 0, v.y - (w.y + w.height));
          minClear = Math.min(minClear, Math.hypot(dx, dy));
        }
      }
    }
    // A SEAM, not a neck: no ball fits between the arm and the room, which is
    // what makes the arm a door rather than a decoration.
    expect(minClear).toBeGreaterThan(0);
    expect(minClear).toBeLessThanOrEqual(12);
  });

  it("keeps the arm inside the board at every angle", () => {
    const m = windmill();
    for (let i = 0; i <= 360; i++) {
      m.angle = (i / 360) * Math.PI * 2;
      updateMoverPolygon(m);
      for (const v of m.polygon.vertices) {
        expect(v.x).toBeGreaterThan(45);
        expect(v.x).toBeLessThan(855);
        expect(v.y).toBeGreaterThan(45);
        expect(v.y).toBeLessThan(855);
      }
    }
  });

  it("has exactly two doors, at opposite corners, both legal necks", () => {
    const n = wall("wm-n"), e = wall("wm-e"), w = wall("wm-w"), s = wall("wm-s");
    // NE: from the north wall's east end to the east wall's north end.
    const ne = Math.hypot((e.x) - (n.x + n.width), (e.y) - (n.y + n.height));
    // SW: from the west wall's south end to the south wall's west end.
    const sw = Math.hypot((s.x) - (w.x + w.width), (s.y) - (w.y + w.height));
    expect(ne, "NE neck").toBeGreaterThanOrEqual(60);
    expect(sw, "SW neck").toBeGreaterThanOrEqual(60);
    // Opposite corners, so the arm cannot shut both at once.
    expect(n.x + n.width).toBeLessThan(e.x);
    expect(w.x + w.width).toBeLessThan(s.x);
  });

  it("paints the prize on the room floor as a BONUS, never a gate", () => {
    const areas = level.coloredAreas ?? [];
    expect(areas).toHaveLength(1);
    const a = areas[0];
    expect(a.kind).toBe("const");
    // required:true here would be a gate that gates nothing (section 6.4): the
    // authored win never asks for an area clause, so it would pay its
    // multiplier while being invisible as a requirement.
    expect(a.required).toBe(false);
    // Roomy on purpose. Over 4% of the board, so an early seal cannot grade
    // superior by accident and collapse the two multipliers into one.
    const share = (a.width * a.height) / (810 * 810);
    expect(share).toBeGreaterThan(0.04);
  });

  it("asks for a smash the room cannot provide, with slack", () => {
    const spec = resolveWinSpec(level, NO_RUN_RULES);
    const smash = spec.require.find(c => c.kind === "smashed");
    expect(smash, "no smashed clause: the win would fall to sealing alone").toBeTruthy();
    const breakables = walls.filter(w => w.breakable || w.brittle || w.chest);
    expect(breakables.length).toBeGreaterThan((smash as { count: number }).count);
    // And the targets are spread, so no single seal can bury the clause.
    const outer = breakables.filter(w => w.id.startsWith("slab-"));
    expect(outer.length).toBeGreaterThanOrEqual(3);
    const quadrants = new Set(outer.map(w =>
      `${w.x + w.width / 2 < 450 ? "W" : "E"}${w.y + w.height / 2 < 450 ? "N" : "S"}`));
    expect(quadrants.size, "the slabs share a quadrant").toBeGreaterThanOrEqual(3);
  });

  it("keeps its Turn pointed at the room, and telegraphs it", () => {
    const beat = (level.beats ?? [])[0];
    expect(beat?.breakId, "the Turn must open the room, not the outer board").toBe("wm-s");
    expect(beat?.announce).toBeTruthy();
    // The target has to be breakable for breakId to reach it.
    expect(wall("wm-s").breakable).toBe(true);
  });

  it("leaves a superior-sized nook outside the room, as a cheap second answer", () => {
    const shelf = wall("nook-shelf");
    const nook = shelf.width * (855 - (shelf.y + shelf.height));
    // Under 4% of the smallest denominator the map reaches (initial / 3 balls),
    // which is what "superior" actually means late in a three-ball map.
    expect(nook / (810 * 810)).toBeLessThan(0.0133);
    // Its mouth is still a legal neck.
    expect(855 - (shelf.y + shelf.height)).toBeGreaterThanOrEqual(60);
  });

  it("carries no new mechanic, because it is the rotor's development", () => {
    // The things 18 was once queued to Meet, all of which moved to 19: no
    // portal, no cage, no circuit, no fence budget.
    expect(level.fenceBudget).toBeUndefined();
    expect(level.circuit).toBeUndefined();
    expect(walls.some(w => w.portal)).toBe(false);
    expect((level.entities ?? []).some(e => e.kind === "cage")).toBe(false);
  });
});

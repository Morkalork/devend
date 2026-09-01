/**
 * The barrel: longer, canted, loaded with the whole roster, fired by a band.
 *
 * The first launcher was a squat axis-aligned cup holding ONE ball while the
 * other two bounced around the map from the first frame. That made the pull a
 * curiosity in the corner of an otherwise ordinary map, and an axis-aligned box
 * reads as one more wall rather than as something aimed.
 *
 * Four things changed and each has a way of being quietly wrong:
 *
 *   THE TURN has to reach the SHOT, not just the drawing. A barrel drawn at an
 *     angle that still fires along its bare facing is worse than an unturned
 *     one: the picture and the physics disagree and the player is the one who
 *     finds out.
 *   THE BAND has to sit on the closed end. Computed from the ball, it drifts as
 *     the stack is drawn back; computed in the wrong frame, it ends up outside
 *     the barrel entirely.
 *   THE ROSTER has to be MOVED into the barrel, not duplicated into it. Balls
 *     created for the barrel would leave the originals loose and change the
 *     map's ball count, which every win condition is scaled against.
 *   THE FAN has to stay inside the aim cone. Balls fired on exactly one heading
 *     never separate (nothing in the engine damps a ball), and balls fanned too
 *     wide leave where the player could not have aimed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { captureUnreachableCells, CellState } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import {
  muzzleVector, bandEnds, bandAnchor, launchAim, bearingVector,
  LAUNCH_SPREAD, LAUNCH_FULL_PULL,
} from "@/lib/launcher";
import { fanDirections } from "@/lib/physics/launcher";
import type { LaunchAim, LaunchFacing } from "@/lib/launcher";

const FACINGS: LaunchFacing[] = ["up", "down", "left", "right"];
const angleOf = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);
/** Signed smallest angle between two headings. */
function offBy(a: number, b: number): number {
  let d = a - b;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

describe("the turn reaches the shot, not only the picture", () => {
  it("leaves an unturned barrel exactly as it was", () => {
    for (const f of FACINGS) {
      expect(muzzleVector(f, 0)).toEqual(bearingVector(f));
      expect(muzzleVector(f)).toEqual(bearingVector(f));
    }
  });

  it("turns the muzzle by the barrel's own angle", () => {
    // Screen coordinates: a negative angle lifts the muzzle, which is what
    // level 11's -24 does to fire up through the gap in the spine.
    const up = muzzleVector("right", -24);
    expect(up.x).toBeGreaterThan(0);
    expect(up.y, "a negative angle should lift the muzzle").toBeLessThan(0);
    expect(Math.hypot(up.x, up.y), "not a unit vector").toBeCloseTo(1, 9);
  });

  it("turns every facing by the same rule", () => {
    for (const f of FACINGS) {
      for (const deg of [-90, -24, 0, 17, 140]) {
        const got = angleOf(muzzleVector(f, deg));
        const want = angleOf(bearingVector(f)) + (deg * Math.PI) / 180;
        expect(Math.abs(offBy(got, want)), `${f} @ ${deg}`).toBeLessThan(1e-9);
      }
    }
  });

  it("aims the cone around the TURNED muzzle", () => {
    // The bug this exists for: a canted barrel whose cone is still centred on
    // the bare facing. A pull straight down the barrel would then read as an
    // off-axis shot and be clamped away from where the barrel points.
    const straightDownTheBarrel = muzzleVector("right", -24);
    const aim = launchAim(
      { x: -straightDownTheBarrel.x * 120, y: -straightDownTheBarrel.y * 120 },
      "right", -24,
    )!;
    expect(aim.clamped, "a shot straight down the barrel was clamped").toBe(false);
    expect(Math.abs(offBy(angleOf(aim.direction), angleOf(straightDownTheBarrel))))
      .toBeLessThan(1e-6);
  });

  it("still refuses to fire outside the cone, at any barrel angle", () => {
    for (const deg of [-40, -24, 0, 31]) {
      const base = angleOf(muzzleVector("right", deg));
      for (let d = 0; d < 360; d += 11) {
        const th = (d * Math.PI) / 180;
        const aim = launchAim({ x: Math.cos(th) * 150, y: Math.sin(th) * 150 }, "right", deg);
        if (!aim) continue;
        expect(Math.abs(offBy(angleOf(aim.direction), base)), `${deg}deg barrel, pull ${d}deg`)
          .toBeLessThanOrEqual(LAUNCH_SPREAD + 1e-9);
      }
    }
  });
});

describe("the band sits across the closed end", () => {
  // A barrel twice as long as it is wide, so "along" and "across" are telling.
  const inner = { x: 100, y: 100, width: 200, height: 80 };

  it("spans the back, not the sides", () => {
    // Facing right, so the closed end is the LEFT edge: both ends of the band
    // share that x and differ down the barrel's short axis.
    const { a, b } = bandEnds(inner, "right");
    expect(a.x).toBeCloseTo(100, 6);
    expect(b.x).toBeCloseTo(100, 6);
    expect(Math.abs(a.y - b.y), "the band is not as wide as the barrel")
      .toBeCloseTo(inner.height, 6);
  });

  it("is behind the muzzle, on every facing", () => {
    for (const f of FACINGS) {
      const dir = muzzleVector(f);
      const anchor = bandAnchor(inner, f);
      const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
      // The anchor must lie OPPOSITE the muzzle from the barrel's centre.
      const along = (anchor.x - cx) * dir.x + (anchor.y - cy) * dir.y;
      expect(along, `${f}: the band is in front of the muzzle`).toBeLessThan(0);
    }
  });

  it("is perpendicular to the muzzle, at any angle", () => {
    for (const deg of [-40, -24, 0, 55]) {
      const { a, b } = bandEnds(inner, "right", deg);
      const dir = muzzleVector("right", deg);
      const span = { x: b.x - a.x, y: b.y - a.y };
      const dot = (span.x * dir.x + span.y * dir.y) / Math.hypot(span.x, span.y);
      expect(Math.abs(dot), `${deg}deg: the band is skewed`).toBeLessThan(1e-9);
    }
  });

  it("turns with the barrel rather than staying axis-aligned", () => {
    const flat = bandEnds(inner, "right", 0);
    const canted = bandEnds(inner, "right", -24);
    expect(canted.a.x).not.toBeCloseTo(flat.a.x, 3);
  });

  it("keeps the band inside the barrel it belongs to", () => {
    // Both ends within the barrel's own circumscribed circle: a band computed in
    // the wrong frame lands somewhere else on the board entirely.
    const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
    const reach = Math.hypot(inner.width, inner.height) / 2 + 1e-6;
    for (const deg of [-90, -24, 0, 33, 120]) {
      for (const f of FACINGS) {
        const { a, b } = bandEnds(inner, f, deg);
        expect(Math.hypot(a.x - cx, a.y - cy), `${f} @ ${deg}`).toBeLessThanOrEqual(reach);
        expect(Math.hypot(b.x - cx, b.y - cy), `${f} @ ${deg}`).toBeLessThanOrEqual(reach);
      }
    }
  });
});

describe("the fan spreads a stack without breaking the cone", () => {
  const aimAt = (deg: number): LaunchAim => ({
    direction: { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) },
    power: 2, clamped: false,
  });

  it("fires a single ball dead on the aim", () => {
    const aim = aimAt(0);
    expect(fanDirections(aim, 1)).toEqual([aim.direction]);
  });

  it("gives every ball its own heading", () => {
    const dirs = fanDirections(aimAt(0), 3);
    expect(dirs).toHaveLength(3);
    const keys = new Set(dirs.map(d => `${d.x.toFixed(6)},${d.y.toFixed(6)}`));
    expect(keys.size, "the stack leaves as one ball and never separates").toBe(3);
  });

  it("keeps the whole fan inside the aim cone", () => {
    // Otherwise a ball leaves somewhere the player could not have aimed, which
    // is the one thing the cone exists to prevent.
    for (const count of [2, 3, 5, 8]) {
      for (const deg of [0, 90, -137]) {
        const aim = aimAt(deg);
        const base = angleOf(aim.direction);
        for (const d of fanDirections(aim, count)) {
          expect(Math.abs(offBy(angleOf(d), base)), `${count} balls at ${deg}deg`)
            .toBeLessThanOrEqual(LAUNCH_SPREAD + 1e-9);
        }
      }
    }
  });

  it("stays centred on the aim, so the shot goes where it was pointed", () => {
    const aim = aimAt(0);
    const dirs = fanDirections(aim, 5);
    const mean = dirs.reduce((s, d) => s + offBy(angleOf(d), 0), 0) / dirs.length;
    expect(Math.abs(mean), "the fan is lopsided").toBeLessThan(1e-9);
  });

  it("emits unit vectors, so power is the only thing setting speed", () => {
    for (const d of fanDirections(aimAt(41), 4)) {
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
    }
  });
});

describe("the pull is unchanged in the ways that matter", () => {
  it("still fires opposite the pull", () => {
    const aim = launchAim({ x: -100, y: 0 }, "right", 0)!;
    expect(aim.direction.x).toBeGreaterThan(0);
  });

  it("still reaches full power at the full pull, whatever the barrel angle", () => {
    for (const deg of [-24, 0, 60]) {
      const dir = muzzleVector("right", deg);
      const full = launchAim(
        { x: -dir.x * LAUNCH_FULL_PULL, y: -dir.y * LAUNCH_FULL_PULL }, "right", deg,
      )!;
      expect(full.power, `${deg}deg`).toBeCloseTo(3, 6);
    }
  });
});

/**
 * A loaded barrel must not seal its own balls off from the board.
 *
 * The nastiest consequence of loading the whole roster, and completely
 * invisible until something asks. Reachability is BALL-SIZE aware and runs on
 * the rasterised grid: a turned barrel with a narrow bore rasterises to a
 * staircase, and eroding that by a ball's radius can break the corridor into
 * disconnected cells. The balls are then unreachable from the board and
 * `captureUnreachableCells` writes off everything outside the barrel.
 *
 * Measured at the shipped 240x84 it kept SIXTEEN of 2458 active cells. Nothing
 * reported it, because the map is paused until the shot and no cut runs the
 * check - it sat there as a landmine for any code path that ran it first, and
 * it did surface as breakables that could not be smashed clean.
 *
 * Pinned on the built map rather than on the number, because the bore, the
 * angle, the grid size, the ball radius and the map rotation all feed it and no
 * single constant is the rule.
 */
describe("the loaded barrel stays part of the board", () => {
  const MAP = yaml.load(
    readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
  ) as { levels: LevelConfig[] };
  const launcherMaps = MAP.levels.filter(
    l => ((l as unknown as { entities?: Array<{ kind: string }> }).entities ?? [])
      .some(e => e.kind === "launcher"),
  );

  it("has a launcher map to check", () => {
    expect(launcherMaps.length).toBeGreaterThan(0);
  });

  it.each(launcherMaps.map(l => [l.id, l] as const))(
    "%s keeps its board reachable with every ball still loaded",
    (_id, level) => {
      // Several builds: the map is dealt in one of four rotations and sprinkles
      // random obstacles, and the bore only breaks up on some of them.
      for (let i = 0; i < 6; i++) {
        const d = createInitialGameData(level, level.level, DEFAULT_MODIFIERS);
        const grid = d.spaceGrid!;
        const before = grid.cells.filter(c => c === CellState.ACTIVE).length;
        expect(before, "the map has no open space at all").toBeGreaterThan(100);
        captureUnreachableCells(
          grid, d.balls as never, d.walls as never,
        );
        const after = grid.cells.filter(c => c === CellState.ACTIVE).length;
        expect(
          after / before,
          `build ${i}: the barrel sealed its balls in - ${after} of ${before} cells left reachable`,
        ).toBeGreaterThan(0.9);
      }
    },
  );

  it("keeps every loaded ball inside the barrel it was loaded into", () => {
    // The other end of the same knife: padding the stack too little puts the
    // hindmost ball's edge inside the back wall ("spawned in removed space"),
    // and too much stacks them out of the muzzle.
    for (const level of launcherMaps) {
      const d = createInitialGameData(level, level.level, DEFAULT_MODIFIERS);
      for (const cup of d.launchers) {
        for (const id of cup.ballIds) {
          const ball = d.balls.find(b => b.id === id)!;
          expect(ball.state, `${id} is not asleep`).toBe("dormant");
          const cx = cup.inner.x + cup.inner.width / 2;
          const cy = cup.inner.y + cup.inner.height / 2;
          const reach = Math.hypot(cup.inner.width, cup.inner.height) / 2;
          expect(
            Math.hypot(ball.position.x - cx, ball.position.y - cy),
            `${id} sits outside its barrel`,
          ).toBeLessThanOrEqual(reach);
        }
      }
    }
  });
});

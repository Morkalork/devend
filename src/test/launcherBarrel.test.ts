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
  LAUNCH_FULL_PULL,
} from "@/lib/launcher";
import { fireLauncher } from "@/lib/physics/launcher";
import type { LaunchAim, LaunchFacing } from "@/lib/launcher";

import { ENGINE_MAPS } from "./fixtures/maps";

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

  it("fires down the TURNED muzzle, not the bare facing", () => {
    // The bug this exists for predates the cone's removal and outlives it: a
    // canted barrel whose shot is computed from the facing alone fires across
    // its own bore, so the barrel and the ball disagree on screen.
    const straightDownTheBarrel = muzzleVector("right", -24);
    const aim = launchAim(
      { x: -straightDownTheBarrel.x * 120, y: -straightDownTheBarrel.y * 120 },
      "right", -24,
    )!;
    expect(Math.abs(offBy(angleOf(aim.direction), angleOf(straightDownTheBarrel))))
      .toBeLessThan(1e-6);
  });

  it("fires down that line whatever direction the pull came from", () => {
    for (const deg of [-40, -24, 0, 31]) {
      const base = angleOf(muzzleVector("right", deg));
      for (let d = 0; d < 360; d += 11) {
        const th = (d * Math.PI) / 180;
        const aim = launchAim({ x: Math.cos(th) * 150, y: Math.sin(th) * 150 }, "right", deg);
        if (!aim) continue;
        expect(Math.abs(offBy(angleOf(aim.direction), base)), `${deg}deg barrel, pull ${d}deg`)
          .toBeLessThan(1e-9);
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

describe("a loaded barrel empties down one line", () => {
  /**
   * The fan is gone. It used to spread the roster across half the aim cone,
   * because balls sharing a heading and a speed never separate - and that made
   * the launch preview a lie: one drawn path, three balls going three ways.
   * Reported as "because there are often more than one ball in there, it seldom
   * shows what you get... otherwise all you get is chaos".
   *
   * What separates them now is the barrel. They are stacked down the bore, so
   * they cross the muzzle one after another with the gap they were loaded at
   * still between them.
   */
  const barrelBall = (id: string, x: number) => ({
    id, state: "dormant", position: { x, y: 300 }, velocity: { x: 0, y: 0 },
    speed: 0, baseSpeed: 250, radius: 18,
  });

  function firedGame(count: number) {
    const balls = Array.from({ length: count }, (_, i) => barrelBall(`b${i}`, 400 - i * 60));
    const game = {
      balls, regions: [], launchers: [], launchPower: 1,
    } as unknown as import("@/types/gameState").CanvasGameState;
    const launcher = {
      id: "cup", inner: { x: 200, y: 280, width: 240, height: 40 },
      facing: "right" as LaunchFacing, ballIds: balls.map(b => b.id), fired: false,
    };
    const power = fireLauncher(game, launcher as never, { direction: { x: 1, y: 0 }, power: 2 });
    return { game, power, balls };
  }

  it("sends every ball down exactly the same heading", () => {
    const { balls } = firedGame(3);
    for (const b of balls) {
      const v = (b as unknown as { velocity: { x: number; y: number } }).velocity;
      expect(angleOf(v), "a ball left on a heading of its own").toBeCloseTo(0, 9);
    }
  });

  it("gives every ball the same speed, so the column keeps its spacing", () => {
    const { balls } = firedGame(3);
    const speeds = balls.map(b => (b as unknown as { speed: number }).speed);
    for (const s of speeds) expect(s).toBeCloseTo(speeds[0], 6);
    expect(speeds[0]).toBeCloseTo(500, 6);   // base 250 at power 2
  });

  it("keeps them apart by the gap they were loaded at", () => {
    // What replaces the fan: the stack IS the separation, and it is visible in
    // the tube before a finger touches the band.
    const { balls } = firedGame(3);
    const xs = balls.map(b => (b as unknown as { position: { x: number } }).position.x);
    expect(xs[0] - xs[1]).toBeCloseTo(60, 6);
    expect(xs[1] - xs[2]).toBeCloseTo(60, 6);
  });

  it("wakes every one of them", () => {
    const { balls } = firedGame(4);
    for (const b of balls) {
      expect((b as unknown as { state: string }).state).toBe("active");
    }
  });

  it("buys the map at the power fired", () => {
    const { game, power } = firedGame(2);
    expect(power).toBe(2);
    expect(game.launchPower).toBe(2);
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
  const MAP = ({ levels: ENGINE_MAPS } as unknown as { levels: LevelConfig[] });
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

describe("the preview is the shot", () => {
  /**
   * The complaint this whole change answers: "because there are often more
   * than one ball in there, it seldom shows what you get... otherwise all you
   * get is chaos."
   *
   * The overlay draws ONE predicted path. That is honest only while every ball
   * in the barrel takes it, so the two ends of that promise are pinned here -
   * the drawing end and the firing end - because they live in different files
   * and nothing else would notice them parting company.
   */
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
  const overlay = read("src/components/game/LaunchOverlay.tsx");

  it("draws the barrel's line rather than a cone of maybes", () => {
    expect(overlay, "the aim cone is back").not.toContain("LAUNCH_SPREAD");
    expect(overlay).toContain("The barrel's line: where the shot goes");
  });

  it("predicts from the same aim the shot is fired with", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("const v = { x: aim.direction.x * speed, y: aim.direction.y * speed };");
    expect(canvas).toContain("fireLauncher(game, pendingLaunch, aim);");
  });

  it("says how many balls are coming down it", () => {
    // One line, three balls: the count is the only part of "what you get" the
    // path itself cannot show.
    expect(overlay).toContain("loadedCount");
    expect(read("src/components/game/GameCanvas.tsx")).toContain("loadedCount={loaded.length}");
    for (const lang of ["en", "es", "sv"]) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      expect(locale.launcher.ballsOnTheLine, `${lang} has no words for it`).toBeTruthy();
    }
  });

  it("has nothing left that spreads a shot", () => {
    const physics = read("src/lib/physics/launcher.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
    expect(physics, "the fan is back").not.toContain("fanDirections");
    // Scoped to the firing function: the barrel's own rotation is trigonometry
    // too (pointInLauncherInterior), and sweeping the whole file for it would
    // be a test about arithmetic rather than about headings.
    const fire = physics.slice(physics.indexOf("export function fireLauncher"));
    expect(fire, "the shot computes a heading of its own again").not.toContain("Math.cos(");
    expect(fire, "a ball is given something other than the aim")
      .toContain("launchVelocity({ ...aim, power }");
  });
});

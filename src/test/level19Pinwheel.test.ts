/**
 * Level 19 "Hotfix": full-map gravity with moving obstacles, built for the tilt.
 *
 * The room turns a quarter every ten seconds, so the layout has the same
 * symmetry: four patrol bars in a pinwheel and a chest on each floor. Turn the
 * board a quarter and it lands on itself, bars moving the same way round, so a
 * tilt deals a different floor but never a different map. That is the design,
 * and it is also the easiest thing for a later edit to break without noticing,
 * so it is pinned here along with the two ways a pull plus movers could go
 * wrong: a bar leaving its lane, and a ball wedged between a bar and a wall.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot } from "@/lib/bot/headlessGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { mapGravityActive, steerWorldOf } from "@/lib/physics/steering";
import { BOARD_SIDES } from "@/lib/physics/boardEdges";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { setRunSeedText } from "@/lib/runRng";
import { LADDER } from "./fixtures/maps";
import type { LevelConfig } from "@/types/level";

const L19 = LADDER.find(l => l.id === "level-19")!;
const SIZE = 900;

interface RectEntity {
  id: string; kind: string; x: number; y: number; width: number; height: number;
  axis?: "horizontal" | "vertical"; phase?: number; chest?: boolean;
}
const entities = (L19.entities ?? []) as unknown as RectEntity[];
const bars = entities.filter(e => e.kind === "mover");
const chests = entities.filter(e => e.chest);

/** A rect's start centre and the direction it first moves in (unit, world). */
function startOf(e: RectEntity): { cx: number; cy: number; dx: number; dy: number } {
  let cx = e.x + e.width / 2;
  let cy = e.y + e.height / 2;
  let dx = 0;
  let dy = 0;
  if (e.kind === "mover") {
    // phase 0 starts at the low end and heads up the axis; 1 the other way.
    const range = (e as unknown as { range: number }).range;
    const phase = e.phase ?? 0;
    const offset = phase * range - range / 2;
    const sign = phase >= 0.5 ? -1 : 1;
    if (e.axis === "horizontal") {
      cx += offset;
      dx = sign;
    } else {
      cy += offset;
      dy = sign;
    }
  }
  return { cx, cy, dx, dy };
}

/** A quarter turn clockwise about the board centre. */
function quarterTurn(p: { cx: number; cy: number; dx: number; dy: number }) {
  return { cx: SIZE - p.cy, cy: p.cx, dx: -p.dy, dy: p.dx };
}

describe("level 19 is built for the tilt", () => {
  it("is a full-gravity map with moving obstacles", () => {
    expect(L19, "level 19 is not on the ladder").toBeTruthy();
    expect(L19.mutator).toBe("tipping");
    expect(bars.length).toBe(4);
    expect(chests.length).toBe(4);
  });

  it("lands on itself after a quarter turn, bars moving the same way round", () => {
    for (const group of [bars, chests]) {
      const starts = group.map(startOf);
      for (const s of starts) {
        const t = quarterTurn(s);
        const match = starts.find(o =>
          Math.abs(o.cx - t.cx) < 1 && Math.abs(o.cy - t.cy) < 1
          && o.dx === t.dx && o.dy === t.dy);
        expect(match, `nothing sits where (${s.cx},${s.cy}) turns to`).toBeTruthy();
      }
    }
  });

  it("keeps every bar out of the eye and on the board", () => {
    // The middle is the quiet chamber: no patrol ever enters it.
    const EYE = { min: 300, max: 600 };
    for (const b of bars) {
      const range = (b as unknown as { range: number }).range;
      const reach = b.axis === "horizontal"
        ? { x0: b.x - range / 2, x1: b.x + b.width + range / 2, y0: b.y, y1: b.y + b.height }
        : { x0: b.x, x1: b.x + b.width, y0: b.y - range / 2, y1: b.y + b.height + range / 2 };
      expect(reach.x0, `${b.id} leaves the board`).toBeGreaterThanOrEqual(0);
      expect(reach.y0, `${b.id} leaves the board`).toBeGreaterThanOrEqual(0);
      expect(reach.x1, `${b.id} leaves the board`).toBeLessThanOrEqual(SIZE);
      expect(reach.y1, `${b.id} leaves the board`).toBeLessThanOrEqual(SIZE);
      const crossesEye = reach.x0 < EYE.max && reach.x1 > EYE.min
        && reach.y0 < EYE.max && reach.y1 > EYE.min;
      expect(crossesEye, `${b.id} patrols into the eye`).toBe(false);
    }
  });
});

describe("level 19 played with the bars moving", () => {
  const SECONDS = 40;
  const SEEDS = 4;
  /** A quarter second of not moving reads on screen as a stopped ball. */
  const WEDGE_STEPS = 30;

  it("pulls, bounces on every side, and never wedges a ball", { timeout: 120_000 }, async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      setRunSeedText(`pinwheel-${seed}`);
      const ctx = createBotGame(L19 as LevelConfig, 19, DEFAULT_MODIFIERS, { mutator: "roll" });
      const { game } = ctx;
      if (seed === 1) {
        expect(mapGravityActive(steerWorldOf(game as never)), "the pull is off").toBe(true);
        for (const side of BOARD_SIDES) {
          expect(game.boardEdges?.[side]?.kick, `${side} is a plain wall`).toBeGreaterThan(1);
        }
      }
      const barStart = game.movers.map(m => m.offset);
      const run = new Map<string, number>();
      let worst = 0;
      for (let i = 0; i < Math.round(SECONDS / PHYSICS_STEP); i++) {
        const before = game.balls.map(b => ({ id: b.id, x: b.position.x, y: b.position.y, state: b.state }));
        stepBot(ctx, PHYSICS_STEP);
        for (const b of before) {
          const ball = game.balls.find(x => x.id === b.id);
          if (!ball || b.state !== "active" || ball.state !== "active") {
            run.set(b.id, 0);
            continue;
          }
          const moved = Math.hypot(ball.position.x - b.x, ball.position.y - b.y);
          const floor = (ball.minimumSpeed ?? 150) * PHYSICS_STEP * 0.1;
          const n = moved < floor ? (run.get(b.id) ?? 0) + 1 : 0;
          run.set(b.id, n);
          worst = Math.max(worst, n);
        }
      }
      if (seed === 1) {
        const moved = game.movers.some((m, i) => m.offset !== barStart[i]);
        expect(moved, "the bars never moved, so this soaked a still board").toBe(true);
      }
      if (worst >= WEDGE_STEPS) {
        failures.push(`seed ${seed}: a ball stopped for ${(worst * PHYSICS_STEP).toFixed(2)}s`);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(failures.join(" | ") || "none").toBe("none");
  });
});

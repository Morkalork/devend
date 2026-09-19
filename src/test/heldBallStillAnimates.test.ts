/**
 * A ball that stops moving has not stopped being drawn.
 *
 * Bug Squash shipped with no visible squash at all, and the cause was not in
 * the envelope, the renderer or the maths - all three were right. It was that
 * the browser's game loop `continue`d past a held ball BEFORE calling
 * updateBall, while updateBall's own held-ball branch (which returns early and
 * ticks the ball's effects) was only ever reached by the headless harness.
 *
 * So the harness animated a held ball correctly and the browser did not, and
 * every test agreed with the harness. The bug survived a full test suite, a
 * frame-by-frame probe of the envelope and a renderer audit, and was caught by
 * a screenshot: a ball sitting against the wall perfectly round, with its
 * wall-hit halo frozen mid-decay around it - the signature of an effect state
 * that is not being ticked at all.
 *
 * The rule this file pins is therefore not "the squash works" (bugSquash and
 * bugSquashReadable already own that). It is: WHATEVER STOPS A BALL MOVING MUST
 * NOT STOP ITS EFFECTS. Two tests, deliberately of different kinds, because a
 * behavioural test alone could not see the defect - the defect was that the
 * behaviour was reached by one caller and not the other.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBallEffectState, triggerWallHit, pinSquish, getSquishEffect } from "@/lib/ballEffects";
import { updateBall } from "@/lib/physics/updateBall";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { installClock, advanceClock, releaseClock } from "@/lib/bot/headlessGame";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { simNow } from "@/lib/simClock";

const LOOP_SRC = readFileSync(resolve(process.cwd(), "src/hooks/useGameLoop.ts"), "utf8");

describe("the game loop routes held balls THROUGH updateBall", () => {
  it("never skips a ball on frozenUntil before updateBall can see it", () => {
    // The exact line that caused this, verbatim as it stood:
    //   if (ball.frozenUntil && simNow() < ball.frozenUntil) continue;
    // Any `continue` guarded on frozenUntil is the same bug wearing a different
    // condition, so the check is on the shape rather than on that one string.
    const offenders = LOOP_SRC.split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      // Comments are excluded, and the note in the loop deliberately quotes the
      // offending line so the next reader knows what not to put back.
      .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*"))
      .filter(({ line }) => line.includes("frozenUntil") && line.includes("continue"));
    expect(
      offenders.map(o => `line ${o.n}: ${o.line}`),
      "the loop skips a held ball again; updateBall must own that decision so the "
      + "browser and the headless harness cannot disagree about it",
    ).toEqual([]);
  });

  it("ticks the effects of the shake-frozen ball it does still skip", () => {
    // One skip legitimately remains (the lock shake pins a ball to a recorded
    // position), and it has to tick effects on the way past or it reintroduces
    // the same silence for that ball.
    const from = LOOP_SRC.indexOf("game.frozenBallId && ball.id === game.frozenBallId");
    expect(from).toBeGreaterThan(0);
    const shakeBlock = LOOP_SRC.slice(from, from + 1400);
    const ticks = shakeBlock.indexOf("updateBallEffects");
    const skips = shakeBlock.indexOf("continue");
    expect(ticks, "the shake skip no longer ticks effects").toBeGreaterThan(-1);
    expect(skips).toBeGreaterThan(-1);
    expect(ticks, "it skips before ticking").toBeLessThan(skips);
  });
});

describe("stepping a held ball the way the loop now does animates it", () => {
  // A CONTROLLED CLOCK, because the envelope is keyed on wall-clock time and a
  // dozen synchronous calls take no wall-clock time at all. Without this the
  // test reports a ball that never squashes and is measuring its own speed.
  afterEach(() => releaseClock());

  /** A minimal board: one ball, stuck, nothing else to collide with. */
  function heldBall() {
    const effects = createBallEffectState();
    const now = simNow();
    triggerWallHit(effects, now, -300, 0, 300);
    pinSquish(effects, now, 2000);
    const ball = {
      id: "b1",
      position: { x: 400, y: 400 },
      renderPosition: { x: 400, y: 400 },
      velocity: { x: -100, y: 0 },
      speed: 100, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
      radius: 18, color: "#ff5b5b", state: "active",
      frozenUntil: now + 2000,
      bugSquashUntil: now + 2000,
      effects,
    } as unknown as Ball;
    const game = {
      balls: [ball], walls: [], obstaclePolygons: [], movers: [], chains: [],
      regions: [], spaceGrid: null, gravityConfig: null,
      bugSquashChance: 0, bugSquashSeconds: 0,
    } as unknown as CanvasGameState;
    return { ball, game };
  }

  it("deepens the squash over the first frames instead of staying round", () => {
    // This is the browser's actual per-ball call now: no skip, updateBall for
    // every ball, its held-ball branch doing the rest.
    releaseClock(); installClock();
    const { ball, game } = heldBall();
    expect(getSquishEffect(ball.effects, 1).scaleAlong).toBeCloseTo(1, 2); // starts round
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      advanceClock(PHYSICS_STEP);
      updateBall(ball, PHYSICS_STEP, game);
      seen.push(getSquishEffect(ball.effects, 1).scaleAlong);
    }
    // It must actually get flatter, and it must do so gradually.
    expect(seen[seen.length - 1]).toBeLessThan(0.75);
    expect(new Set(seen.map(v => v.toFixed(3))).size).toBeGreaterThan(5);
  });

  it("keeps the ball still while doing it", () => {
    releaseClock(); installClock();
    const { ball, game } = heldBall();
    for (let i = 0; i < 12; i++) { advanceClock(PHYSICS_STEP); updateBall(ball, PHYSICS_STEP, game); }
    expect(ball.position).toEqual({ x: 400, y: 400 });
    expect(ball.velocity).toEqual({ x: -100, y: 0 });
  });
});

/**
 * Bug Squash: a wall hit may squash the ball flat against the wall and stick it
 * there, then let it go on its way.
 *
 * Three things have to be true at once, and each has its own way of being
 * quietly wrong:
 *
 *  1. The SQUASH. The ordinary bounce squish compresses at impact and springs
 *     back in half a second. A stuck ball needs a different envelope: ramp
 *     INTO the splat, hold there, then play the spring-back, and fit ALL THREE
 *     inside the stick, so the ball is round again at the instant its physics
 *     resume. If the hold were merely "stop ticking the clock", the release
 *     would jump the curve to its end and the ball would snap round; if the
 *     release began where the freeze ends (which is how this first shipped),
 *     the ball departs half-flat and reinflates in mid-flight.
 *  2. The STICK. The ball must not move, must keep the velocity it bounced off
 *     with, and must carry on with exactly that once the hold lifts. It rides
 *     frozenUntil so every held-ball rule already in the game applies.
 *  3. The HARNESS. The browser loop skips a frozen ball before calling
 *     updateBall; the headless harness calls updateBall for every ball, so
 *     until this feature a frozen ball kept moving in every bot sweep. The hold
 *     is now decided inside updateBall, and the harness is the proof.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import "@/i18n";
vi.mock("@/lib/gameAudio", () => ({
  playSquishSound: () => {},
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {}, vibrateDeath: () => {},
  vibrateBallLock: () => {}, setHapticsEnabled: () => {}, isHapticsEnabled: () => false,
}));

import {
  createBallEffectState, triggerWallHit, updateBallEffects, getSquishEffect,
  pinSquish, isSquishPinned, SPLAT_HELD_OUT_MS,
} from "@/lib/ballEffects";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { setRunSeedText } from "@/lib/runRng";
import { computeGameModifiers, DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { getUpgradeIcon } from "@/components/game/upgradeIcons";
import { ModifierBreakdown } from "@/components/game/ModifierBreakdown";
import type { LevelConfig } from "@/types/level";
import type { UpgradeConfig } from "@/types/upgrade";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { simNow } from "@/lib/simClock";

const UPGRADES = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;
const lookup = new Map(UPGRADES.map(u => [u.id, u]));
const FAMILY = ["bug_squash_junior", "bug_squash_senior", "bug_squash_principal_a"];
const FORK_B = "bug_squash_principal_b";

afterEach(() => { cleanup(); setRunSeedText(null); releaseClock(); });

// ── 1. The squash ───────────────────────────────────────────────────────────

/** A ball that just hit a wall square-on at full speed, then got stuck. */
function stuckAt(now: number, holdMs: number) {
  const st = createBallEffectState();
  triggerWallHit(st, now, 0, -300, 300);
  pinSquish(st, now, holdMs);
  return st;
}
const compression = (st: ReturnType<typeof createBallEffectState>) => 1 - getSquishEffect(st).scaleAlong;

describe("the squash ramps in, holds, and springs back on release", () => {
  it("starts round and ramps INTO the splat rather than appearing flat", () => {
    const st = stuckAt(1000, 2000);
    updateBallEffects(st, 0.016, 1000);
    const atImpact = compression(st);
    updateBallEffects(st, 0.016, 1045);
    const halfway = compression(st);
    updateBallEffects(st, 0.016, 1090);
    const full = compression(st);
    expect(atImpact).toBeCloseTo(0, 3);
    expect(halfway).toBeGreaterThan(atImpact);
    expect(full).toBeGreaterThan(halfway);
  });

  it("holds at full compression for the whole stick, flat against the wall", () => {
    const st = stuckAt(1000, 2000);
    updateBallEffects(st, 0.016, 1200);
    const held = compression(st);
    updateBallEffects(st, 0.016, 2000);
    const laterStillHeld = compression(st);
    expect(held).toBeCloseTo(laterStillHeld, 6);
    expect(isSquishPinned(st, 2000)).toBe(true);
    // The normal from the hit is what it is pinned along: straight into the wall.
    const s = getSquishEffect(st);
    expect(s.nx).toBeCloseTo(0, 6);
    expect(Math.abs(s.ny)).toBeCloseTo(1, 6);
  });

  it("splats harder than a passing bounce ever does", () => {
    // A stuck ball is drawn for seconds and has to read as flattened. The
    // ordinary bounce is deliberately mild (~17% at full speed); the pinned
    // squash is now about three times that, up from double, because double was
    // reported as no animation at all (see bugSquashReadable.test.ts for the
    // perceptual thresholds and the reasoning).
    const bounce = createBallEffectState();
    triggerWallHit(bounce, 1000, 0, -300, 300);
    const stuck = stuckAt(1000, 2000);
    updateBallEffects(stuck, 0.016, 1500);
    expect(compression(stuck)).toBeGreaterThan(compression(bounce) * 2.5);
    // This used to assert strict area preservation. The bulge is damped now
    // (BULGE_EXPONENT): a soft body pressed flat also swells toward the viewer,
    // and spending all of that sideways made the splat a water balloon. So it
    // still spreads as it flattens, by less than a disc would.
    const s = getSquishEffect(stuck);
    expect(s.scalePerp).toBeGreaterThan(1);
    expect(s.scaleAlong * s.scalePerp).toBeLessThan(1);
  });

  it("plays the un-squash FROM the release, not from the impact", () => {
    // The failure this pins: keying the spring-back on the impact time would
    // find the whole 500ms curve already elapsed at release and snap the ball
    // round in one frame. It has to un-squash visibly as it leaves.
    //
    // The times moved because the release now plays INSIDE the freeze: the flat
    // hold ends SPLAT_HELD_OUT_MS before the stick does, so the reinflate is
    // finished at 3000 rather than starting there.
    const st = stuckAt(1000, 2000);
    const holdEnd = 1000 + 2000 - SPLAT_HELD_OUT_MS;
    updateBallEffects(st, 0.016, holdEnd - 1);
    const justBefore = compression(st);
    updateBallEffects(st, 0.016, holdEnd + 1);
    const justAfter = compression(st);
    updateBallEffects(st, 0.016, holdEnd + 120);
    const settling = compression(st);
    expect(isSquishPinned(st, holdEnd + 1)).toBe(false);
    expect(justAfter).toBeCloseTo(justBefore, 1);
    expect(settling).toBeLessThan(justAfter);
    expect(settling).toBeGreaterThan(0);
    // Round again exactly at the end of the stick, which is the moment the
    // ball's physics resume. Not 750ms after it, on a ball already in flight.
    updateBallEffects(st, 0.016, 3000);
    expect(getSquishEffect(st).active).toBe(false);
  });

  it("does not snap round even if nothing ticked during the hold", () => {
    // The browser loop skips a held ball entirely, so the effects may not have
    // been updated once between the stick and the release.
    // Sampled inside the freeze rather than at 3001: the release now finishes
    // by then, so a single late tick correctly finds a round ball.
    const st = stuckAt(1000, 2000);
    updateBallEffects(st, 0.016, 2400);   // one tick, deep inside the flat hold
    expect(compression(st)).toBeGreaterThan(0.25);
    const mid = createBallEffectState();
    triggerWallHit(mid, 1000, 0, -300, 300);
    pinSquish(mid, 1000, 2000);
    updateBallEffects(mid, 0.016, 2600);  // one tick, mid-reinflate
    expect(compression(mid)).toBeGreaterThan(0.25);
  });

  it("forgets the boost once the spring-back has finished", () => {
    // Release is observed on the first tick after the hold and the spring-back
    // plays from there, so the boost lasts until THAT curve ends: a tick at
    // release, then one well past it.
    const st = stuckAt(1000, 2000);
    updateBallEffects(st, 0.016, 3001);
    updateBallEffects(st, 0.016, 3700);
    triggerWallHit(st, 4000, 0, -300, 300);
    const plain = createBallEffectState();
    triggerWallHit(plain, 4000, 0, -300, 300);
    expect(compression(st)).toBeCloseTo(compression(plain), 6);
  });

  it("refuses to pin with no impact axis to pin along", () => {
    const st = createBallEffectState();
    pinSquish(st, 1000, 2000);
    expect(isSquishPinned(st, 1500)).toBe(false);
    expect(getSquishEffect(st).active).toBe(false);
  });
});

// ── 1b. The freeze covers the WHOLE animation ───────────────────────────────
//
// Reported by the owner after playing it: the hold ran the full N seconds, the
// freeze lifted, and the reinflate then played on a ball that was already on
// its way - so it left the wall half-flat and rounded out in flight, which
// reads as a rendering glitch rather than as a ball peeling off a wall. The
// upgrade's seconds are now the WHOLE stuck time: squash in, hold, reinflate,
// and only when it is a round ball again does it carry on with the velocity and
// heading it arrived with.

/** Tick a state every frame up to `ms` after the impact at `t0`. */
function playTo(st: ReturnType<typeof createBallEffectState>, t0: number, ms: number) {
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(st, 1 / 60, t0 + t);
  updateBallEffects(st, 1 / 60, t0 + ms);
  return getSquishEffect(st);
}

describe("the ball is never deformed at a moment it could move", () => {
  const T0 = 5000;

  for (const T of [2000, 3000, 3500]) {
    it(`is exactly round at the end of a ${T / 1000}s stick, and still deformed 100ms before`, () => {
      const st = stuckAt(T0, T);
      expect(playTo(st, T0, T - 100).active, "round before the freeze lifted").toBe(true);
      const end = playTo(st, T0, T);
      expect(end.active).toBe(false);
      expect(end.scaleAlong).toBe(1);
      expect(end.scalePerp).toBe(1);
      expect(st.squishAmount).toBe(0);
    });
  }

  it("plays the reinflate WHILE STUCK: crown lifting, footprint still wide", () => {
    // 100ms into the release, which is 420ms before the ball may move. The
    // crown is already coming back up and the ball is still sitting in a wide
    // flat footprint, which is the whole "un-slump before letting go" beat -
    // and every frame of it now happens on a motionless ball.
    const T = 2000;
    const st = stuckAt(T0, T);
    const flat = playTo(st, T0, T - SPLAT_HELD_OUT_MS);
    const lifting = playTo(st, T0, T - SPLAT_HELD_OUT_MS + 100);
    expect(lifting.scaleAlong).toBeGreaterThan(flat.scaleAlong);   // crown rising
    expect(lifting.scalePerp).toBeGreaterThan(1.3);                // footprint still wide
    expect(isSquishPinned(st, T0 + T - SPLAT_HELD_OUT_MS + 100)).toBe(false);
  });

  it("never stretches a held ball, because it has nowhere to be going yet", () => {
    // The peel is the ball elongating along its departure. A stuck ball has no
    // departure to elongate into - it is frozen, and it is round before it is
    // released - so the dial stays at zero for the whole stick.
    const st = stuckAt(T0, 2000);
    for (let t = 0; t <= 2100; t += 1000 / 60) {
      updateBallEffects(st, 1 / 60, T0 + t);
      expect(st.splatStretch, `stretched at +${Math.round(t)}ms`).toBe(0);
    }
  });

  it("still peels an ordinary bounce, which is not frozen and IS leaving", () => {
    // The other half of the same rule: a bounce keeps its departure stretch,
    // because that ball really is moving away while the shape plays out.
    const st = createBallEffectState();
    triggerWallHit(st, T0, 0, -300, 300);
    let peak = 0;
    for (let t = 0; t <= 400; t += 1000 / 60) {
      updateBallEffects(st, 1 / 60, T0 + t);
      peak = Math.max(peak, st.splatStretch);
    }
    expect(peak).toBeGreaterThan(0.5);
  });
});

// ── 2 & 3. The stick, measured through the headless harness ─────────────────

const BOARD: LevelConfig = {
  id: "bug-squash-board", level: 7, sizeThreshold: 30, expectedCuts: 4,
  points: 5, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1, entities: [],
} as unknown as LevelConfig;

function play(
  mods: Partial<GameModifiers>, seconds: number, seed = "bug-squash-probe",
  pin?: { x: number; y: number; vx: number; vy: number },
) {
  setRunSeedText(seed);
  // Each run starts the virtual clock afresh. installClock is a no-op while a
  // clock is already installed, so two runs in one test would otherwise start
  // 20 seconds apart in absolute time, and "same seed, same board" has to mean
  // the same clock too before two sequences can be expected to match.
  releaseClock();
  installClock();
  const ctx = createBotGame(BOARD, 7, plainModifiers(mods));
  const ball = ctx.game.balls[0];
  // A ball's spawn POSITION is the one unseeded roll left in a map build (its
  // heading is seeded), so a test comparing two runs pins it to isolate the
  // thing actually under test: the seeded stream the stick is rolled from.
  if (pin) {
    ball.position = { x: pin.x, y: pin.y };
    ball.velocity = { x: pin.vx, y: pin.vy };
  }
  const log: Array<{
    t: number; x: number; y: number; vx: number; vy: number;
    stuck: boolean; deformed: boolean;
  }> = [];
  for (let f = 0; f < seconds / PHYSICS_STEP; f++) {
    stepBot(ctx, PHYSICS_STEP);
    const now = simNow();
    log.push({
      t: now, x: ball.position.x, y: ball.position.y, vx: ball.velocity.x, vy: ball.velocity.y,
      stuck: ball.bugSquashUntil !== undefined && now < ball.bugSquashUntil,
      deformed: getSquishEffect(ball.effects).active,
    });
  }
  return { ctx, ball, log };
}

describe("a stuck ball stays put and then carries on", () => {
  it("sticks on the first wall hit at 100%, holds still, keeps its velocity, then moves again", () => {
    const { log } = play({ bugSquashChance: 100, bugSquashSeconds: 2 }, 8);
    const first = log.findIndex(e => e.stuck);
    expect(first, "the ball never stuck to a wall").toBeGreaterThan(0);
    const stuckRun = log.slice(first).findIndex(e => !e.stuck);
    expect(stuckRun, "the ball never let go").toBeGreaterThan(0);
    const held = log.slice(first, first + stuckRun);
    // Held for the authored two seconds, to within a physics step either side.
    expect(held.length * PHYSICS_STEP).toBeGreaterThan(2 - 2 * PHYSICS_STEP);
    expect(held.length * PHYSICS_STEP).toBeLessThan(2 + 2 * PHYSICS_STEP);
    // Not a pixel of drift while stuck.
    for (const e of held) {
      expect(e.x).toBe(held[0].x);
      expect(e.y).toBe(held[0].y);
    }
    // The velocity it bounced off with is the velocity it leaves with.
    const release = log[first + stuckRun];
    expect(release.vx).toBeCloseTo(held[0].vx, 6);
    expect(release.vy).toBeCloseTo(held[0].vy, 6);
    // And it actually leaves.
    const later = log[first + stuckRun + 30];
    expect(Math.hypot(later.x - held[0].x, later.y - held[0].y)).toBeGreaterThan(1);
  });

  it("is round on the very first frame it moves again", () => {
    // The invariant, measured through the real physics rather than the
    // envelope: a stuck ball does not move while it is deformed, and it is not
    // deformed once it moves. The whole squash-hold-reinflate now happens on a
    // motionless ball, so the frame it sets off carries a perfectly round one.
    const { log } = play({ bugSquashChance: 100, bugSquashSeconds: 2 }, 8);
    const first = log.findIndex(e => e.stuck);
    const stuckRun = log.slice(first).findIndex(e => !e.stuck);
    expect(first, "the ball never stuck to a wall").toBeGreaterThan(0);
    expect(stuckRun, "the ball never let go").toBeGreaterThan(0);
    const held = log.slice(first, first + stuckRun);
    // Still visibly reinflating a few frames before the release...
    expect(held[held.length - 6].deformed, "already round while still stuck").toBe(true);
    // ...and round on the frame it starts moving, and never deformed after it.
    for (const e of log.slice(first + stuckRun, first + stuckRun + 20)) {
      expect(e.deformed, "moving while still deformed").toBe(false);
    }
    // Which is also the first frame it has moved since it stuck.
    expect(log[first + stuckRun].x !== held[0].x || log[first + stuckRun].y !== held[0].y).toBe(true);
  });

  it("is a held ball by every existing rule, without the tap-freeze thaw cooldown", () => {
    const { ball, log } = play({ bugSquashChance: 100, bugSquashSeconds: 2 }, 3);
    expect(log.some(e => e.stuck)).toBe(true);
    // Rides frozenUntil (immovable in collisions, no trail, Frozen Assets pays)...
    expect(ball.frozenUntil).toBe(ball.bugSquashUntil);
    // ...but a thaw cooldown is a tax on taps, and no tap was made.
    expect(ball.freezeReadyAt).toBeUndefined();
  });

  it("never sticks at 0%, and never sticks with no duration", () => {
    expect(play({ bugSquashChance: 0, bugSquashSeconds: 2 }, 6).log.some(e => e.stuck)).toBe(false);
    expect(play({ bugSquashChance: 100, bugSquashSeconds: 0 }, 6).log.some(e => e.stuck)).toBe(false);
  });

  it("sticks sometimes, not always, at an ordinary chance", () => {
    // 12% over enough wall hits: some sticks, and long stretches of bouncing.
    const { log } = play({ bugSquashChance: 12, bugSquashSeconds: 1 }, 60);
    const stuckFrames = log.filter(e => e.stuck).length;
    expect(stuckFrames).toBeGreaterThan(0);
    expect(stuckFrames).toBeLessThan(log.length / 2);
  });

  it("replays the same sticks on the same seed", () => {
    // runStream, not getRunRng: a fresh generator per hit would return the
    // same number every time and a Daily would stick every wall or none.
    const pin = { x: 450, y: 450, vx: 180, vy: 140 };
    const run = (seed: string) =>
      play({ bugSquashChance: 30, bugSquashSeconds: 1 }, 20, seed, pin).log.map(e => e.stuck);
    const a = run("daily:2026-09-12");
    const b = run("daily:2026-09-12");
    expect(a).toEqual(b);
    expect(a.some(Boolean)).toBe(true);
    expect(run("daily:2026-09-13")).not.toEqual(a);
  });

  it("holds ANY frozen ball in the harness, not only a squashed one", () => {
    // The pre-existing divergence this feature closed: the browser loop skips
    // a frozen ball before updateBall, the harness never did. A tap-freeze,
    // Cold Boot or a Breakpoint hold now stops a ball in a bot sweep too.
    setRunSeedText("frozen-probe");
    installClock();
    const ctx = createBotGame(BOARD, 7, plainModifiers());
    const ball = ctx.game.balls[0];
    stepBot(ctx, PHYSICS_STEP);
    ball.frozenUntil = simNow() + 1000;
    const { x, y } = ball.position;
    for (let f = 0; f < 60; f++) stepBot(ctx, PHYSICS_STEP);
    expect(ball.position.x).toBe(x);
    expect(ball.position.y).toBe(y);
  });
});

// ── The catalogue ───────────────────────────────────────────────────────────

describe("the Bug Squash family", () => {
  it("adds up to the advertised 12% and 3.5s", () => {
    const m = computeGameModifiers(FAMILY, lookup);
    expect(m.bugSquashChance).toBe(12);
    expect(m.bugSquashSeconds).toBe(3.5);
    const junior = computeGameModifiers([FAMILY[0]], lookup);
    expect(junior.bugSquashChance).toBe(5);
    expect(junior.bugSquashSeconds).toBe(2);
    const senior = computeGameModifiers(FAMILY.slice(0, 2), lookup);
    expect(senior.bugSquashChance).toBe(8);
    expect(senior.bugSquashSeconds).toBe(3);
  });

  it("ends on a choice, like every family: more sticks or longer ones", () => {
    // The catalogue's rule (upgradeForks.test) is that a last tier is a
    // decision, never one more percentage point. A is the requested 12%/3.5s;
    // B keeps the odds and triples the hold, so the rare catch is a long one.
    const b = computeGameModifiers([...FAMILY.slice(0, 2), FORK_B], lookup);
    expect(b.bugSquashChance).toBe(8);
    expect(b.bugSquashSeconds).toBe(6);
    const [, , a] = FAMILY.map(id => lookup.get(id)!);
    const bb = lookup.get(FORK_B)!;
    expect(a.choiceGroup).toBe("bug_squash_principal");
    expect(bb.choiceGroup).toBe(a.choiceGroup);
    expect(bb.prerequisites).toEqual(a.prerequisites);
    expect(bb.tier).toBe(a.tier);
  });

  it("is a chain in the freeze archetype with a registered icon", () => {
    const [j, s, p] = FAMILY.map(id => lookup.get(id)!);
    expect(j.prerequisites ?? []).toEqual([]);
    expect(s.prerequisites).toEqual([j.id]);
    expect(p.prerequisites).toEqual([s.id]);
    for (const u of [j, s, p, lookup.get(FORK_B)!]) expect(u.tags).toEqual(["freeze"]);
    expect(j.unlockLevel).toBeLessThan(s.unlockLevel);
    expect(s.unlockLevel).toBeLessThan(p.unlockLevel);
    for (const u of [j, s, p, lookup.get(FORK_B)!]) expect(getUpgradeIcon(u, UPGRADES), u.id).not.toBeNull();
  });

  it("describes what it does without an em-dash, in every tier", () => {
    for (const u of [...FAMILY, FORK_B].map(id => lookup.get(id)!)) {
      expect(u.description).not.toContain("—");
      expect(u.description).toMatch(/%/);
      expect(u.description).toMatch(/\ds/);
    }
  });

  it("has its Specs-panel strings in every locale", () => {
    for (const loc of ["en", "es", "sv"]) {
      const d = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${loc}.json`), "utf8"));
      for (const k of ["bugSquash", "bugSquashActive", "bugSquashInactive"]) {
        expect(typeof d.bottomBarDetails?.[k], `${loc} ${k}`).toBe("string");
        expect(d.bottomBarDetails[k]).not.toContain("—");
      }
    }
  });
});

describe("the Specs panel confirms it", () => {
  it("lists the odds and the hold when owned", () => {
    render(<ModifierBreakdown activeModifiers={{ ...DEFAULT_MODIFIERS, bugSquashChance: 8, bugSquashSeconds: 3 }} />);
    expect(screen.getByText("Bug Squash")).toBeTruthy();
    expect(screen.getByText("8%")).toBeTruthy();
    expect(screen.getByText(/squash the ball flat for 3s/)).toBeTruthy();
  });

  it("reads as inactive when not owned", () => {
    render(<ModifierBreakdown activeModifiers={DEFAULT_MODIFIERS} />);
    expect(screen.getByText(/No Bug Squash owned/)).toBeTruthy();
  });
});

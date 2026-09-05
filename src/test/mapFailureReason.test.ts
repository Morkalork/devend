/**
 * A life lost to a win condition always comes with the reason.
 *
 * Reported as "when I lose a life because I failed a win condition, I must be
 * told why". The deadline was the clearest case: a life was docked, the screen
 * flashed red for 700ms and the level remounted, and at no point did anything
 * name the clock. From the player's side a life simply vanished.
 *
 * The rule is enforced at the SEAM, not on the text. Whether a sentence renders
 * is the UI's business, but a reason that never leaves the physics layer cannot
 * be rendered by anyone, and that is what was actually wrong. So these drive the
 * real win check and assert the failure arrives at the callback that has to
 * explain it, with the numbers still attached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
  vibrateDeath: () => {}, vibrateGameOver: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { getMapTimeLimit } from "@/lib/mapTiming";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { mapFailure, failHeadline, failLines, MAP_FAIL_KINDS, type MapFailKind } from "@/lib/mapFailure";
import { WIN_CONDITION_KINDS } from "@/types/winSpec";
import type { WinSpec, WinSnapshot, WinCondition, WinConditionKind } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GameResult } from "@/types/game";

const LEVEL = {
  id: "reason-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
  maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
} as unknown as LevelConfig;

function harness(lives: number) {
  let current = lives;
  const shakeTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const flashTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const calls = {
    timedOutWith: [] as unknown[],
    endedWith: [] as GameResult[],
  };
  const callbacks = {
    getLives: () => current,
    setLivesRef: (n: number) => { current = n; },
    setDisplayLives: () => {},
    onLivesChange: () => {},
    onMapTimedOut: (f: unknown) => { calls.timedOutWith.push(f); },
    setScreenFlash: () => {},
    setIsShaking: () => {},
    shakeTimeoutRef, flashTimeoutRef,
    setRemainingPercent: () => {},
    repaintRegionCanvas: () => {},
    startDissolve: () => {},
    onGameOver: () => {},
    onGameEnd: (r: GameResult) => { calls.endedWith.push(r); },
    onLevelComplete: () => {},
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
  } as unknown as GameCallbacks;
  return { callbacks, calls };
}

function gameAt(seconds: number): CanvasGameState {
  const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
  return {
    ...data, balls: data.balls, walls: data.walls, activeWalls: [],
    movers: data.movers ?? [], objectDebris: [], destructibles: [], pendingDestroys: [],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: seconds,
    levelComplete: false, gameOver: false, pushMode: "none",
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("running out of time says so", () => {
  const LIMIT = getMapTimeLimit(LEVEL, 12)!;

  it("hands the restart a reason, not just a restart", () => {
    const h = harness(3);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.timedOutWith).toHaveLength(1);
    const failure = h.calls.timedOutWith[0] as ReturnType<typeof mapFailure>;
    expect(failure, "the restart fired with nothing to explain it").toBeTruthy();
    expect(failure.kind).toBe("timeUp");
  });

  it("says what was still outstanding, with the numbers", () => {
    // The map is untouched, so the space requirement is a long way off. That
    // gap is the useful half of the answer: "out of time" is a rule the player
    // knew, "you were at 100% and needed 40%" is what they can act on.
    const h = harness(3);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    const failure = h.calls.timedOutWith[0] as ReturnType<typeof mapFailure>;
    expect(failure.unmet.length, "nothing was listed as outstanding").toBeGreaterThan(0);
    const space = failure.unmet.find(p => p.condition.kind === "space");
    expect(space, "the space clear was unmet and should be named").toBeTruthy();
    expect(space!.target).toBe(LEVEL.sizeThreshold);
    expect(space!.current).toBeGreaterThan(space!.target);
  });

  it("carries the reason out to the result screen on the last life", () => {
    // The run ends here, so the in-map overlay never shows. The final screen is
    // the only thing left that can answer the question.
    const h = harness(1);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.endedWith).toHaveLength(1);
    const result = h.calls.endedWith[0];
    expect(result.isWin).toBe(false);
    expect(result.failure, "the run ended with a bare GAME OVER").toBeTruthy();
    expect(result.failure!.kind).toBe("timeUp");
  });
});

describe("the reason itself", () => {
  const spec: WinSpec = {
    require: [
      { kind: "space", threshold: 20 },
      { kind: "locks", count: 3 },
    ],
    alsoWinIf: [{ kind: "allLocked" }],
    authored: true,
  } as WinSpec;

  const snap = {
    remainingPercent: 55, lockedBalls: 1, superiorLocks: 0, areaTargets: 0,
    lockedByType: {}, bossDefeated: false, allLocked: false,
    cuts: 4, par: 6, activeSeconds: 30,
  } as WinSnapshot;

  it("lists every requirement that was not met", () => {
    const f = mapFailure("timeUp", spec, snap);
    expect(f.unmet.map(p => p.condition.kind).sort()).toEqual(["locks", "space"]);
  });

  it("keeps how close each one came", () => {
    const locks = mapFailure("timeUp", spec, snap).unmet
      .find(p => p.condition.kind === "locks")!;
    expect(locks.current).toBe(1);
    expect(locks.target).toBe(3);
  });

  it("leaves met requirements out", () => {
    const met = { ...snap, remainingPercent: 5, lockedBalls: 3 };
    expect(mapFailure("timeUp", spec, met).unmet).toEqual([]);
  });

  it("does not list an alternative the player simply did not take", () => {
    // "Or lock every ball" is a door, not a reason the map was lost. Listing it
    // would bury the requirement that actually stopped them.
    const f = mapFailure("timeUp", spec, snap);
    expect(f.unmet.some(p => p.condition.kind === "allLocked")).toBe(false);
  });
});

/**
 * Every reason has words, in every language. A failure that reaches the screen
 * as a raw key ("mapFailure.timeUp") is the silent loss again with extra steps.
 */
describe("every reason has words in every language", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  // Derived, not hand-listed. The hand-written version had drifted three kinds
  // behind the union, so launcherPrematureLock could have shipped with no
  // words in any language and nothing would have said so.
  const KINDS: MapFailKind[] = MAP_FAIL_KINDS;
  const CHROME = ["title", "stillNeeded", "tapToRetry", "livesLeft_one", "livesLeft_other"];

  const block = (lang: string) => JSON.parse(
    readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), "utf8"),
  ).mapFailure as Record<string, string>;

  it.each(LOCALES)("%s carries every kind, clause and chrome key", (lang) => {
    const b = block(lang);
    expect(b, `${lang} has no mapFailure block`).toBeTruthy();
    for (const key of [...KINDS, ...CHROME]) {
      expect(b[key], `${lang}.mapFailure.${key}`).toBeTruthy();
    }
  });

  /**
   * Driven through failLines rather than against a parallel list of keys.
   *
   * The old test checked a hand-written NEED_KEYS array, which is a second
   * statement of what failLines already knows and drifts the same way the kind
   * list did: `delivered` was a legal clause with no case in that switch, so it
   * produced `undefined` and the array never noticed. Asking the real function
   * for a line per clause kind cannot go stale.
   */
  it.each(LOCALES)("%s explains every kind of unmet requirement", (lang) => {
    const b = block(lang);
    const t = ((key: string) => {
      const short = key.replace(/^mapFailure\./, "");
      return b[short] ?? `MISSING:${short}`;
    }) as unknown as Parameters<typeof failLines>[0];

    const sample: Record<WinConditionKind, WinCondition> = {
      space: { kind: "space", threshold: 20 },
      locks: { kind: "locks", count: 2 },
      superiorLocks: { kind: "superiorLocks", count: 1 },
      area: { kind: "area", count: 1 },
      lockType: { kind: "lockType", ballType: "black", count: 1 },
      boss: { kind: "boss" },
      allLocked: { kind: "allLocked" },
      smashed: { kind: "smashed", count: 1 },
      terminals: { kind: "terminals", count: 1 },
      harvested: { kind: "harvested", count: 1 },
      delivered: { kind: "delivered", count: 1 },
      underPar: { kind: "underPar", delta: 0 },
      speedClear: { kind: "speedClear", seconds: 30 },
    };

    for (const kind of WIN_CONDITION_KINDS) {
      const lines = failLines(t, {
        kind: "timeUp",
        unmet: [{
          condition: sample[kind], current: 0, target: 1, met: false, mode: "accumulate",
        }],
      });
      expect(lines[0], `${lang}: no line for an unmet ${kind}`).toBeTruthy();
      expect(lines[0], `${lang}: ${kind} has no words`).not.toMatch(/^MISSING:/);
    }
  });

  it("uses no em-dash in any of them, per the project rule", () => {
    for (const lang of LOCALES) {
      for (const [key, value] of Object.entries(block(lang))) {
        expect(value.includes("—"), `${lang}.mapFailure.${key}`).toBe(false);
      }
    }
  });

  it("renders a headline and a line for a real failure", () => {
    // A stand-in t: returns the key, so a MISSING branch shows up as undefined
    // rather than as a plausible-looking string.
    const t = ((k: string) => k) as unknown as Parameters<typeof failHeadline>[0];
    const f = mapFailure(
      "timeUp",
      { require: [{ kind: "locks", count: 2 }], alsoWinIf: [], authored: true } as WinSpec,
      { lockedBalls: 0 } as unknown as WinSnapshot,
    );
    expect(failHeadline(t, f)).toBe("mapFailure.timeUp");
    expect(failLines(t, f)).toEqual(["mapFailure.needLocks"]);
  });
});

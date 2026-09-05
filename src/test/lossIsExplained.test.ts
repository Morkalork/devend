/**
 * A life never goes without the game saying why.
 *
 * Six things can cost a life or end a run, and three of them used to say
 * nothing at all. `handleGameOverFn` took the reason as an OPTIONAL argument,
 * on the stated grounds that the ordinary death - a ball through your fence -
 * is a hazard the player watched happen. That holds while the map continues.
 * It does not hold at zero lives, where the same event ends the RUN: a ball on
 * the cut line, a mover cutting your fence on the last life and a ball cutting
 * it on the last life all finished twenty minutes of play on a bare GAME OVER,
 * and the results screen had a `failure` block it simply never received.
 *
 * The argument is required now, so the compiler refuses a silent loss. These
 * tests cover the half a type cannot: that the reason is the RIGHT one, that
 * it survives out to the screen that renders it, and that a life lost mid-map
 * is explained without stopping play.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_FAIL_KINDS, mapFailure, failHeadline, failLines } from "@/lib/mapFailure";
import { GAME_MESSAGE_IDS } from "@/lib/gameMessages";
import type { WinSpec, WinSnapshot } from "@/types/winSpec";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("every run-ending path names its cause", () => {
  /**
   * THE structural guard, and the reason the parameter was made required
   * rather than merely filled in everywhere once: a bare call is now a
   * compile error, so this asserts the shape that makes that true.
   */
  it("takes the reason as a required argument, not an optional one", () => {
    const src = read("src/lib/physics/handleGameOver.ts");
    expect(src, "the reason went back to being optional").toContain("failure: MapFailure,");
    expect(src, "an optional reason is a loss nobody can explain")
      .not.toContain("failure?: MapFailure,");
  });

  it("leaves no game-over call without one", () => {
    // Belt and braces against the type: a caller could still pass a value that
    // is not really a reason. Every call site should mention a failure.
    for (const file of [
      "src/lib/physics/applyCut.ts",
      "src/lib/physics/updateFenceWall.ts",
    ]) {
      const src = read(file);
      const bare = src.match(/handleGameOverFn\([^)]*callbacks\s*\)/g) ?? [];
      expect(bare, `${file} ends the run without saying why`).toEqual([]);
    }
  });

  it("blames the ball for a ball, and the mover for a mover", () => {
    // One kind for both would be a lie about which thing on the board killed
    // you, and the lesson differs: a ball is dodgeable, a patrol is a timing
    // window.
    const src = read("src/lib/physics/updateFenceWall.ts");
    expect(src).toContain('fenceDeath("ballHitFence"');
    expect(src).toContain('fenceDeath("moverHitFence"');
  });
});

describe("a life lost mid-map is explained without stopping play", () => {
  const src = read("src/lib/physics/updateFenceWall.ts");

  it("says what happened when a life remains", () => {
    expect(src, "a ball cutting your fence still says nothing")
      .toContain('callbacks.onGameMessage?.("lifeLostBall")');
    expect(src, "a mover cutting your fence still says nothing")
      .toContain('callbacks.onGameMessage?.("lifeLostMover")');
  });

  it("says it in the bar, never in a modal", () => {
    // The map is still being played. A dialog over a live board is worse than
    // the silence it replaces, and the recovery window is already running.
    expect(src, "a blocking overlay was wired into a live board")
      .not.toMatch(/onMapTimedOut/);
  });

  it("carries both new ids in the catalogue", () => {
    expect(GAME_MESSAGE_IDS).toContain("lifeLostBall");
    expect(GAME_MESSAGE_IDS).toContain("lifeLostMover");
  });
});

describe("every reason renders", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  const block = (lang: string) =>
    JSON.parse(read(`src/i18n/locales/${lang}.json`)).mapFailure as Record<string, string>;

  it.each(LOCALES)("%s writes a headline for every kind", (lang) => {
    const b = block(lang);
    const lookup = (key: string) => b[key.replace(/^mapFailure\./, "")] ?? `MISSING:${key}`;
    const t = lookup as unknown as Parameters<typeof failHeadline>[0];
    for (const kind of MAP_FAIL_KINDS) {
      const headline = failHeadline(t, { kind, unmet: [] });
      expect(headline, `${lang}: ${kind}`).toBeTruthy();
      expect(headline, `${lang}: ${kind} has no words`).not.toMatch(/^MISSING:/);
    }
  });

  /**
   * The unmet list is the useful half. "You lost" is a rule the player already
   * knew; "you were at 60% and needed 25%" is what they can act on, and it is
   * the only record of how close they had come once the board is torn down.
   */
  it("keeps the numbers on a run-ending death, not just the headline", () => {
    const spec = {
      require: [{ kind: "space", threshold: 25 }, { kind: "smashed", count: 2 }],
      alsoWinIf: [], authored: true,
    } as WinSpec;
    const snap = { remainingPercent: 60, smashed: 1 } as unknown as WinSnapshot;
    const failure = mapFailure("ballHitFence", spec, snap);

    expect(failure.unmet, "a death threw away what the player had achieved").toHaveLength(2);
    const t = ((k: string) => k) as unknown as Parameters<typeof failLines>[0];
    expect(failLines(t, failure)).toHaveLength(2);
  });
});

/**
 * A post-break freeze must never outlive the thing that scheduled it.
 *
 * Reported from a real session: "balls can sometimes stop mid-air". Not against
 * a wall - in open space, which rules out every collision path.
 *
 * When a growing fence is broken by a ball, that ball is frozen in place for the
 * shake: `frozenBallId` is set and its velocity zeroed. updateBall then skips it
 * entirely, handleBallCollisions skips it, and the minimum-speed floor that
 * restarts a stopped ball is skipped too - so nothing downstream can rescue a
 * freeze that is never lifted. There are two ways it never gets lifted:
 *
 *   1. The release runs from a setTimeout kept in the SHARED shake-timer ref,
 *      and applyCut, handleGameOver and the canvas cleanup all clear that ref
 *      and install callbacks of their own that know nothing about freezing.
 *      Cancelled inside the 400ms window, the release simply never happens.
 *
 *   2. The freeze was not cleared when the MAP changed. gameRef is built once
 *      and mutated per map, so anything the per-map reset forgets survives the
 *      transition - and ball ids are type-id plus index, unique only within one
 *      map. A leaked frozen id of "grey-0" therefore freezes the NEXT map's
 *      grey-0 from its opening frame, and a still-pending timer restores it to
 *      the PREVIOUS map's coordinates.
 *
 * So: the freeze is cleared through one function (four hand-copied clears are
 * how the deadline came to be missing from one of them), the map reset calls it,
 * the restore checks ball IDENTITY rather than looking an id up, and the loop
 * enforces a deadline in case the timer never comes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { FREEZE_MAX_MS, SHAKE_MS, clearFreeze } from "@/lib/physics/fenceStrike";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const levels = (yaml.load(read("public/map.yml")) as LevelData).levels;

describe("clearing a freeze", () => {
  it("drops every part of it, not just the id", () => {
    // A half-cleared freeze is what makes the next reader wrong: an id with no
    // deadline is invisible to the loop's net, and a deadline with no id fires
    // against nothing.
    const game = {
      frozenBallId: "grey-0",
      frozenBallPosition: { x: 1, y: 2 },
      frozenBallVelocity: { x: 3, y: 4 },
      frozenBallReleaseAt: 12345,
    } as unknown as CanvasGameState;

    clearFreeze(game);

    expect(game.frozenBallId).toBeNull();
    expect(game.frozenBallPosition).toBeNull();
    expect(game.frozenBallVelocity).toBeNull();
    expect(game.frozenBallReleaseAt).toBeNull();
  });
});

describe("why a leaked freeze is dangerous", () => {
  it("ball ids repeat from one map to the next", () => {
    // This is the fact the whole map-reset argument rests on, so it is pinned
    // rather than assumed. If ball ids ever become globally unique this test
    // fails, and whoever made them unique gets told that the hazard moved.
    const ids = (id: string) => {
      const level = levels.find(l => l.id === id)!;
      const data = createInitialGameData(level, level.level, DEFAULT_MODIFIERS);
      return new Set(data.balls.map(b => b.id));
    };
    const a = ids("level-1");
    const b = ids("level-2");
    const shared = [...a].filter(x => b.has(x));
    expect(a.size, "level-1 has no balls").toBeGreaterThan(0);
    expect(shared.length, "ids happen to be unique across maps").toBeGreaterThan(0);
  });
});

describe("the post-break freeze always lets go", () => {
  it("is cleared when a new map starts", () => {
    // gameRef is mutated per map, so the reset block is the ONLY thing standing
    // between a freeze and the next level.
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src, "the per-map reset never clears the freeze").toContain("clearFreeze(game)");
  });

  it("restores by identity, never by an id lookup", () => {
    // Looking the ball up by id is the retarget: on the next map it finds a
    // DIFFERENT ball wearing the same name and teleports it.
    const src = read("src/lib/physics/fenceStrike.ts");
    const idx = src.indexOf("const unfreezeAfterShake");
    expect(idx, "the unfreeze callback is gone").toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 900);
    expect(block, "still looks the ball up by id").not.toMatch(/find\(\s*b\s*=>\s*b\.id/);
    expect(block, "does not check the ball is still on this map")
      .toContain("game.balls.includes(ball)");
  });

  it("gives the normal timer room to win", () => {
    // The shake timer releases the freeze. If the deadline were at or under it
    // the safety net would fire on every ordinary break, restoring the ball a
    // beat early and making the shake look broken.
    //
    // Read as constants rather than grepped out of the source: this used to
    // scrape `}, 400)` out of the file, which stopped matching the moment the
    // shake moved into a helper and quietly found nothing to check.
    expect(FREEZE_MAX_MS, "the net fires before the shake finishes")
      .toBeGreaterThan(SHAKE_MS);
  });

  it("keeps the shake on one number", () => {
    // The pairing above only means something if every unfreeze is on SHAKE_MS.
    // A second hand-written duration would be a timer the constant does not
    // describe and the check above cannot see.
    const src = read("src/lib/physics/fenceStrike.ts");
    const idx = src.indexOf("export const SHAKE_MS");
    const body = src.slice(src.indexOf("function flashAndShake"));
    expect(idx, "SHAKE_MS is gone").toBeGreaterThan(-1);
    expect(body, "a shake duration was written out by hand").not.toMatch(/\},\s*\d+\);/);
  });

  it("records a deadline whenever it freezes a ball", () => {
    // A freeze with no deadline is exactly the stranding case: the loop has
    // nothing to enforce and the timer is the only way out.
    const src = read("src/lib/physics/fenceStrike.ts");
    const freezes = [...src.matchAll(/game\.frozenBallId\s*=\s*ball\.id;/g)].length;
    const deadlines = [...src.matchAll(/game\.frozenBallReleaseAt\s*=\s*performance\.now\(\)/g)].length;
    expect(freezes, "no freeze site found").toBeGreaterThan(0);
    expect(deadlines, "a freeze was set without a deadline").toBe(freezes);
  });

  it("clears through the one function, never by hand", () => {
    // Hand-copied clears are how the deadline came to be missing from one of
    // them. No loose assignment should be left anywhere.
    for (const file of [
      "src/lib/physics/fenceStrike.ts",
      "src/lib/physics/updateFenceWall.ts",
      "src/hooks/useGameLoop.ts",
      "src/components/game/GameCanvas.tsx",
    ]) {
      const src = read(file);
      // The one inside clearFreeze itself is the definition, not a copy.
      const body = file.endsWith("fenceStrike.ts")
        ? src.slice(src.indexOf("export function clearFreeze") + 200)
        : src;
      expect(
        [...body.matchAll(/game\.frozenBallId\s*=\s*null;/g)].length,
        `${file} clears the freeze by hand`,
      ).toBe(0);
    }
  });

  it("enforces the deadline in the loop, not only in the timer", () => {
    // The whole point. If the release existed only inside the setTimeout, a
    // cancelled timer would still strand the ball.
    const loop = read("src/hooks/useGameLoop.ts");
    expect(loop, "the loop never compares the deadline to the clock")
      .toMatch(/performance\.now\(\)\s*>\s*game\.frozenBallReleaseAt/);
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    expect(idx).toBeGreaterThan(-1);
    const block = loop.slice(idx, idx + 1400);
    // And it must actually release, not merely notice.
    expect(block, "notices the stranding without clearing it").toContain("clearFreeze(game)");
  });

  it("hands the ball back the velocity it was carrying", () => {
    // Restarting it from the speed floor in an arbitrary direction is a second,
    // quieter way for the break to rob the player: they lose the read they had
    // on that ball as well as the fence.
    const loop = read("src/hooks/useGameLoop.ts");
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    expect(loop.slice(idx, idx + 1400)).toContain("game.frozenBallVelocity");
  });

  it("says so when it fires", () => {
    // This only ever runs because a timer was cancelled by something that did
    // not know a ball was frozen. That is a real fault and should leave a
    // trace, not be silently papered over.
    const loop = read("src/hooks/useGameLoop.ts");
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    expect(loop.slice(idx, idx + 1400)).toContain("console.warn");
  });
});

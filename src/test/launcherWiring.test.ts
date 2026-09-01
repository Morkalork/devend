/**
 * The launcher has to be handed to the canvas, or none of it exists.
 *
 * Reported as "the rubber band doesn't seem to work, I'm trying to pull and
 * release but nothing happens", and it was true of every launcher map since the
 * feature shipped. Nothing was wrong with the geometry, the aim, the pull or the
 * fire: `GameCanvas`'s per-map block copies each field of the freshly built map
 * onto the long-lived `gameRef` by hand - walls, movers, circuit, charges,
 * delivery boxes, fence zones - and simply never copied `launchers`.
 *
 * So `game.launchers` was undefined forever, `pendingLauncher` always answered
 * null, `LaunchOverlay` never mounted, and the map opened with its balls asleep
 * and nothing on screen to wake them. Silent in the worst way: no error, no
 * warning, and not even an unwinnable-looking board - just a map that sat there.
 * The dormant balls also hold their region uncapturable, so it could not be
 * cleared either.
 *
 * That block's own comment already warns about exactly this - "gameRef is built
 * once and mutated per map, so anything this block forgets survives the
 * transition" - which is why the check below is on the block rather than on the
 * launcher: the bug is the hand-copy, and the next field added to initGame can
 * be forgotten the same way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "src/components/game/GameCanvas.tsx"), "utf8",
);

describe("the per-map block hands the launcher over", () => {
  it("assigns launchers from the freshly built map", () => {
    // The one line whose absence made the whole feature inert.
    expect(SRC, "GameCanvas never copies data.launchers onto the game")
      .toMatch(/game\.launchers\s*=\s*data\.launchers/);
  });

  it("mounts the overlay off the live launcher list, not off the level config", () => {
    // Reading the LEVEL for a launcher would have hidden the bug: the entity is
    // in map.yml either way, so the overlay would mount and then fire nothing.
    expect(SRC).toMatch(/pendingLauncher\(game\b/);
  });
});

/**
 * The armed cup is published by the effect that BUILDS the map.
 *
 * The second reason the band did nothing, and a much better-disguised one than
 * the missing assignment: `setPendingLaunch` lived in its own effect keyed on
 * [level.id, levelNumber], reading `gameRef.current.launchers`. Both that effect
 * and the map-build effect go dirty on the same level change, React runs effects
 * in DECLARATION order, and the little one was declared some three hundred lines
 * earlier - so it ran first and read the launchers of the map the player had
 * just left. Arriving at level 11 from level 10, which has no launcher, it read
 * undefined, set null, and never ran again.
 *
 * What makes it worth a test rather than a comment is how it failed: a
 * ?level=11 debug jump changes the level prop a second time, so the re-run reads
 * a populated ref and everything looks correct. It worked exactly where it was
 * tested and broke exactly where it was played, which no amount of jumping
 * straight to the map would ever have shown.
 *
 * So the rule is positional, because the bug was positional.
 */
describe("nothing reads the launchers before the map is built", () => {
  const at = (re: RegExp) => {
    const m = SRC.match(re);
    return m?.index ?? -1;
  };

  it("publishes the pending cup only after assigning them", () => {
    const assigned = at(/game\.launchers\s*=\s*data\.launchers/);
    expect(assigned, "the assignment is gone").toBeGreaterThan(-1);

    // Every place the pending cup is set, other than the one inside onFire
    // (which re-arms the NEXT cup on a two-cup map and is a user action, not a
    // map build).
    const sets = [...SRC.matchAll(/setPendingLaunch\(/g)].map(m => m.index ?? -1);
    expect(sets.length, "nothing arms the plunger at all").toBeGreaterThan(0);

    const beforeBuild = sets.filter(i => i < assigned);
    expect(
      beforeBuild,
      "setPendingLaunch runs before game.launchers is assigned, so it reads the "
      + "PREVIOUS map's launchers - the overlay will not mount when the player "
      + "walks into a launcher map from an ordinary one",
    ).toEqual([]);
  });

  it("does not arm it from a separate effect keyed on the level", () => {
    // The specific shape that broke: its own effect, earlier in the file,
    // racing the build. Any future one would race it the same way.
    expect(
      SRC,
      "the plunger is armed from an effect that races the map build again",
    ).not.toMatch(/setPendingLaunch\(pendingLauncher\(gameRef\.current\)\)/);
  });
});

/**
 * Every per-map field initGame produces has to be picked up by that block.
 *
 * Generated rather than listed, so a field added to initGame and forgotten in
 * GameCanvas fails here instead of shipping as a feature that silently does
 * nothing. The allowlist below is for the fields the canvas deliberately
 * handles differently - it has to be edited on purpose, which is the point.
 */
describe("nothing else initGame builds is silently dropped", () => {
  const INIT = readFileSync(resolve(process.cwd(), "src/lib/initGame.ts"), "utf8");

  /** Fields the canvas legitimately does not copy straight across. */
  const HANDLED_ELSEWHERE = new Set([
    // Rotated into the board frame from the level, not taken from `data`.
    "coloredAreas", "pickupSpots", "gravityWells",
    // Read via data.mapRotation at the call sites above.
    "mapRotation",
    // Consumed as bossActive/bossHp/bossMaxHp, which the block does copy.
    "launchPower",
  ]);

  it("copies every field of the returned map onto the game", () => {
    // The object literal initGame returns, as a list of its keys.
    const ret = INIT.slice(INIT.lastIndexOf("\n  return {"));
    const built = [...ret.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*)[,:]/gm)].map(m => m[1]);
    expect(built.length, "could not read initGame's return object").toBeGreaterThan(10);

    const missing = built.filter(
      f => !HANDLED_ELSEWHERE.has(f) && !new RegExp(`data\\.${f}\\b`).test(SRC),
    );
    expect(missing, `GameCanvas never reads these from the built map: ${missing.join(", ")}`)
      .toEqual([]);
  });
});

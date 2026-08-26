/**
 * Named Delivery: an assignment that names the ball it wants sealed.
 *
 * Every other mission in the pool counts locks, superior locks, cuts or
 * seconds - things a player does anyway, so the mission only ever says "do more
 * of that". A bounty changes the question from "can I seal something" to "can I
 * seal THAT", which means passing up easy pockets on the wrong colour.
 *
 * The whole thing lives or dies on one guarantee: the named type has to be one
 * the block's five maps actually spawn. `selectBallTypesForMap` is seeded on
 * the map id and level alone - no run seed, no Math.random - so the roster is
 * knowable at draft time and the bounty is set from it rather than guessed. A
 * mission asking for a green over a block that never spawns one is the dead
 * mission assignmentScaling.ts already exists to prevent.
 */
import { describe, it, expect } from "vitest";
import "@/i18n"; // side-effect: initialise react-i18next synchronously
import i18n from "@/i18n";
import { contentText } from "@/i18n/content";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  blockBallTypeSpread, pickBountyType, resolveBountyForBlock,
  assignmentsPlayableInBlock, scaleOffersForBlock, BLOCK_SIZE,
} from "@/lib/assignmentScaling";
import { conditionMetForMap, assignmentMetric } from "@/lib/assignments";
import { selectBallTypesForMap } from "@/lib/ballTypes";
import type { AssignmentConfig, AssignmentMapResult } from "@/types/assignment";
import type { LevelData } from "@/types/level";

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

/** The blocks a real run actually drafts over: every 5th level. */
const BLOCK_STARTS = [6, 11, 16, 21, 26, 31];

function bounty(overrides: Partial<AssignmentConfig> = {}): AssignmentConfig {
  return {
    id: "named_delivery_test",
    name: "Named Delivery",
    mission: {
      text: "Seal a {{ballType}} ball in each of the next 5 maps.",
      track: { mode: "everyMap", kind: "ballType", params: { count: 1 } },
      tiers: [
        { threshold: 2, label: "+2 lives", reward: { type: "lives", count: 2 } },
        { threshold: 4, label: "Senior", reward: { type: "tierDraft", tier: "Senior" } },
      ],
    },
    ...overrides,
  } as AssignmentConfig;
}

function mkMap(over: Partial<AssignmentMapResult> = {}): AssignmentMapResult {
  return {
    locks: 0, superiorLocks: 0, cutsDelta: 0, clearSeconds: 999,
    ballCount: 0, allBallsLocked: false, lockedByType: {}, ...over,
  };
}

describe("the block's ball roster", () => {
  it("is knowable before the block is played", () => {
    // Not a forecast. Same map, same answer, every time - which is what lets a
    // bounty be set at draft time and what keeps a Daily identical for
    // everyone.
    const map = levels.find(l => l.level === 12)!;
    const a = selectBallTypesForMap(map.id, 12, map.maxBalls ?? 1).map(t => t.id);
    const b = selectBallTypesForMap(map.id, 12, map.maxBalls ?? 1).map(t => t.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("counts a type once per map, not once per ball", () => {
    // The mission asks for a map you sealed one on, so a map fielding three
    // greens is still one opportunity, not three.
    for (const start of BLOCK_STARTS) {
      const spread = blockBallTypeSpread(levels, start);
      for (const [id, maps] of spread) {
        expect(maps, `${id} in block ${start}`).toBeLessThanOrEqual(BLOCK_SIZE);
        expect(maps, `${id} in block ${start}`).toBeGreaterThan(0);
      }
    }
  });

  it("matches what the maps will really spawn", () => {
    // Built from the same selector initGame uses, so this cannot drift into
    // describing a roster the game does not produce.
    const start = 11;
    const spread = blockBallTypeSpread(levels, start);
    const expected = new Map<string, number>();
    for (let n = start; n < start + BLOCK_SIZE; n++) {
      const map = levels.find(l => l.level === n);
      if (!map) continue;
      const ids = new Set(
        selectBallTypesForMap(map.id, n, map.maxBalls ?? map.balls?.length ?? 1).map(t => t.id),
      );
      for (const term of map.circuit?.terminals ?? []) {
        if (term.ball?.typeId) ids.add(term.ball.typeId);
      }
      for (const id of ids) expected.set(id, (expected.get(id) ?? 0) + 1);
    }
    for (const [id, n] of expected) expect(spread.get(id), id).toBe(n);
  });
});

describe("naming the bounty", () => {
  it("never names a type the block cannot supply", () => {
    // The dead-mission guard, and the reason the feature is safe to ship.
    for (const start of BLOCK_STARTS) {
      const spread = blockBallTypeSpread(levels, start);
      const resolved = resolveBountyForBlock(bounty(), levels, start);
      if (!resolved) continue;                    // refused: also acceptable
      const named = resolved.mission.track.ballType!;
      const top = Math.max(...resolved.mission.tiers.map(t => t.threshold));
      expect(spread.has(named), `block ${start} named ${named}, which never spawns`).toBe(true);
      expect(
        spread.get(named)!,
        `block ${start}: ${named} is on ${spread.get(named)} maps but the top tier wants ${top}`,
      ).toBeGreaterThanOrEqual(top);
    }
  });

  it("picks the scarcest type that still clears the top tier", () => {
    // Not the most common one. A bounty on a ball that turns up on all five
    // maps is a lock quota with extra words: you would have sealed one anyway.
    const spread = new Map([["red", 5], ["blue", 4], ["green", 3], ["grey", 1]]);
    expect(pickBountyType(spread, 3)).toBe("green");
    expect(pickBountyType(spread, 4)).toBe("blue");
    expect(pickBountyType(spread, 5)).toBe("red");
  });

  it("refuses rather than naming something unreachable", () => {
    const spread = new Map([["red", 2], ["blue", 1]]);
    expect(pickBountyType(spread, 4)).toBeNull();
    expect(resolveBountyForBlock(bounty(), [], 11)).toBeNull();
  });

  it("breaks ties the same way every time", () => {
    // Two types on the same number of maps must not depend on Map insertion
    // order, or one player's Daily would name a different ball from another's.
    const a = new Map([["zebra", 3], ["alpha", 3]]);
    const b = new Map([["alpha", 3], ["zebra", 3]]);
    expect(pickBountyType(a, 3)).toBe(pickBountyType(b, 3));
  });

  it("honours a type that was pinned by hand", () => {
    const pinned = bounty();
    pinned.mission.track.ballType = "grey";
    expect(resolveBountyForBlock(pinned, levels, 11)?.mission.track.ballType).toBe("grey");
  });

  it("leaves every other kind of mission alone", () => {
    const quota = bounty({ id: "q" });
    quota.mission.track = { mode: "cumulative", kind: "lockCount" };
    expect(resolveBountyForBlock(quota, levels, 11)).toBe(quota);
  });
});

describe("a bounty the block cannot carry never reaches the draft", () => {
  it("is filtered out of the pool before the offers are drawn", () => {
    // Dropped BEFORE the draw, not after: removing it afterwards would leave
    // the player a two-card draft with no explanation.
    //
    // A block with no maps is the only genuinely unplayable case now. An
    // over-ambitious threshold is no longer one, because the tiers are capped
    // to the block - which is the better outcome: the mission gets easier
    // rather than vanishing.
    const ordinary = bounty({ id: "ordinary" });
    ordinary.mission.track = { mode: "cumulative", kind: "lockCount" };

    const playable = assignmentsPlayableInBlock([bounty({ id: "bounty" }), ordinary], [], 11);
    expect(playable.map(a => a.id)).toEqual(["ordinary"]);
  });

  it("shrinks an over-ambitious ask instead of dropping it", () => {
    const greedy = bounty();
    greedy.mission.tiers = [
      { threshold: 4, label: "a", reward: { type: "lives", count: 1 } },
      { threshold: 99, label: "b", reward: { type: "lives", count: 2 } },
    ] as AssignmentConfig["mission"]["tiers"];

    const resolved = resolveBountyForBlock(greedy, levels, 31)!;
    expect(resolved, "an over-ambitious bounty was dropped rather than capped").toBeTruthy();
    const top = Math.max(...resolved.mission.tiers.map(t => t.threshold));
    const best = Math.max(...blockBallTypeSpread(levels, 31).values());
    expect(top, `top tier ${top} exceeds the block's best coverage of ${best}`).toBeLessThanOrEqual(best);
    // Still two rungs, still ascending: the author's shape survives.
    expect(resolved.mission.tiers).toHaveLength(2);
    expect(resolved.mission.tiers[1].threshold).toBeGreaterThan(resolved.mission.tiers[0].threshold);
  });

  it("survives the draft pipeline with its type named", () => {
    const offers = scaleOffersForBlock([bounty()], levels, 10);
    expect(offers).toHaveLength(1);
    expect(offers[0].mission.track.ballType, "the bounty was never named").toBeTruthy();
  });
});

describe("tracking a bounty across the block", () => {
  const track = { mode: "everyMap", kind: "ballType", params: { count: 1 }, ballType: "green" } as const;

  it("counts a map where the named type was sealed", () => {
    expect(conditionMetForMap("ballType", { count: 1 }, mkMap({ lockedByType: { green: 1 } }), "green")).toBe(true);
  });

  it("does not count locks of any other type", () => {
    // The entire point: five reds is a good map and a failed one.
    const r = mkMap({ locks: 5, lockedByType: { red: 5 } });
    expect(conditionMetForMap("ballType", { count: 1 }, r, "green")).toBe(false);
  });

  it("honours a count above one", () => {
    const r = mkMap({ lockedByType: { green: 1 } });
    expect(conditionMetForMap("ballType", { count: 2 }, r, "green")).toBe(false);
    expect(conditionMetForMap("ballType", { count: 2 }, mkMap({ lockedByType: { green: 2 } }), "green")).toBe(true);
  });

  it("fails closed when no type was ever named", () => {
    // A bounty with no type must not pass on every map and pay the top tier
    // for nothing.
    expect(conditionMetForMap("ballType", { count: 1 }, mkMap({ lockedByType: { green: 3 } }))).toBe(false);
  });

  it("counts maps passed, over the block", () => {
    const results = [
      mkMap({ lockedByType: { green: 1 } }),
      mkMap({ lockedByType: { red: 2 } }),
      mkMap({ lockedByType: { green: 4 } }),
    ];
    expect(assignmentMetric(track, results)).toBe(2);
  });
});

describe("the shipped Named Delivery", () => {
  const pool = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
  ) as { assignments: AssignmentConfig[] }).assignments;
  const named = pool.find(a => a.mission?.track?.kind === "ballType");

  it("is in the pool", () => {
    expect(named, "no ball-type assignment is authored").toBeTruthy();
  });

  it("leaves its type to the block rather than authoring one", () => {
    expect(named!.mission.track.ballType).toBeUndefined();
  });

  it("has a placeholder for the type in its text", () => {
    // Without this the player is told to seal "a ball", which is unplayable.
    expect(named!.mission.text).toContain("{{ballType}}");
  });

  it("names a real ball in the blocks a run actually drafts over", () => {
    // Being refused is safe - the pool filter drops it - but a bounty no block
    // can carry is a feature that never appears. Reported per block so a map
    // change that quietly starves it shows up as a number, not a pass.
    const named2: string[] = [];
    for (const start of BLOCK_STARTS) {
      const resolved = resolveBountyForBlock(named!, levels, start);
      const spread = blockBallTypeSpread(levels, start);
      const type = resolved?.mission.track.ballType;
      named2.push(`L${start}-${start + 4}: ${type ?? "REFUSED"}${type ? ` (on ${spread.get(type)}/5)` : ""}`);
    }
    console.log("Named Delivery resolves to -> " + named2.join(" | "));
    const refused = named2.filter(x => x.includes("REFUSED"));
    expect(refused.length, `refused in ${refused.length}/${BLOCK_STARTS.length} blocks`).toBe(0);
  });
});

describe("the mission reads as a sentence", () => {
  const t = i18n.t.bind(i18n) as unknown as Parameters<typeof contentText.assignmentMission>[0];

  it("names the ball in the mission line", () => {
    // The placeholder is the whole delivery mechanism. If it survives to the
    // screen the player is told to seal "a {{ballType}} ball", which is worse
    // than no mission at all.
    const resolved = resolveBountyForBlock(bounty(), levels, 11)!;
    const line = contentText.assignmentMission(t, resolved);
    expect(line, "the placeholder was never filled in").not.toContain("{{");
    expect(line).toContain("ball");
    const named = resolved.mission.track.ballType!;
    const name = contentText.ballName(t, named);
    expect(name, `no name for ball type ${named}`).toBeTruthy();
    expect(line, `expected the line to name ${name}`).toContain(name);
  });

  it("falls back to the id for a type the catalogue does not know", () => {
    // "seal a grey ball" is playable; "seal a ball" is not.
    expect(contentText.ballName(t, "not_a_real_ball")).toBe("not_a_real_ball");
    expect(contentText.ballName(t, undefined)).toBe("");
  });

  it("leaves an ordinary mission line untouched", () => {
    const quota = bounty({ id: "q" });
    quota.mission.text = "Lock balls across the next 5 maps.";
    quota.mission.track = { mode: "cumulative", kind: "lockCount" };
    expect(contentText.assignmentMission(t, quota)).toBe("Lock balls across the next 5 maps.");
  });
});

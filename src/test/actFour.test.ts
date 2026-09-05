/**
 * Act IV: Crunch (31-35), the last stretch to be migrated.
 *
 * It was the ladder's one real regression, and a measured one. It sat at 70-72%
 * clear with 4-5 cuts while act III asked for 86-93% and 9, so level 31 demanded
 * LESS of the player than level 4 did, and its five maps between them put 8
 * balls on the board against act III's 15.
 *
 * It is also the first act to state its own win conditions rather than lean on
 * the implicit clear. That is the part worth guarding: a `win:` block can ask
 * for something the map cannot deliver, and the failure is silent - the map
 * simply never completes and the player assumes they misplayed it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { resolveWinSpec, winSpecProblems } from "@/lib/winSpec";
import { blockLockCapacity } from "@/lib/assignmentScaling";
import { getBallType } from "@/lib/ballTypes";
import { parseMutatorEntry } from "@/lib/mapMutators";
import type { MapMutator } from "@/types/mapMutator";
import type { LevelConfig } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as { levels: LevelConfig[] }).levels;

const at = (n: number) => LEVELS.find(l => l.level === n)!;
const ACT_IV = [31, 32, 33, 34, 35].map(at);
const PLAYABLE = ACT_IV.filter(l => !l.boss);

describe("the act exists and is the right shape", () => {
  it("has all five maps", () => {
    for (const l of ACT_IV) expect(l, "a map is missing").toBeTruthy();
  });

  /** The regression, stated as a number: 31 asked for less than 4 did. */
  it("no longer asks less of the player than act I", () => {
    const clear = (l: LevelConfig) => 100 - l.sizeThreshold;
    for (const l of PLAYABLE) {
      expect(clear(l), `level ${l.level}`).toBeGreaterThan(clear(at(4)));
    }
  });

  it("sits above act III's peak, which it follows", () => {
    const clear = (l: LevelConfig) => 100 - l.sizeThreshold;
    const actIIIPeak = Math.max(...[21, 22, 23, 24, 25, 26, 27, 28, 29].map(n => clear(at(n))));
    // Only the LAST playable map has to beat the previous act outright; the
    // first is the post-boss breather and is allowed to sit at the peak.
    expect(clear(at(34))).toBeGreaterThan(actIIIPeak);
    expect(clear(at(31))).toBeGreaterThanOrEqual(actIIIPeak - 1);
  });

  it("does not collapse its cut count the way it used to", () => {
    // 9 cuts at level 19 and then 4 at 31-33 was the shape of the collapse.
    for (const l of PLAYABLE) expect(l.expectedCuts, `level ${l.level}`).toBeGreaterThanOrEqual(8);
  });

  /**
   * The knock-on nobody would look for: the assignment block spanning 31-35
   * scales its lock targets to how many balls the block puts on the board, so a
   * thin act quietly gave the last block of the run the weakest missions.
   */
  it("puts enough balls on the board to carry its assignment block", () => {
    const actIV = blockLockCapacity(LEVELS, 31);
    const actIII = blockLockCapacity(LEVELS, 26);
    expect(actIV, `act IV block has ${actIV} against act III's ${actIII}`)
      .toBeGreaterThanOrEqual(actIII - 3);
  });
});

describe("the win conditions it states", () => {
  it("authors a win on every map of the act, 31 included", () => {
    // 31 used to derive its win, on the argument that it opens the act on
    // rules the player already knows. What it actually inherited was the
    // derivation's free `allLocked` alternative, on a map carrying a circuit
    // terminal the win never mentioned - so the act opened on the one map in
    // it that could be finished by sealing three balls and touching nothing.
    for (const n of [31, 32, 33, 34]) {
      expect(resolveWinSpec(at(n)).authored, `level ${n}`).toBe(true);
    }
  });

  it("flags none of them as unwinnable", () => {
    for (const l of ACT_IV) {
      expect(winSpecProblems(resolveWinSpec(l), l), `level ${l.level}`).toEqual([]);
    }
  });

  it("still requires the clear on the maps whose gate is a bonus", () => {
    // 32 and 33 hang their gate off a map that is otherwise won by clearing, so
    // the gate is extra credit and the clear still has to happen.
    for (const n of [32, 33]) {
      expect(resolveWinSpec(at(n)).require.some(c => c.kind === "space"), `level ${n}`).toBe(true);
    }
  });

  /**
   * 34 is the exception, and it is deliberate.
   *
   * It used to carry the clear as well, and the pair asked for something
   * neither clause says on its own. Reaching 5% remaining on a four-ball map
   * means sealing every ball into a sliver, so the real demand was "lock all
   * four AND land two of them in the box" - on a map with a live pull, where
   * you cannot aim. Worse, an authored spec carries no all-locked alternative,
   * so locking the last ball with only one ball in the box did not merely fail
   * to win: it emptied the board of targets and tripped the area fail check,
   * losing the map outright.
   *
   * The cost of dropping it is real and is the thing the rule above exists to
   * prevent: 34 can now be finished without clearing much board. That is the
   * trade, taken with eyes open, because a coherent short map beats an
   * incoherent long one.
   */
  it("makes 34's gate the whole win, with no clear beside it", () => {
    const spec = resolveWinSpec(at(34));
    expect(spec.require.map(c => c.kind)).toEqual(["area"]);
    const area = spec.require.find(c => c.kind === "area");
    expect(area?.kind === "area" && area.count).toBe(2);
  });

  it("leaves 34 no lock count the win does not read", () => {
    // threadLockRequired is ignored outright once a map authors a `win:` block,
    // so it could only ever reach the HUD - drawing a Thread Locks objective
    // for a requirement that cannot affect the outcome.
    expect(at(34).threadLockRequired).toBeUndefined();
  });

  /**
   * No map in the act keeps an all-locked back door, 32 and 33 included.
   *
   * They used to, as a deliberate mercy: on maps this tight, sealing
   * everything is a hard-won finish in its own right. The mercy turned out to
   * be the exploit. Sealing every ball writes the rest of the board off as
   * unreachable, so the alternative was not "seal everything at 7% remaining",
   * it was "seal everything, whenever" - and on 33 that walks around the
   * compass gate the entire map is built to pose, on 32 around the vault.
   */
  it("gives no gate in the act an all-locked back door", () => {
    for (const n of [31, 32, 33, 34]) {
      expect(resolveWinSpec(at(n)).alsoWinIf, `level ${n}`).toEqual([]);
    }
  });});

describe("what the act charges for its gates", () => {
  const premiums = ACT_IV.flatMap(l =>
    resolveWinSpec(l).require.map(c => ({ level: l.level, kind: c.kind, pct: c.bonusPercent ?? 0 })));

  it("prices every extra ask, and nothing else", () => {
    const priced = premiums.filter(p => p.pct > 0);
    expect(priced.length, "the gates should carry a premium").toBeGreaterThanOrEqual(3);
    // The clear itself is the baseline and is never what pays extra.
    expect(priced.every(p => p.kind !== "space")).toBe(true);
  });

  it("keeps every premium inside what the economy is tuned for", () => {
    for (const p of premiums) {
      expect(p.pct, `level ${p.level} ${p.kind}`).toBeLessThanOrEqual(50);
    }
  });

  it("pays more for the harder ask", () => {
    const pct = (n: number, kind: string) =>
      resolveWinSpec(at(n)).require.find(c => c.kind === kind)?.bonusPercent ?? 0;
    // One superior lock is the gentlest gate; herding two balls into one box
    // under a live pull is the hardest.
    expect(pct(32, "superiorLocks")).toBeLessThan(pct(34, "area"));
  });
});

/**
 * How busy act IV is, which is now a gameplay rule and not just a feel.
 *
 * Act IV is the "everything at once" act, so a map here being LESS populated
 * than the act before it is odd on its own terms. The Lamp (src/lib/lampBall.ts)
 * gave that a second, sharper edge: one ball at a time lights the board and
 * sealing it pays a premium, and on a two-ball map "another ball is picked"
 * means the other one. There is no choice to make, so the bonus stops being a
 * decision and becomes a tax on whichever ball you were sealing anyway.
 *
 * The exception is deliberate rather than a gap. A map whose win condition
 * NAMES a ball already has its own "this one matters" signal, and stacking the
 * Lamp's on top of it would put two competing markers on one board - exactly
 * the legibility risk that mechanic was designed around. Level 33 is that map:
 * it names the compass, pins its roster to match, and is built around herding
 * the OTHER ball into the tightest pocket in the game.
 */
describe("act IV is busy enough for the Lamp to be a choice", () => {
  const ACT_IV = [31, 32, 33, 34, 35].map(at);

  it("gives every non-boss map three balls, unless its win names one", () => {
    const thin = ACT_IV
      .filter(l => !l.boss)
      .filter(l => (l.maxBalls ?? 1) < 3)
      .filter(l => !resolveWinSpec(l).require.some(c => c.kind === "lockType"))
      .map(l => `${l.id} (${l.maxBalls ?? 1})`);
    expect(thin, "a two-ball act IV map hands the Lamp a coin flip").toEqual([]);
  });

  it("leaves the boss maps alone", () => {
    // The obvious wrong way to satisfy the rule above. A boss map is ABOUT the
    // boss, which splits into its own minions; padding the roster to give the
    // Lamp something to choose between would be the tail wagging the dog.
    for (const l of ACT_IV.filter(l => l.boss)) {
      expect(l.maxBalls, `${l.id} is a boss map`).toBe(1);
    }
  });

  it("keeps a named-ball map's pinned roster matching its count", () => {
    // The exception above is only safe while the roster really is pinned: an
    // unpinned one can roll without the named ball and the map is unwinnable.
    for (const l of ACT_IV.filter(l => resolveWinSpec(l).require.some(c => c.kind === "lockType"))) {
      expect(l.ballTypeIds, `${l.id} names a ball`).toBeTruthy();
      expect(l.ballTypeIds!.length, `${l.id} roster vs count`).toBe(l.maxBalls);
    }
  });
});

/**
 * The gate that worried me most. `lockType` names a ball, and ball types are
 * otherwise picked from maxBalls and unlock levels - so left to the roll, the
 * named ball may simply not spawn and the map is unwinnable through no fault of
 * the player.
 */
describe("naming a ball in a win condition", () => {
  const L33 = at(33);

  it("pins the roster on the map that names one", () => {
    expect(L33.ballTypeIds, "the roster must not be a roll").toBeTruthy();
    expect(L33.ballTypeIds).toContain("compass");
  });

  it("keeps the roster and the ball count consistent", () => {
    expect(L33.ballTypeIds!.length).toBe(L33.maxBalls);
  });

  /**
   * The named ball is the one still on the board once the hook is taken, so it
   * must not be the FIRST ball: that is the one a player herds by instinct and
   * the one the map's own payout test seals into the nook.
   */
  it("does not put the named ball first", () => {
    const named = resolveWinSpec(L33).require
      .find(c => c.kind === "lockType") as { ballType: string };
    expect(L33.ballTypeIds![0]).not.toBe(named.ballType);
  });

  it("is asking for a ball that actually exists", () => {
    // The roster pin is only worth anything if the id it pins resolves: a typo
    // here spawns nothing and the map cannot be won.
    for (const id of L33.ballTypeIds!) {
      expect(getBallType(id), `${id} missing from balls.yml`).toBeTruthy();
    }
  });

  /** The validator that catches the next person doing this without a roster. */
  it("would flag the same win with the roster left to the roll", () => {
    const unpinned = { ...L33 };
    delete (unpinned as { ballTypeIds?: string[] }).ballTypeIds;
    expect(winSpecProblems(resolveWinSpec(unpinned), unpinned).join(" "))
      .toMatch(/may not spawn/);
  });

  it("would flag a ball the pinned roster does not contain", () => {
    const wrong = { ...L33, ballTypeIds: ["red", "blue"] };
    expect(winSpecProblems(resolveWinSpec(wrong), wrong).join(" "))
      .toMatch(/not in this map's pinned roster/);
  });
});

describe("34 is built for the gate it sets", () => {
  const L34 = at(34);

  it("has a gate area for the balls to be herded into", () => {
    const gates = (L34.coloredAreas ?? []).filter(a => a.required !== false);
    expect(gates, "the area clause needs a gate area").toHaveLength(1);
    expect(gates[0].kind).toBe("const");
  });

  it("spawns more balls than the gate asks for", () => {
    // Asking for two of exactly two would make one bad bounce fatal.
    const need = resolveWinSpec(L34).require.find(c => c.kind === "area");
    expect(need?.kind === "area" && need.count).toBe(2);
    expect(L34.maxBalls!).toBeGreaterThan(2);
  });

  it("pins the pull rather than hoping the roll delivers it", () => {
    // A map authored around a live pull that only sometimes pulls is a
    // different map most of the time.
    //
    // Asserted through the CATALOGUE, not against a literal. This test used to
    // read `expect(L34.mutator).toBe("gravity")`, which passed for two years of
    // nothing pulling: "gravity" is the behavior name, no entry has it as an
    // id, and a pin that resolves to nothing is exactly the map being unpinned.
    // A string compared to a string cannot tell the difference; a lookup can.
    const catalogue = (
      (yaml.load(
        readFileSync(resolve(process.cwd(), "public/mapMutators.yml"), "utf8"),
      ) as { mutators?: unknown[] }).mutators ?? []
    ).map(parseMutatorEntry).filter((m): m is MapMutator => !!m);
    const pinned = catalogue.find(m => m.id === L34.mutator);
    expect(pinned, `level-34 pins "${L34.mutator}", which no mutator has as an id`)
      .toBeTruthy();
    expect(pinned!.behavior, "the pull is what this map is built around").toBe("gravity");
  });
});

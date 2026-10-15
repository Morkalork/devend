/**
 * Can a player find out what a bug does, before and after running into one?
 *
 * The mechanic shipped readable in the moment and unreadable in advance: nine
 * bugs told apart by a colour and a silhouette, with the one that can cost you
 * the map distinguished by a ring you would have to already know the meaning
 * of. Agreed as a gap and closed three ways, each answering a different
 * question, because no single one of them answers all three:
 *
 *   WHAT IS IN THAT BRICK?   press-and-hold the SHARD. The gesture came back
 *                            once bugs started being carried: a brick holds
 *                            still, so the 450ms lands every time, and the
 *                            question is asked before the shard is broken,
 *                            which is when it can still change the plan.
 *   WHAT DID I JUST GET?     the splat says the name, whether a ball squashed
 *                            it or the player did. You did the thing, then you
 *                            find out what it was called, which is the order
 *                            that sticks.
 *   WHAT IS OUT THERE?       the tutorial roster, every entry, always, no
 *                            discovery gating. See the note in TutorialScreen
 *                            for why that differs from the ball roster.
 *
 * All three read the SAME strings out of public/bugs.yml, which is the property
 * worth a test file: three explanations of one mechanic, maintained
 * separately, is three chances to describe a bug the game no longer has.
 *
 * ── The gesture that is not here ────────────────────────────────────────────
 *
 * Press-and-hold on the BUG shipped unusable. Reported as "Press and hold
 * doesn't work", and it did not: a bug is nine world units across and covers
 * 10-17 of them in the time a touch takes to register, against 22 of slop, and
 * the 450ms hold then had to survive a 12-unit move slop that a resting thumb
 * drifts past. A tap KILLS a loose bug now (bugs.test.ts covers it), so the two
 * gestures could not share a target anyway: a hold that fell short of 450ms
 * would destroy the thing it was asking about.
 *
 * The gesture is on the SHARD instead, which is a better home than the bug ever
 * was - it does not move, and the question gets asked while the answer can
 * still change what the player does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import { getAllBugs, getBug } from "@/lib/bugs";
import { BUG_RADIUS } from "@/lib/physics/bugs";
import type { CanvasGameState } from "@/types/gameState";

const LOCALES = ["en", "es", "sv", "bn"] as const;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const locale = (loc: string) => JSON.parse(read(`src/i18n/locales/${loc}.json`));

// ── The copy itself ─────────────────────────────────────────────────────────

describe("every bug says what it gives and what it costs", () => {
  it("has both, for every entry in the pool", () => {
    for (const bug of getAllBugs()) {
      expect(bug.description.length, `${bug.id} has no description`).toBeGreaterThan(20);
      // The cost is the one that would quietly go missing, because it is the
      // half nobody enjoys writing. A pool whose costs are blank is a pool that
      // reads as free money, which is the exact failure the field exists for.
      expect(bug.cost.length, `${bug.id} has no stated cost`).toBeGreaterThan(20);
    }
  });

  it("states a real cost rather than a shrug", () => {
    // Not an exhaustive judgement, and not meant to be: it catches the specific
    // way this field decays, which is someone writing "nothing really" under
    // deadline and nobody reading it again.
    for (const bug of getAllBugs()) {
      expect(bug.cost.toLowerCase(), `${bug.id}'s cost says nothing`)
        .not.toMatch(/^(none|nothing|n\/a|-)\b/);
      expect(bug.cost).not.toBe(bug.description);
    }
  });

  it("uses no em-dash, in either field (CLAUDE.md)", () => {
    for (const bug of getAllBugs()) {
      expect(bug.description, `${bug.id}'s description`).not.toContain("—");
      expect(bug.cost, `${bug.id}'s cost`).not.toContain("—");
    }
  });

  it("warns in words as well as in a ring, on the dangerous one", () => {
    // The warning ring is a symbol, and a symbol means nothing the first time.
    const bigBang = getBug("bigBang")!;
    expect(bigBang.danger).toBe(true);
    expect(bigBang.cost.toLowerCase()).toMatch(/end|lose|cost|out of reach|beyond/);
  });
});

// ── What is not reachable any more ─────────────────────────────────────────

describe("press-and-hold, on the shard rather than the bug", () => {
  /** A board with one breakable carrying `effect`. */
  function boardWithCarrier(effect: string) {
    const poly = { vertices: [{ x: 280, y: 280 }, { x: 340, y: 280 }, { x: 340, y: 320 }, { x: 280, y: 320 }] };
    return {
      bugs: [], pickups: [], chestLoot: [], balls: [], walls: [],
      phasingObjects: [], movers: [], mirrorPolygons: [], obstaclePolygons: [poly],
      coloredAreas: [],
      destructibles: [{
        id: "carrier", kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0,
        destroyed: false, obstaclePolygon: poly, bug: effect,
      }],
    } as unknown as CanvasGameState;
  }

  it("is gone from the bug itself, which could not be held", () => {
    // Nine world units across, moving 95 a second, against 22 of slop: the
    // press could not be landed, and a hold released early is a tap, which now
    // KILLS the bug. The two gestures could not share a target.
    const source = read("src/lib/boardEntityInfo.ts");
    expect(source, "boardEntityAt still hit-tests loose bugs").not.toMatch(/kind:\s*"bug"[,\s}]/);
    for (const loc of LOCALES) {
      expect(locale(loc).boardInfo.bug, `${loc} still carries boardInfo.bug`).toBeUndefined();
    }
  });

  it("works on the shard, which holds still", () => {
    const hit = boardEntityAt(boardWithCarrier("forcePush"), 310, 300);
    expect(hit?.kind).toBe("bugShard");
    expect(hit?.detail, "the card would not know WHICH bug is in there").toBe("forcePush");
  });

  it("leaves a shard carrying nothing as an ordinary breakable", () => {
    const board = boardWithCarrier("forcePush");
    board.destructibles[0].bug = undefined;
    expect(boardEntityAt(board, 310, 300)?.kind).toBe("breakable");
  });
});

// ── One source, three readers ───────────────────────────────────────────────

describe("a shard that is carrying one", () => {
  const OBJ = read("src/lib/rendering/sleek/objectLayer.ts");

  it("is drawn in the bug's own colour, whole", () => {
    // Asked for as "you can actually just color the whole shard if it has a
    // bug, to reduce the clutter". It replaced a lit chamber drawn in the
    // middle of the slab, which was competing with the dents, cracks, seams,
    // broken rim and glint already on the same few pixels.
    expect(OBJ, "the body colour does not come from the carried bug")
      .toMatch(/const base = carried \?[\s\S]{0,120}carried\.color/);
    expect(OBJ, "the rim still disagrees with the body").toMatch(/rimColor = carried \?/);
  });

  it("draws no separate marker on top of it", () => {
    // The clutter this removed. If a badge, chamber or ring ever comes back on
    // the shard, it comes back deliberately and not by accident.
    expect(OBJ).not.toContain("drawCarriedBug");
  });

  it("takes its colour from the catalogue, so the chain is one colour", () => {
    // The brick, the bug that flies out of it, and the splat it leaves are all
    // the same hex out of public/bugs.yml. That is the whole identification
    // chain, and there is no text anywhere in it.
    expect(OBJ).toContain('import { getBug } from "@/lib/bugs"');
    const prop = read("src/lib/rendering/sleek/propLayer.ts");
    const fx = read("src/lib/rendering/sleek/fxLayer.ts");
    for (const [name, src] of [["propLayer", prop], ["fxLayer", fx]] as const) {
      expect(src, `${name} does not read the catalogue colour`)
        .toMatch(/def\.color\.replace\("#", ""\)/);
    }
  });

  it("breathes, so it is not mistaken for another material", () => {
    // The board already has gold, glass and objective-gold breakables. A still
    // brick in a new colour reads as a fourth material; a breathing one reads
    // as holding something.
    expect(OBJ).toMatch(/const breath = carried \?/);
  });
});

describe("the three explanations cannot drift", () => {
  it("all read the catalogue rather than restating it", () => {
    // The failure this guards is a rebalanced bug whose card still describes
    // the old one. Source checks, because "did this component hardcode a
    // sentence" is not something a render can show.
    const modal = read("src/ui/game/BoardEntityInfoModalModel.ts");
    const tutorial = read("src/ui/screens/TutorialScreen.tsx");
    const fx = read("src/lib/rendering/sleek/fxLayer.ts");
    expect(modal).toContain("getBug(");
    // Through contentText, which keys the translation on the bug id and
    // falls back to the catalogue's own copy.
    expect(modal).toMatch(/contentText\.bugDesc\(t, bug\)/);
    expect(modal).toMatch(/contentText\.bugCost\(t, bug\)/);
    expect(tutorial).toContain("getAllBugs()");
    expect(tutorial).toMatch(/contentText\.bugDesc\(t, bug\)/);
    expect(tutorial).toMatch(/contentText\.bugCost\(t, bug\)/);
    // The splat's label is the catalogue's name, not a lookup table beside it.
    expect(fx).toMatch(/drawSplatName\(contentText\.bugName\(i18next\.t, def\)/);
  });

  it("has its framing strings in every locale", () => {
    for (const loc of LOCALES) {
      const data = locale(loc);
      for (const key of ["title", "body", "gives", "costs", "danger"]) {
        expect(data.boardInfo?.bugShard?.[key], `${loc}: boardInfo.bugShard.${key} is missing`).toBeTruthy();
      }
      for (const key of ["title", "intro", "cost", "danger"]) {
        expect(data.tutorial?.bugs?.[key], `${loc}: tutorial.bugs.${key} is missing`).toBeTruthy();
      }
    }
  });

  it("keeps the em-dash out of all of it (CLAUDE.md)", () => {
    for (const loc of LOCALES) {
      const data = locale(loc);
      const strings = [
        ...Object.values(data.boardInfo.bugShard as Record<string, string>),
        ...Object.values(data.tutorial.bugs as Record<string, string>),
      ];
      for (const line of strings) {
        expect(line, `${loc}: "${line}"`).not.toContain("—");
      }
    }
  });
});

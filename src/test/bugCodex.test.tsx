/**
 * Can a player find out what a bug does, before and after running into one?
 *
 * The mechanic shipped readable in the moment and unreadable in advance: nine
 * bugs told apart by a colour and a silhouette, with the one that can cost you
 * the map distinguished by a ring you would have to already know the meaning
 * of. Agreed as a gap and closed three ways, each answering a different
 * question, because no single one of them answers all three:
 *
 *   WHAT IS THAT THING?      press-and-hold on the bug, the project's standard
 *                            explain-this gesture (boardEntityInfo.ts). Asked
 *                            while it is still flying, which is when the
 *                            decision is actually made.
 *   WHAT DID I JUST GET?     the splat says the name. You did the thing, then
 *                            you find out what it was called, which is the
 *                            order that sticks.
 *   WHAT IS OUT THERE?       the tutorial roster, every entry, always, no
 *                            discovery gating. See the note in TutorialScreen
 *                            for why that differs from the ball roster.
 *
 * All three read the SAME strings out of public/bugs.yml, which is the property
 * worth a test file: three explanations of one mechanic, maintained separately,
 * is three chances to describe a bug the game no longer has.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { BoardEntityInfoModal } from "@/components/game/BoardEntityInfoModal";
import { TutorialScreen } from "@/components/game/TutorialScreen";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import { getAllBugs, getBug } from "@/lib/bugs";
import { BUG_RADIUS } from "@/lib/physics/bugs";
import type { CanvasGameState } from "@/types/gameState";

const LOCALES = ["en", "es", "sv"] as const;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const locale = (loc: string) => JSON.parse(read(`src/i18n/locales/${loc}.json`));

afterEach(cleanup);

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

// ── Hold it to ask ──────────────────────────────────────────────────────────

/** A board with one bug and one token sitting at known spots. */
function boardWith(bugEffect: string, at = { x: 300, y: 300 }): CanvasGameState {
  return {
    bugs: [{ id: "b", effect: bugEffect, position: at, velocity: { x: 0, y: 0 } }],
    pickups: [{ id: "p", effect: "overtime", position: at }],
    chestLoot: [],
    balls: [],
    walls: [],
    destructibles: [],
    coloredAreas: [],
    // The rest of what boardEntityAt walks on its way down to "nothing here".
    // Empty rather than absent: the hit test reads the required collections
    // without a guard, which is correct on a real board and means a fixture
    // has to be a whole one to ask the miss case at all.
    phasingObjects: [],
    movers: [],
    mirrorPolygons: [],
    obstaclePolygons: [],
  } as unknown as CanvasGameState;
}

describe("press-and-hold on a bug", () => {
  it("resolves to the bug that is under the finger", () => {
    const game = boardWith("forcePush");
    const hit = boardEntityAt(game, 300, 300);
    expect(hit?.kind).toBe("bug");
    expect(hit?.detail, "the card would not know WHICH bug").toBe("forcePush");
  });

  it("wins over a token it is flying across", () => {
    // Both are at the same point. A bug moves and a token does not, so the
    // thing the finger is on is the bug; resolving to the token would explain
    // the object the player was not pointing at.
    const game = boardWith("bigBang");
    expect(boardEntityAt(game, 300, 300)?.kind).toBe("bug");
  });

  it("is a generous enough target to hit on a phone", () => {
    const game = boardWith("deadlock");
    expect(boardEntityAt(game, 300 + BUG_RADIUS + 6, 300)?.kind).toBe("bug");
  });

  it("does not claim a bug that is nowhere near", () => {
    const game = boardWith("deadlock");
    const hit = boardEntityAt(game, 800, 800);
    expect(hit?.kind).not.toBe("bug");
  });
});

describe("the explainer card", () => {
  it("names the bug and prints its own description and cost", () => {
    const bug = getBug("forcePush")!;
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "forcePush" }} onClose={() => { /* closed elsewhere */ }} />);
    expect(screen.getByText(bug.name)).toBeTruthy();
    expect(screen.getByText(bug.description)).toBeTruthy();
    expect(screen.getByText(bug.cost), "the card shows the upside and hides the cost").toBeTruthy();
  });

  it("shows the two halves under their own labels, not run together", () => {
    const strings = locale("en").boardInfo.bug;
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "bitRot" }} onClose={() => { /* ditto */ }} />);
    expect(screen.getByText(strings.gives)).toBeTruthy();
    expect(screen.getByText(strings.costs)).toBeTruthy();
  });

  it("says what a bug IS, for the player meeting their first one", () => {
    const strings = locale("en").boardInfo.bug;
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "branch" }} onClose={() => { /* ditto */ }} />);
    expect(screen.getByText(strings.body)).toBeTruthy();
  });

  it("carries the danger warning on the dangerous one, and only there", () => {
    const strings = locale("en").boardInfo.bug;
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "bigBang" }} onClose={() => { /* ditto */ }} />);
    expect(screen.getByText(strings.danger)).toBeTruthy();
    cleanup();
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "bitRot" }} onClose={() => { /* ditto */ }} />);
    expect(screen.queryByText(strings.danger), "every bug looks dangerous").toBeNull();
  });

  it("still explains SOMETHING when the catalogue could not be fetched", () => {
    // An unknown id is what a deployed build sees if bugs.yml 404s and the
    // baked-in catalogue has since been edited. A blank card would be the worst
    // possible answer to "what is that thing".
    const strings = locale("en").boardInfo.bug;
    render(<BoardEntityInfoModal hit={{ kind: "bug", detail: "notARealBug" }} onClose={() => { /* ditto */ }} />);
    expect(screen.getByText(strings.title)).toBeTruthy();
    expect(screen.getByText(strings.body)).toBeTruthy();
  });

  it("leaves every other board object's card exactly as it was", () => {
    const strings = locale("en").boardInfo;
    render(<BoardEntityInfoModal hit={{ kind: "pickup", detail: "overtime" }} onClose={() => { /* ditto */ }} />);
    expect(screen.getByText(strings.pickup.title)).toBeTruthy();
    expect(screen.getByText(strings.pickup.body)).toBeTruthy();
  });
});

// ── The roster ──────────────────────────────────────────────────────────────

describe("the tutorial's bug roster", () => {
  it("lists every bug in the catalogue", () => {
    render(<TutorialScreen onBack={() => { /* nav lives elsewhere */ }} />);
    for (const bug of getAllBugs()) {
      expect(screen.getByText(bug.name), `${bug.id} is missing from the roster`).toBeTruthy();
      expect(screen.getByText(bug.description), `${bug.id} has no description on the page`).toBeTruthy();
    }
  });

  it("shows them ALL without having met them, unlike the ball roster", () => {
    // The ball roster hides an ability until you encounter it, because
    // discovering one is the reward. This is the opposite case and the reason
    // the whole feature exists: the decision a bug asks for happens before you
    // touch it, and the rarest entry in the pool is the one that can lose you
    // the map. Gating it behind having met it would withhold exactly the
    // warning this page is for.
    const notEncountered = locale("en").tutorial.ballTypes.notEncounteredYet;
    render(<TutorialScreen onBack={() => { /* ditto */ }} encounteredBallTypeIds={[]} />);
    for (const bug of getAllBugs()) {
      expect(screen.getByText(bug.description), `${bug.id} was gated behind discovery`).toBeTruthy();
    }
    // The ball roster's gating is untouched: this is an addition, not a change
    // to how the page already worked.
    expect(screen.getAllByText(notEncountered).length).toBeGreaterThan(0);
  });

  it("prints the cost of every one of them", () => {
    render(<TutorialScreen onBack={() => { /* ditto */ }} />);
    for (const bug of getAllBugs()) {
      expect(screen.getByText(bug.cost, { exact: false }), `${bug.id}'s cost is not on the page`).toBeTruthy();
    }
  });
});

// ── One source, three readers ───────────────────────────────────────────────

describe("the three explanations cannot drift", () => {
  it("all read the catalogue rather than restating it", () => {
    // The failure this guards is a rebalanced bug whose card still describes
    // the old one. Source checks, because "did this component hardcode a
    // sentence" is not something a render can show.
    const modal = read("src/components/game/BoardEntityInfoModal.tsx");
    const tutorial = read("src/components/game/TutorialScreen.tsx");
    const fx = read("src/lib/rendering/sleek/fxLayer.ts");
    expect(modal).toContain("getBug(");
    expect(modal).toMatch(/bug\.description/);
    expect(modal).toMatch(/bug\.cost/);
    expect(tutorial).toContain("getAllBugs()");
    expect(tutorial).toMatch(/bug\.description/);
    expect(tutorial).toMatch(/bug\.cost/);
    // The splat's label is the catalogue's name, not a lookup table beside it.
    expect(fx).toMatch(/drawSplatName\(def\.name/);
  });

  it("has its framing strings in every locale", () => {
    for (const loc of LOCALES) {
      const data = locale(loc);
      for (const key of ["title", "body", "gives", "costs", "danger"]) {
        expect(data.boardInfo?.bug?.[key], `${loc}: boardInfo.bug.${key} is missing`).toBeTruthy();
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
        ...Object.values(data.boardInfo.bug as Record<string, string>),
        ...Object.values(data.tutorial.bugs as Record<string, string>),
      ];
      for (const line of strings) {
        expect(line, `${loc}: "${line}"`).not.toContain("—");
      }
    }
  });
});

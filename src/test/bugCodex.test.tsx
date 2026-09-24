/**
 * Can a player find out what a bug does, before and after running into one?
 *
 * The mechanic shipped readable in the moment and unreadable in advance: nine
 * bugs told apart by a colour and a silhouette, with the one that can cost you
 * the map distinguished by a ring you would have to already know the meaning
 * of. Agreed as a gap and closed three ways, each answering a different
 * question, because no single one of them answers all three:
 *
 *   WHAT DID I JUST GET?     the splat says the name, whether a ball squashed
 *                            it or the player did. You did the thing, then you
 *                            find out what it was called, which is the order
 *                            that sticks.
 *   WHAT IS OUT THERE?       the tutorial roster, every entry, always, no
 *                            discovery gating. See the note in TutorialScreen
 *                            for why that differs from the ball roster.
 *
 * Both read the SAME strings out of public/bugs.yml, which is the property
 * worth a test file: two explanations of one mechanic, maintained separately,
 * is two chances to describe a bug the game no longer has.
 *
 * ── The gesture that is not here ────────────────────────────────────────────
 *
 * Press-and-hold was the first answer to "what is that thing?" and shipped
 * unusable. Reported as "Press and hold doesn't work", and it did not: a bug is
 * nine world units across and covers 10-17 of them in the time a touch takes to
 * register, against 22 of slop, and the 450ms hold then had to survive a
 * 12-unit move slop that a resting thumb drifts past. A tap KILLS a bug now
 * (bugs.test.ts covers it), so the two gestures could not coexist anyway: a
 * hold that fell short of 450ms would destroy the thing it was asking about.
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

// ── What is not reachable any more ─────────────────────────────────────────

describe("press-and-hold on a bug", () => {
  it("is gone, rather than present and unusable", () => {
    // The gesture was the reported defect. Leaving it wired while adding the
    // tap would have been the worse outcome of the two: a hold released a
    // moment early is a tap, so a player trying to ask what a bug was would
    // have killed it instead, and the explanation they wanted would have been
    // the last thing they saw of it.
    const source = read("src/lib/boardEntityInfo.ts");
    expect(source, "boardEntityAt still hit-tests bugs").not.toMatch(/kind:\s*"bug"/);
    const kinds = read("src/lib/boardEntityInfo.ts")
      .slice(source.indexOf("export type BoardEntityKind"), source.indexOf("export interface BoardEntityHit"));
    expect(kinds).not.toContain('"bug"');
  });

  it("left every other board object's explainer exactly as it was", () => {
    const strings = locale("en").boardInfo;
    render(<BoardEntityInfoModal hit={{ kind: "pickup", detail: "overtime" }} onClose={() => { /* closed elsewhere */ }} />);
    expect(screen.getByText(strings.pickup.title)).toBeTruthy();
    expect(screen.getByText(strings.pickup.body)).toBeTruthy();
  });

  it("leaves no dead strings behind in any locale", () => {
    for (const loc of LOCALES) {
      expect(locale(loc).boardInfo.bug, `${loc} still carries boardInfo.bug`).toBeUndefined();
    }
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

  it("teaches the tap, which is the only thing a player can DO to a bug", () => {
    const intro = locale("en").tutorial.bugs.intro;
    expect(intro.toLowerCase(), "the roster never mentions tapping one").toMatch(/tap/);
    render(<TutorialScreen onBack={() => { /* ditto */ }} />);
    expect(screen.getByText(intro)).toBeTruthy();
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
    const tutorial = read("src/components/game/TutorialScreen.tsx");
    const fx = read("src/lib/rendering/sleek/fxLayer.ts");
    expect(tutorial).toContain("getAllBugs()");
    expect(tutorial).toMatch(/bug\.description/);
    expect(tutorial).toMatch(/bug\.cost/);
    // The splat's label is the catalogue's name, not a lookup table beside it.
    expect(fx).toMatch(/drawSplatName\(def\.name/);
  });

  it("has its framing strings in every locale", () => {
    for (const loc of LOCALES) {
      const data = locale(loc);
      for (const key of ["title", "intro", "cost", "danger"]) {
        expect(data.tutorial?.bugs?.[key], `${loc}: tutorial.bugs.${key} is missing`).toBeTruthy();
      }
    }
  });

  it("keeps the em-dash out of all of it (CLAUDE.md)", () => {
    for (const loc of LOCALES) {
      const data = locale(loc);
      const strings = Object.values(data.tutorial.bugs as Record<string, string>);
      for (const line of strings) {
        expect(line, `${loc}: "${line}"`).not.toContain("—");
      }
    }
  });
});

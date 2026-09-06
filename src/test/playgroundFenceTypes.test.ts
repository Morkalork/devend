/**
 * Fence types in the admin Playground, and the loader nobody was calling.
 *
 * Two failures, both silent, both reported from the screen rather than by a
 * test:
 *
 *   THE OVERLAP   the ability tester floated at `bottom: 96`, which is the
 *                 middle of the fence slot row. The slots were rendered, hit-
 *                 testable and completely unreachable, and it read as the fence
 *                 bar being broken rather than as two things stacked.
 *   THE CATALOGUE the Playground handed the game no roster at all, so the bar
 *                 showed Standard and four empties. The one screen for trying a
 *                 mechanic out had none of it.
 *
 * And underneath both, a third: `loadFenceTypes` existed and NOTHING CALLED IT,
 * so the runtime re-fetch fences.ts promises in its header never happened. A
 * deployed build served whatever fences.yml was baked in, and editing the file
 * on staging did nothing at all - invisible, because the build-time catalogue
 * is perfectly valid and the game plays on without it.
 *
 * These are source checks on purpose. Rendering PlaygroundScreen means booting
 * a game canvas, and none of these is a behaviour a render would show: they are
 * "is this wired to that", which is exactly the class of bug that shipped here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllFenceTypes, STANDARD_FENCE_ID } from "@/lib/fences";
import { ACQUIRABLE_SLOTS } from "@/lib/fenceOwnership";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the Playground offers every fence type", () => {
  const src = read("src/components/admin/PlaygroundScreen.tsx");

  it("hands the game the whole catalogue, not a run's four slots", () => {
    // There are more acquirable types than a run has slots, so "all of them"
    // and "what a run can own" are genuinely different answers - which is the
    // whole reason the Playground must not go through the ownership rules.
    const acquirable = getAllFenceTypes().filter(f => f.id !== STANDARD_FENCE_ID);
    expect(acquirable.length).toBeGreaterThan(ACQUIRABLE_SLOTS);

    expect(src, "the Playground passes no fence roster").toMatch(/fenceSlotIds=\{/);
    expect(src, "it reads the catalogue rather than a fixed list").toMatch(/getAllFenceTypes\(\)/);
    expect(src, "it went through the ownership cap after all")
      .not.toMatch(/fenceSlotsFrom\(/);
  });

  it("re-fetches fences.yml the way it re-fetches the other catalogues", () => {
    // The Playground exists to try YAML edits. A catalogue it does not reload
    // is a catalogue whose edits it cannot show.
    for (const loader of ["loadBallTypes", "loadAbilities", "loadFenceTypes"]) {
      expect(src, `${loader} is not reloaded`).toMatch(new RegExp(`${loader}\\(\\)`));
    }
  });

  it("MEASURES the bottom bars rather than assuming a height", () => {
    // Two guesses have been wrong here: 96 drew the ability tester across the
    // fence slots, and so did 104. The stack is up to five rows deep and the
    // ability row wraps, so no constant survives - the height is a fact the
    // layout already knows, and the tester has to read it.
    expect(src, "the height is measured from the live element")
      .toMatch(/querySelector\('\[data-bottom-bars\]'\)/);
    expect(src).toMatch(/getBoundingClientRect\(\)\.height/);
    expect(src, "a tester is pinned to a hard-coded band again")
      .not.toMatch(/bottom: (96|104|112),/);

    // And the element it measures still exists, with that attribute on it.
    const game = read("src/components/game/GameScreen.tsx");
    expect(game, "GameScreen lost the handle the Playground measures")
      .toMatch(/data-bottom-bars/);
  });
});

describe("the fence catalogue is actually reloaded at runtime", () => {
  it("is fetched by the run session, beside abilities and ball types", () => {
    // fences.ts promises a runtime re-fetch in its header. Nothing called it,
    // so the promise was false everywhere except the tests.
    const src = read("src/hooks/useGameSession.ts");
    expect(src, "nothing loads fences.yml at runtime").toMatch(/loadFenceTypes\(\)/);
    // Wherever the other two catalogues are loaded, this one is too: three
    // loaders that drift apart is how one of them ends up never called.
    const abilities = (src.match(/loadAbilities\(\)/g) ?? []).length;
    const fences = (src.match(/loadFenceTypes\(\)/g) ?? []).length;
    expect(fences, "fences.yml is loaded at fewer sites than abilities.yml")
      .toBeGreaterThanOrEqual(abilities);
  });

  it("fetches the file the game actually serves", () => {
    const src = read("src/lib/fences.ts");
    expect(src).toMatch(/fetch\("\/fences\.yml"/);
    // A malformed file must leave the build-time catalogue standing: the
    // alternative is every fence silently becoming standard, with nothing on
    // screen to say why.
    expect(src).toMatch(/Keeping the build-time catalogue/);
  });
});

describe("every slot stays reachable when there are more than five", () => {
  it("lets the row scroll sideways instead of clipping it", () => {
    // Six slots do not fit across a phone. Reported from one: the row was cut
    // off at both edges, so Standard and Drill could not be tapped at all.
    const src = read("src/components/game/FenceSlotBar.tsx");
    expect(src, "the row is clipped rather than scrollable").toMatch(/overflow-x-auto/);
    // Centred while it fits, left-aligned once it does not. A centred flex row
    // that overflows puts its FIRST item off-screen with no way back to it.
    expect(src).toMatch(/w-max mx-auto/);
    expect(src, "a slot still swallows the sideways pan").not.toMatch(/touchAction: 'none'/);
  });
});

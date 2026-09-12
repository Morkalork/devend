/**
 * Sprint Planning on hold.
 *
 * "Let's put Sprint Planning on hold, remove it" is a request to take the
 * run-start loadout draft out of the run flow, not to delete the loadout
 * system: the ASCENSION draft draws from the same catalogue and is a different
 * step (it runs after the final level, not before level 1), and the Loadouts
 * catalogue screen still has something to show because of it.
 *
 * So the hold is one constant and these tests pin both halves of it: that no
 * run-start path can reach the draft while it is off, and that everything
 * needed to switch it back on is still in the tree. The second half matters
 * more than it looks - a hold that quietly rots into a deletion is the failure
 * mode here, and "on hold" was the user's word.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { SPRINT_PLANNING_ENABLED } from "@/lib/sprintPlanning";
import { backActionForScreen } from "@/lib/screenBack";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const SESSION = read("../hooks/useGameSession.ts");

describe("the switch", () => {
  it("is off", () => {
    expect(SPRINT_PLANNING_ENABLED).toBe(false);
  });
});

describe("no run start reaches the draft", () => {
  it("gates the draft flag inside enterRun, where every start path funnels", () => {
    // The three run-start paths (New Game, Play Again, Restart) all call
    // enterRun, so gating the flag on the way in beats gating three call sites
    // and missing the fourth.
    const body = SESSION.slice(SESSION.indexOf("const enterRun = useCallback("));
    expect(body.slice(0, 700)).toMatch(
      /const thenDraftLoadout = SPRINT_PLANNING_ENABLED && wantsLoadoutDraft;/
    );
  });

  it("routes every goToRunDraft through that one flag", () => {
    // The Tenure draft defers the loadout draft by stashing the flag and
    // replaying it when the player confirms, which is a second way in. Both
    // call sites must read thenDraftLoadout and nothing else.
    const calls = [...SESSION.matchAll(/nav\.goToRunDraft\(\)/g)];
    expect(calls.length, "goToRunDraft call sites").toBe(2);
    for (const call of calls) {
      const line = SESSION.slice(SESSION.lastIndexOf("\n", call.index!) + 1, call.index!);
      expect(line, "guarded by the draft flag").toMatch(/thenDraftLoadout/);
    }
  });

  it("credits no run-start loadout toward unique wins while it is off", () => {
    // draftedLoadoutIds[0] is specified as the RUN-START pick. With no run-start
    // draft, index 0 becomes the depth-1 ascension pick, which would then be
    // credited on every deeper loop forever.
    expect(SESSION).toMatch(
      /const startLoadoutId = SPRINT_PLANNING_ENABLED \? draftedLoadoutIds\[0\] : undefined;/
    );
  });
});

describe("the ascension draft is untouched", () => {
  it("still runs, because it is a different step", () => {
    expect(SESSION).toMatch(/nav\.goToAscensionDraft\(\)/);
    const body = SESSION.slice(SESSION.indexOf("const handleAscend = useCallback("));
    expect(body.slice(0, 1200)).not.toMatch(/SPRINT_PLANNING_ENABLED/);
  });

  it("still has loadouts to offer", () => {
    const doc = yaml.load(read("../../public/loadouts.yml")) as { loadouts?: unknown[] };
    expect(Array.isArray(doc.loadouts)).toBe(true);
    expect(doc.loadouts!.length).toBeGreaterThan(0);
  });
});

describe("it can be switched back on", () => {
  it("keeps the screen it would switch back on", () => {
    expect(existsSync(resolve(__dirname, "../components/game/RunDraftScreen.tsx"))).toBe(true);
    expect(read("../pages/Index.tsx")).toMatch(/currentScreen === 'runDraft'/);
  });

  it("keeps the screen's way out wired", () => {
    // Sprint Planning is the one draft that runs before the run begins, so its
    // back goes to the menu rather than being swallowed. Nothing here changes
    // that; the screen is unreachable, not rewired.
    expect(backActionForScreen("runDraft")).toBe("welcome");
  });

  it("keeps the loadout catalogue loading at run start", () => {
    // The ascension draft needs it, and so does the draft this hold parks.
    expect(SESSION).toMatch(/loadLoadouts\(\)/);
  });
});

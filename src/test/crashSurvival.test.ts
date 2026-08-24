/**
 * Surviving a crash, and not losing the shop to a locked phone.
 *
 * There was no error boundary anywhere. The game LOOP has a try/catch, so a
 * physics throw is survivable, but React had none: anything thrown while
 * rendering a HUD, a results overlay or a draft screen unmounted the whole tree
 * and left a blank page, on a phone, mid-run. For a player that is not a bug,
 * it is the end of the session.
 *
 * And the run was written once per MAP ENTRY, which is right for the map but
 * leaves everything BETWEEN maps unsaved. Clear a map, open the shop, get
 * distracted, the OS reclaims the tab: you come back to the map's start with
 * the purchases gone, having paid for them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  registerRunFlush, flushRunSave, installRunFlushListeners,
} from "@/lib/runSaveFlush";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("flushing the run from outside React", () => {
  beforeEach(() => registerRunFlush(null));
  afterEach(() => { registerRunFlush(null); vi.restoreAllMocks(); });

  it("writes through the registered saver", () => {
    const save = vi.fn();
    registerRunFlush(save);
    flushRunSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when no run is live", () => {
    expect(() => flushRunSave()).not.toThrow();
  });

  /**
   * Every caller is a last-chance path: a page being torn down, or an error
   * boundary already handling a crash. A save that threw there would turn one
   * failure into a worse one.
   */
  it("never throws, whatever the saver does", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerRunFlush(() => { throw new Error("storage full"); });
    expect(() => flushRunSave()).not.toThrow();
  });

  /** One run, one slot: two registrations would mean the older one writing
   *  stale state over the newer at teardown. */
  it("keeps only the latest registration", () => {
    const stale = vi.fn(), live = vi.fn();
    registerRunFlush(stale);
    registerRunFlush(live);
    flushRunSave();
    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("stops writing once cleared", () => {
    const save = vi.fn();
    registerRunFlush(save);
    registerRunFlush(null);
    flushRunSave();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the moments that actually lose work", () => {
  beforeEach(() => registerRunFlush(null));
  afterEach(() => registerRunFlush(null));

  /** The one that fires when a phone locks or the player switches app, which
   *  is the case that really loses the shop. */
  it("saves when the page is hidden", () => {
    const save = vi.fn();
    registerRunFlush(save);
    const uninstall = installRunFlushListeners();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).toHaveBeenCalled();

    uninstall();
    vi.restoreAllMocks();
  });

  it("does not save when the page merely becomes visible again", () => {
    const save = vi.fn();
    registerRunFlush(save);
    const uninstall = installRunFlushListeners();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).not.toHaveBeenCalled();

    uninstall();
    vi.restoreAllMocks();
  });

  it("saves on pagehide, for a real navigation away", () => {
    const save = vi.fn();
    registerRunFlush(save);
    const uninstall = installRunFlushListeners();
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalled();
    uninstall();
  });

  it("stops listening once uninstalled", () => {
    const save = vi.fn();
    registerRunFlush(save);
    installRunFlushListeners()();
    window.dispatchEvent(new Event("pagehide"));
    expect(save).not.toHaveBeenCalled();
  });

  /**
   * beforeunload is deliberately not used: it is unreliable on mobile and
   * browsers increasingly ignore it for anything but a confirmation prompt.
   */
  it("does not lean on beforeunload", () => {
    // Checks the LISTENER, not the file: the comment explaining why beforeunload
    // is avoided contains the word, so matching the text failed on its own
    // rationale. (The map builder does use beforeunload, correctly - there it is
    // a confirmation prompt, which is the one thing it is still good for.)
    expect(read("../lib/runSaveFlush.ts")).not.toMatch(/addEventListener\(\s*['"]beforeunload/);
  });
});

describe("two boundaries, not one", () => {
  const APP = read("../App.tsx");
  const INDEX = read("../pages/Index.tsx");
  const BOUNDARY = read("../components/GameErrorBoundary.tsx");

  /** A single boundary at the root would mean every crash costs the whole app. */
  it("wraps the game screen separately from the app", () => {
    expect(APP).toMatch(/<GameErrorBoundary scope="app"/);
    expect(INDEX).toMatch(/<GameErrorBoundary\s+scope="game"/);
  });

  it("recovers a game crash to the menu rather than reloading", () => {
    const inner = INDEX.slice(INDEX.indexOf('scope="game"'), INDEX.indexOf("<GameScreen"));
    expect(inner).toMatch(/onRecover=\{navigation\.goToWelcome\}/);
  });

  it("saves before it offers a way out, at both levels", () => {
    expect(APP).toMatch(/onCrash=\{flushRunSave\}/);
    expect(INDEX).toMatch(/onCrash=\{flushRunSave\}/);
  });

  it("catches with the React hooks that actually catch", () => {
    expect(BOUNDARY).toMatch(/static getDerivedStateFromError/);
    expect(BOUNDARY).toMatch(/componentDidCatch/);
  });

  /** A save that throws inside the crash handler must not take the boundary
   *  down too, or the blank page comes back by another route. */
  it("guards its own save", () => {
    const caught = BOUNDARY.slice(BOUNDARY.indexOf("componentDidCatch"), BOUNDARY.indexOf("private recover"));
    expect(caught).toMatch(/try \{[\s\S]*onCrash[\s\S]*\} catch/);
  });

  it("shows the player something, not a blank page", () => {
    expect(BOUNDARY).toMatch(/error\.message/);
    expect(BOUNDARY).toMatch(/Back to the menu|Reload/);
  });
});

/**
 * The tests are only a safety net if they run without being asked.
 */
describe("CI runs the checks", () => {
  const CI = readFileSync(resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");

  it("runs on push and pull request, on both branches that matter", () => {
    expect(CI).toMatch(/on:[\s\S]*push:[\s\S]*pull_request:/);
    expect(CI).toMatch(/branches: \[main, dev\]/);
  });

  it("runs all four gates", () => {
    expect(CI).toMatch(/tsc --noEmit -p tsconfig\.app\.json/);
    expect(CI).toMatch(/eslint \./);
    expect(CI).toMatch(/npm run test/);
    expect(CI).toMatch(/npm run build/);
  });

  /**
   * Plain `tsc --noEmit` is a no-op here: the root tsconfig has `files: []`
   * plus references, and outside build mode tsc does not traverse them, so it
   * checks zero files and always passes. CI running that would be worse than
   * no CI, because it would look green.
   */
  it("typechecks with the project flag, not the no-op form", () => {
    const typecheck = CI.slice(CI.indexOf("name: Typecheck"), CI.indexOf("name: Lint"));
    expect(typecheck).toMatch(/-p tsconfig\.app\.json/);
  });

  /** Pinned so the count can only come down; a new warning fails the build. */
  it("pins the lint baseline instead of allowing any number", () => {
    expect(CI).toMatch(/--max-warnings \d+/);
  });
});

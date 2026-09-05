/**
 * Undo/redo for the map builder.
 *
 * The stack itself is the easy half. The half that decides whether ten slots
 * are usable or useless is COALESCING: dragging a wall fires an update on every
 * pointer move, sixty a second, so without merging them a single one-second
 * drag pushes the entire history out and undo steps backwards one pixel at a
 * time. Most of these are about that, and about the two places a naive history
 * quietly does the wrong thing: reusing a coalesce key across an undo, and
 * dropping the wrong end when the limit is reached.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createHistory, pushHistory, undo, redo, canUndo, canRedo, resetHistory,
  historyGesture, HISTORY_LIMIT, COALESCE_MS, type History,
} from "@/lib/editHistory";

/** A history built by applying the given pushes to "a". */
const build = (
  pushes: Array<[string, { key?: string; at?: number }]>,
): History<string> =>
  pushes.reduce<History<string>>(
    (h, [value, opts]) => pushHistory(h, value, opts), createHistory("a"));

describe("stepping backwards and forwards", () => {
  it("starts with nowhere to go", () => {
    const h = createHistory("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("walks back through the states it was given", () => {
    let h = build([["b", {}], ["c", {}]]);
    expect(h.present).toBe("c");
    h = undo(h); expect(h.present).toBe("b");
    h = undo(h); expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
  });

  it("walks forward again", () => {
    let h = build([["b", {}], ["c", {}]]);
    h = undo(undo(h));
    expect(h.present).toBe("a");
    h = redo(h); expect(h.present).toBe("b");
    h = redo(h); expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  /** Every editor does this, and the alternative is a branching history with
   *  no UI to show it. */
  it("discards the redo stack once you edit again", () => {
    let h = build([["b", {}], ["c", {}]]);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, "d", {});
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe("d");
  });
});

describe("ten actions, and the oldest falls off", () => {
  it("keeps exactly the limit", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 25; i++) h = pushHistory(h, i, {});
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });

  /**
   * The direction matters: dropping from the END would throw away the actions
   * you are about to undo and keep ancient ones you will never reach.
   */
  it("drops the OLDEST, so the ten most recent are reachable", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 25; i++) h = pushHistory(h, i, {});
    for (let i = 24; i >= 15; i--) {
      h = undo(h);
      expect(h.present).toBe(i);
    }
    expect(canUndo(h)).toBe(false);
  });
});

/**
 * The reason ten slots are enough for a drag-based editor.
 */
describe("one gesture is one action", () => {
  it("collapses a whole drag into a single undo step", () => {
    let h = createHistory("start");
    // Sixty pointer moves on the same wall, a frame apart.
    for (let f = 1; f <= 60; f++) {
      h = pushHistory(h, `drag-${f}`, { key: "entity:wall-3", at: f * 16 });
    }
    expect(h.past.length, "a drag must not cost sixty slots").toBe(1);
    expect(h.present).toBe("drag-60");
    expect(undo(h).present, "undo returns to before the drag").toBe("start");
  });

  it("keeps dragging two different walls as two actions", () => {
    let h = createHistory("start");
    h = pushHistory(h, "a1", { key: "entity:wall-1", at: 0 });
    h = pushHistory(h, "a2", { key: "entity:wall-1", at: 16 });
    h = pushHistory(h, "b1", { key: "entity:wall-2", at: 32 });
    h = pushHistory(h, "b2", { key: "entity:wall-2", at: 48 });
    expect(h.past.length).toBe(2);
    expect(undo(h).present).toBe("a2");
  });

  it("starts a new action when you come back to the same wall later", () => {
    let h = createHistory("start");
    h = pushHistory(h, "first", { key: "entity:wall-1", at: 0 });
    h = pushHistory(h, "second", { key: "entity:wall-1", at: COALESCE_MS + 1 });
    expect(h.past.length).toBe(2);
    expect(undo(h).present).toBe("first");
  });

  /** Structural edits are always their own step, even three in a second. */
  it("never coalesces an unkeyed push", () => {
    let h = createHistory("start");
    for (let i = 1; i <= 3; i++) h = pushHistory(h, `add-${i}`, { at: i });
    expect(h.past.length).toBe(3);
  });

  it("does not merge a keyed push into an unkeyed one", () => {
    let h = createHistory("start");
    h = pushHistory(h, "added", { at: 0 });
    h = pushHistory(h, "moved", { key: "entity:new", at: 5 });
    expect(h.past.length).toBe(2);
    expect(undo(h).present).toBe("added");
  });

  /**
   * The subtle one. After an undo, the next edit must start a fresh entry even
   * if it happens to touch the same wall inside the window: coalescing into the
   * restored state would overwrite the very thing the undo just brought back,
   * and the undo would look as though it had not worked.
   */
  it("does not coalesce across an undo", () => {
    let h = createHistory("start");
    h = pushHistory(h, "dragged", { key: "entity:wall-1", at: 0 });
    h = undo(h);
    expect(h.present).toBe("start");
    h = pushHistory(h, "dragged-again", { key: "entity:wall-1", at: 10 });
    expect(h.past.length, "the restored state must survive").toBe(1);
    expect(undo(h).present).toBe("start");
  });

  it("does not coalesce across a redo either", () => {
    let h = createHistory("start");
    h = pushHistory(h, "one", { key: "k", at: 0 });
    h = pushHistory(h, "two", { at: COALESCE_MS + 1 });
    h = undo(h);
    h = redo(h);
    h = pushHistory(h, "three", { key: "k", at: COALESCE_MS + 5 });
    expect(h.present).toBe("three");
    expect(undo(h).present).toBe("two");
  });

  it("coalescing still clears the redo stack", () => {
    let h = createHistory("start");
    h = pushHistory(h, "a", { key: "k", at: 0 });
    h = pushHistory(h, "b", {});
    h = undo(h);
    // Now present is "a" with "b" in the future, and lastKey is null after the
    // undo, so this cannot merge; push a keyed pair to reach the merge path.
    h = pushHistory(h, "c", { key: "k", at: 100 });
    h = pushHistory(h, "d", { key: "k", at: 110 });
    expect(canRedo(h), "a merged edit is still an edit").toBe(false);
  });
});

describe("resetting for a fresh file", () => {
  it("leaves nothing to undo into", () => {
    const h = resetHistory(build([["b", {}], ["c", {}]]).present);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe("c");
  });
});

describe("the keyboard gestures", () => {
  const ev = (over: Partial<KeyboardEvent>) =>
    ({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false, ...over }) as KeyboardEvent;

  it("reads Ctrl+Z and Cmd+Z as undo", () => {
    expect(historyGesture(ev({ ctrlKey: true }))).toBe("undo");
    expect(historyGesture(ev({ metaKey: true }))).toBe("undo");
  });

  it("reads both redo spellings", () => {
    expect(historyGesture(ev({ ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyGesture(ev({ ctrlKey: true, key: "y" }))).toBe("redo");
  });

  it("ignores the key without a modifier, and other modified keys", () => {
    expect(historyGesture(ev({}))).toBeNull();
    expect(historyGesture(ev({ ctrlKey: true, key: "c" }))).toBeNull();
    expect(historyGesture(ev({ ctrlKey: true, key: "v" }))).toBeNull();
  });

  it("is case insensitive, so caps lock does not break undo", () => {
    expect(historyGesture(ev({ ctrlKey: true, key: "Z" }))).toBe("undo");
  });
});

/**
 * Checking the wiring, not only the module. A correct history helper is worth
 * nothing if the builder still writes to state behind its back, which is the
 * failure mode for this kind of feature: it works for the actions someone
 * remembered to route through it and silently loses the others.
 */
describe("the Map Builder routes every edit through the history", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/MapBuilder.tsx"), "utf8",
  );

  /**
   * Three sites may write the ladder and no more: the loader, the commit funnel
   * that records history, and the undo/redo restore. A fourth would be an edit
   * the history never sees, which is how this kind of feature rots - it works
   * for the actions someone remembered to route through it and silently loses
   * the rest.
   */
  it("writes the ladder from exactly the three sites that may", () => {
    const calls = SRC.split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("setLevels("));
    expect(calls.sort()).toEqual([
      "setLevels(loaded);",     // the initial load
      "setLevels(resolved);",   // commitLevels, which pushes to the history
      "setLevels(restored);",   // applyHistory, stepping to a recorded state
    ].sort());
  });

  it("records every commit", () => {
    const commit = SRC.slice(SRC.indexOf("const commitLevels"), SRC.indexOf("const applyHistory"));
    expect(commit).toMatch(/pushHistory/);
  });

  it("keys the drag-heavy edits so a drag is one step", () => {
    for (const key of ["entity:", "ball:", "area:", "well:"]) {
      expect(SRC, `no coalesce key for ${key}`).toContain(`\`${key}\${`);
    }
  });

  it("seeds the history on load rather than pushing the empty state", () => {
    expect(SRC).toMatch(/setHistory\(createHistory\(loaded\)\)/);
  });

  it("binds both the shortcut and the buttons", () => {
    expect(SRC).toMatch(/historyGesture\(e\)/);
    expect(SRC).toMatch(/applyHistory\('undo'\)/);
    expect(SRC).toMatch(/applyHistory\('redo'\)/);
  });

  /** Undoing an add leaves the added thing selected, and a panel bound to an
   *  entity that no longer exists renders nothing with no explanation. */
  it("drops selections that no longer point at anything", () => {
    const apply = SRC.slice(SRC.indexOf("const applyHistory"), SRC.indexOf("const createNewLevel"));
    expect(apply).toMatch(/setSelectedEntityId/);
    expect(apply).toMatch(/setSelectedBallId/);
    expect(apply).toMatch(/setSelectedAreaIndex/);
    expect(apply).toMatch(/setSelectedWellIndex/);
  });
});

/**
 * Whether the ladder in memory matches the one on disk.
 *
 * Undo made the absence of this actively misleading. It steps the in-memory
 * ladder back but cannot step the FILE back, so after a save-then-undo the two
 * disagreed and the builder said nothing at all: the Saved tick from a minute
 * ago was still the last thing it had told you.
 */
describe("the builder says when it has unsaved work", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/MapBuilder.tsx"), "utf8");

  it("marks the ladder dirty on every edit", () => {
    const commit = SRC.slice(SRC.indexOf("const commitLevels"), SRC.indexOf("const applyHistory"));
    expect(commit).toMatch(/setDirty\(true\)/);
  });

  /** The case that motivated it: stepping back cannot step the file back. */
  it("marks it dirty again after an undo", () => {
    const apply = SRC.slice(SRC.indexOf("const applyHistory"), SRC.indexOf("const createNewLevel"));
    expect(apply).toMatch(/setDirty\(true\)/);
  });

  it("clears it on load and on a successful save, and nowhere else", () => {
    const clears = SRC.split(/\r?\n/).filter(l => l.includes("setDirty(false)"));
    expect(clears.length, `cleared at: ${clears.map(c => c.trim()).join(" | ")}`).toBe(2);
    // One of them must be behind the save's ok check, or a failed write would
    // report the file as up to date.
    const save = SRC.slice(SRC.indexOf("const saveToServer"), SRC.indexOf("const copyYaml"));
    // Index comparison rather than one regex: what matters is that the clear
    // sits AFTER the response has been checked, since a failed write reporting
    // the file as up to date is worse than no indicator at all.
    //
    // Matched on `res.ok` rather than on one spelling of the branch. This read
    // `if (res.ok)` and broke when the handler grew an error path and became
    // `if (!res.ok) { ... } else { ... }` - the same guard, inverted. The test
    // was pinning the syntax rather than the rule.
    const ok = save.search(/if \(!?res\.ok\)/);
    expect(ok, "the save must check its response").toBeGreaterThan(-1);
    expect(save.indexOf("setDirty(false)")).toBeGreaterThan(ok);
  });

  it("refuses to leave with unsaved geometry, and only then", () => {
    expect(SRC).toMatch(/beforeunload/);
    const guard = SRC.slice(SRC.indexOf("if (!dirty) return;"), SRC.indexOf("// Load levels from map.yml"));
    expect(guard, "the guard must be gated on the flag").toMatch(/beforeunload/);
  });

  it("shows it on the Save button", () => {
    expect(SRC).toMatch(/dirty && saveStatus === 'idle'/);
  });
});

/**
 * The nudge that shows a player how to wake a sleeper.
 *
 * Two things are being guarded, and they fail in opposite directions. A hint
 * that never appears leaves the player where they were - staring at a teal dot
 * on level 31 with no explanation, because the modal fired once on level 15
 * sixteen maps ago. A hint that appears when it should not is worse: an
 * animated hand over the board while someone is mid-decision is not help, it is
 * a distraction with authority.
 */
import { describe, it, expect } from "vitest";
import {
  circuitHintTarget, circuitHintGesture, CIRCUIT_HINT_DELAY_SECONDS,
  circuitSeenKey, FIRST_CIRCUIT_MAP_ID, LEGACY_CIRCUIT_SEEN_KEY,
  type HintTerminal,
} from "@/lib/circuitHint";

const unlit = (x: number, y: number): HintTerminal => ({ x, y, lit: false });
const lit = (x: number, y: number): HintTerminal => ({ x, y, lit: true });

/** A circuit map that has been played long enough for the hint to be due. */
const due = (terminals: HintTerminal[]) => ({
  terminals,
  activePlaySeconds: CIRCUIT_HINT_DELAY_SECONDS + 1,
});

describe("when the hint appears", () => {
  it("appears on a circuit map once the delay has passed with nothing lit", () => {
    expect(circuitHintTarget(due([unlit(180, 200)]))).toEqual(unlit(180, 200));
  });

  it("says nothing before the delay", () => {
    expect(circuitHintTarget({
      terminals: [unlit(180, 200)],
      activePlaySeconds: CIRCUIT_HINT_DELAY_SECONDS - 0.1,
    })).toBeNull();
  });

  it("says nothing on a map with no circuit at all", () => {
    expect(circuitHintTarget({ terminals: null, activePlaySeconds: 999 })).toBeNull();
    expect(circuitHintTarget({ terminals: undefined, activePlaySeconds: 999 })).toBeNull();
    expect(circuitHintTarget({ terminals: [], activePlaySeconds: 999 })).toBeNull();
  });
});

describe("when the hint shuts up", () => {
  it("stops for good once ANY terminal is lit", () => {
    // A lit terminal is proof the player routed a fence through one, which is
    // the entire lesson. There is deliberately no separate "have they learned
    // it" flag: this IS that flag, and a second copy would be the one that
    // goes stale.
    expect(circuitHintTarget(due([lit(180, 200), unlit(700, 600)]))).toBeNull();
  });

  it("stays quiet while the player is dragging", () => {
    // They are already doing the thing. A hand animating over their own
    // in-progress cut is the least useful moment to draw one.
    expect(circuitHintTarget({ ...due([unlit(180, 200)]), isDragging: true })).toBeNull();
  });

  it("stays quiet behind a modal, a pause, or a finished map", () => {
    expect(circuitHintTarget({ ...due([unlit(180, 200)]), modalOpen: true })).toBeNull();
    expect(circuitHintTarget({ ...due([unlit(180, 200)]), paused: true })).toBeNull();
    expect(circuitHintTarget({ ...due([unlit(180, 200)]), levelEnded: true })).toBeNull();
  });
});

describe("which terminal it points at", () => {
  it("takes the first unlit one, in authored order", () => {
    // Stable on purpose. Nearest-to-a-ball would re-target as the ball moved
    // and the hand would hop between nodes while it was being read; authored
    // order is the designer's order and does not move.
    const t = circuitHintTarget(due([unlit(180, 200), unlit(700, 600)]));
    expect(t).toEqual(unlit(180, 200));
  });

  it("skips a lit one only when another is still dark", () => {
    // ...which cannot happen today, because any lit terminal silences the hint
    // entirely. Asserted so that if that rule is ever relaxed, the selection
    // still picks something unlit rather than pointing at a solved node.
    const t = circuitHintTarget({
      terminals: [lit(180, 200), unlit(700, 600)],
      activePlaySeconds: 999,
    });
    expect(t).toBeNull();
  });
});

describe("the gesture it draws", () => {
  it("runs horizontally through the node, because cuts are axis-aligned", () => {
    const g = circuitHintGesture(unlit(450, 300), 900);
    expect(g.from.y).toBe(300);
    expect(g.to.y).toBe(300);
    expect(g.from.x).toBeLessThan(450);
    expect(g.to.x).toBeGreaterThan(450);
  });

  it("centres on the node", () => {
    const g = circuitHintGesture(unlit(450, 300), 900);
    expect((g.from.x + g.to.x) / 2).toBeCloseTo(450, 6);
  });

  it("stays on the board for a node near an edge", () => {
    // A node at x=20 must not draw a hand out into the letterbox.
    for (const x of [0, 20, 880, 900]) {
      const g = circuitHintGesture(unlit(x, 300), 900);
      expect(g.from.x).toBeGreaterThanOrEqual(0);
      expect(g.to.x).toBeLessThanOrEqual(900);
      expect(g.to.x).toBeGreaterThan(g.from.x);
    }
  });
});

describe("the explainer modal's key", () => {
  it("is per map, so 16 and 31 are not silenced by 15", () => {
    // The bug this replaces: one flag for the whole game meant the explainer
    // fired on level 15 and never again, including on the map whose point is
    // waking BOTH terminals.
    expect(circuitSeenKey("level-15")).not.toBe(circuitSeenKey("level-16"));
    expect(circuitSeenKey("level-31")).not.toBe(circuitSeenKey("level-15"));
  });

  it("keeps the old single flag meaningful for the map it was really about", () => {
    // A player who has already seen level 15's copy should not be shown it
    // again on their next run through level 15.
    expect(FIRST_CIRCUIT_MAP_ID).toBe("level-15");
  });

  it("is namespaced so the tutorial reset can sweep it by prefix", () => {
    // resetAllTutorials cannot removeItem a per-map key by name, so it sweeps
    // the prefix. If that prefix ever stopped matching, "Re-enable All
    // Tutorials" would silently stop re-enabling this one - which is exactly
    // the state the circuit explainer was already in before this change.
    for (const id of ["level-15", "level-16", "level-31"]) {
      expect(circuitSeenKey(id).startsWith("devend_circuit_tutorial_seen:")).toBe(true);
    }
  });
});

describe("Re-enable All Tutorials brings the circuit explainer back", () => {
  it("sweeps every per-map key, and the retired single one", async () => {
    // The circuit explainer was missing from resetAllTutorials entirely, so the
    // button whose whole job is re-enabling tutorials silently never re-enabled
    // this one. Per-map keys cannot be removed by name, so they are swept by
    // prefix - and a prefix sweep is exactly the kind of thing that quietly
    // stops matching, hence this.
    const { renderHook, act } = await import("@testing-library/react");
    const { useTutorialManager } = await import("@/hooks/useTutorialManager");

    localStorage.setItem(circuitSeenKey("level-15"), "1");
    localStorage.setItem(circuitSeenKey("level-16"), "1");
    localStorage.setItem(circuitSeenKey("level-31"), "1");
    localStorage.setItem(LEGACY_CIRCUIT_SEEN_KEY, "1");
    localStorage.setItem("devend_keep_me", "1");

    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.resetAllTutorials(); });

    expect(localStorage.getItem(circuitSeenKey("level-15"))).toBeNull();
    expect(localStorage.getItem(circuitSeenKey("level-16"))).toBeNull();
    expect(localStorage.getItem(circuitSeenKey("level-31"))).toBeNull();
    expect(localStorage.getItem(LEGACY_CIRCUIT_SEEN_KEY)).toBeNull();
    // ...and nothing else. A sweep that took neighbouring keys with it would
    // be a reset button that wiped unrelated preferences.
    expect(localStorage.getItem("devend_keep_me")).toBe("1");
  });
});

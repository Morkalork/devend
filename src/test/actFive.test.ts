/**
 * Act V: Scale (36-40). The inversions, and the last second maps.
 *
 * Each map here is built on one geometric relationship that fails silently
 * when it drifts, so each is pinned: a mirror that has to turn a diagonal back
 * up to its wall, a portal mouth that has to stand inside the box it poisons, a
 * sleeper that has to lie over the box's mouth with its terminal far away, a
 * far mouth that has to face the box's open side.
 */
import { describe, it, expect } from "vitest";
import { resolveWinSpec, winSpecProblems, NO_RUN_RULES } from "@/lib/winSpec";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { castRayWithReflections } from "@/lib/wallGeometry";
import type { LevelConfig, WallEntity, BoxEntity } from "@/types/level";

import { LADDER } from "./fixtures/maps";

const at = (n: number) => LADDER.find(l => l.level === n)!;
const ACT_V = [36, 37, 38, 39, 40].map(at);
const PLAYABLE = ACT_V.filter(l => !l.boss);
type Rect = { x: number; y: number; width: number; height: number };
type Circle = { cx: number; cy: number; radius: number };
const entity = <T,>(l: LevelConfig, id: string) => (l.entities ?? []).find(e => e.id === id) as unknown as T;

describe("the act exists and is the right shape", () => {
  it("has all five maps, closed by a boss", () => {
    for (const l of ACT_V) expect(l, "a map is missing").toBeTruthy();
    expect(at(40).boss).toBeTruthy();
  });

  it("authors every playable win, keeps the clear in it, and leaves no back door", () => {
    for (const l of PLAYABLE) {
      const spec = resolveWinSpec(l, NO_RUN_RULES);
      expect(spec.authored, l.id).toBe(true);
      expect(spec.require.some(c => c.kind === "space"), l.id).toBe(true);
      expect(spec.alsoWinIf, l.id).toEqual([]);
      expect(winSpecProblems(spec, l), l.id).toEqual([]);
    }
  });

  it("prices every ask beyond the clear", () => {
    for (const l of PLAYABLE) {
      for (const c of resolveWinSpec(l, NO_RUN_RULES).require.filter(c => c.kind !== "space")) {
        expect(c.bonusPercent ?? 0, `${l.id} ${c.kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("36 bends the only mid-wall pocket off the mirror", () => {
  const l = at(36);

  it("turns a diagonal from the top wall back up to it, closing a superior V", () => {
    const g = createInitialGameData({ ...l, neverRotates: true }, 36, DEFAULT_MODIFIERS);
    const o = { x: 400, y: 120 };
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const fwd = castRayWithReflections(o, d, g.walls)!;
    const back = castRayWithReflections(o, { x: -d.x, y: -d.y }, g.walls)!;
    const pts = [...back.waypoints.slice(1).reverse(), o, ...fwd.waypoints.slice(1)];
    // Starts and ends on the top wall, with one bounce between.
    expect(pts[0].y).toBeCloseTo(45, 0);
    expect(pts[pts.length - 1].y).toBeCloseTo(45, 0);
    const apex = Math.max(...pts.map(p => p.y));
    const base = pts[pts.length - 1].x - pts[0].x;
    // The V's area against the board: under the superior bar at the start (4%).
    expect((base * (apex - 45)) / 2 / (810 * 810) * 100).toBeLessThan(4);
  });

  it("asks for the superior lock the V is for", () => {
    expect(resolveWinSpec(l, NO_RUN_RULES).require.some(c => c.kind === "superiorLocks")).toBe(true);
  });
});

describe("37 puts the portal in the box", () => {
  const l = at(37);

  it("stands one mouth inside the gate box and the other outside it", () => {
    const box = (l.coloredAreas ?? []).find(a => a.required !== false)! as Rect;
    const inside = (c: Circle) => c.cx > box.x && c.cx < box.x + box.width && c.cy > box.y && c.cy < box.y + box.height;
    const mouths = (l.entities ?? []).filter(e => (e as WallEntity).portal) as unknown as Circle[];
    expect(mouths).toHaveLength(2);
    expect(mouths.filter(inside)).toHaveLength(1);
  });

  it("leaves the room a doorway a ball can use", () => {
    const east = entity<Rect>(l, "room-east");
    expect(855 - (east.y + east.height)).toBeGreaterThanOrEqual(60);
  });
});

describe("38 pairs each sleeper with the wrong terminal", () => {
  const l = at(38);

  it("lays one sleeper over the box's mouth, with the far terminal", () => {
    const box = entity<BoxEntity & Rect>(l, "post-box");
    expect(box.mouth).toBe("up");
    const [far, near] = l.circuit!.terminals;
    expect(far.ball.x).toBeGreaterThan(box.x);
    expect(far.ball.x).toBeLessThan(box.x + box.width);
    expect(far.ball.y).toBeLessThan(box.y);
    const dist = (t: { x: number; y: number; ball: { x: number; y: number } }) => Math.hypot(t.x - t.ball.x, t.y - t.ball.y);
    expect(dist(far)).toBeGreaterThan(2 * dist(near));
  });

  it("asks for two deliveries from a box that holds two", () => {
    const d = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "delivered");
    expect(d?.kind === "delivered" && d.count).toBe(2);
    expect(entity<BoxEntity>(l, "post-box").capacity).toBe(2);
  });
});

describe("39 throws balls at the box", () => {
  const l = at(39);

  it("stands the far mouth just off the box's open side", () => {
    const box = entity<BoxEntity & Rect>(l, "dead-letters");
    expect(box.mouth).toBe("left");
    const out = entity<Circle>(l, "warp-out");
    expect(out.cx).toBeLessThan(box.x);
    expect(box.x - out.cx).toBeLessThan(150);
    expect(out.cy).toBeGreaterThan(box.y);
    expect(out.cy).toBeLessThan(box.y + box.height);
  });

  it("adds the monkey's ball late, and says so", () => {
    const beat = (l.beats ?? []).find(b => b.spawnAdds);
    expect(beat?.announce).toBeTruthy();
    expect(beat?.atSpaceRemaining ?? 100).toBeLessThan(50);
  });
});

describe("40 leaks", () => {
  it("is one build, three traps, minions and no wipe", () => {
    const b = at(40).boss!.bossBall!;
    expect(b.count ?? 1).toBe(1);
    expect(b.hp).toBe(3);
    expect(b.spitIntervalSeconds ?? 0).toBeGreaterThan(0);
    expect(b.fenceWipeSeconds ?? 0).toBe(0);
  });
});

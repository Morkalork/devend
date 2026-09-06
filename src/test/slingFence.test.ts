/**
 * The Redeploy fence: the one you throw with.
 *
 * Four things here are the ones that would ship broken and silent:
 *
 *   THE SPAN     the fence IS the band, so its length is the band's width. If
 *                the sweep quietly used the ability's fixed BAND_HALF_WIDTH, a
 *                short fence would throw a ball three fence-lengths away from
 *                it and the ring the player aimed with would have been a lie.
 *   THE SIDE     a band snaps FORWARD. A ball behind the fence is a ball you
 *                pulled past, and catching it would make the throw disagree
 *                with the picture.
 *   THE SPEND    once per fence, and a cut that bounced is one fence in
 *                several segments. Spending only the grabbed segment hands a
 *                bounced cut two throws.
 *   THE MISS     a throw that caught nothing must not spend the fence. The
 *                player can see the rings while they drag, so an empty release
 *                is a change of mind, not a miss to charge them for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isLoadedSling, loadedSlingAt, slingShape, slingCatches, fireSlingFence,
  SLING_GRAB_SLOP, slingGrabReach,
} from "@/lib/physics/slingFence";
import { BASE_BALL_RADIUS, FREEZE_TAP_SLOP } from "@/lib/gameConstants";
import { BAND_DEAD_PULL, BAND_HALF_WIDTH, BAND_MAX_POWER, bandShape, inBandSweep } from "@/lib/rubberBand";
import { getFenceType, getAllFenceTypes } from "@/lib/fences";
import type { Wall } from "@/lib/wallGeometry";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { createSpaceGrid, worldToGridIndex, markCellRemoved } from "@/lib/spaceGrid";

/** A horizontal fence of `length`, centred on (cx, cy). */
const fence = (over: Partial<Wall> = {}, length = 120, cx = 400, cy = 400): Wall => ({
  id: "w1",
  start: { x: cx - length / 2, y: cy },
  end: { x: cx + length / 2, y: cy },
  thickness: 6,
  fenceTypeId: "redeploy",
  ...over,
} as unknown as Wall);

const ball = (x: number, y: number, over: Partial<Ball> = {}): Ball => ({
  id: `b${x},${y}`, position: { x, y }, velocity: { x: 0, y: 100 },
  speed: 100, baseSpeed: 200, minimumSpeed: 60, radius: 18, state: "active",
  ...over,
} as unknown as Ball);

const board = (walls: Wall[], balls: Ball[] = []): CanvasGameState =>
  ({ walls, balls } as unknown as CanvasGameState);

/** A pull straight DOWN, so the throw goes UP (negative y). */
const pullDown = (len: number) => ({ x: 0, y: len });

describe("the catalogue entry", () => {
  it("has retired rebar for it", () => {
    // Not a rename: rebar's durability was the thing being replaced, and a
    // stale id left in the catalogue would still be sellable.
    expect(getAllFenceTypes().map(f => f.id)).not.toContain("rebar");
    expect(getFenceType("redeploy").id).toBe("redeploy");
  });

  it("is the only slingshot, and it pays in build speed", () => {
    const slings = getAllFenceTypes().filter(f => f.slingshot);
    expect(slings.map(f => f.id)).toEqual(["redeploy"]);
    expect(slings[0].buildSpeed).toBeLessThan(1);
  });

  it("does not also chew or anchor", () => {
    // Every type is ONE idea. A slingshot that also drilled would leave the
    // drill certificate with nothing of its own to sell.
    const r = getFenceType("redeploy");
    expect(r.drillDamage).toBe(0);
    expect(r.anchorOnBreakable).toBe(false);
    expect(r.ballSpeedStep).toBe(0);
  });
});

describe("grabbing one", () => {
  it("finds a loaded fence under the finger", () => {
    const w = fence();
    const g = board([w]);
    expect(loadedSlingAt(g, { x: 400, y: 400 })).toBe(w);
    // Generously, because a fingertip covers far more of the board than six
    // units of fence.
    expect(loadedSlingAt(g, { x: 400, y: 400 + SLING_GRAB_SLOP })).toBe(w);
    expect(loadedSlingAt(g, { x: 400, y: 400 + SLING_GRAB_SLOP + 30 })).toBeNull();
  });

  it("is at least as easy to hit as tapping a ball", () => {
    // Reported: "I accidentally drew a fence instead of pulling it back."
    // The slop was copied from the ball tap, which is wrong twice over - a ball
    // brings 18 units of its own radius to that target and a fence brings 3, so
    // copying the SLOP gave a 25-unit reach against the ball's 40.
    //
    // Pinned as a comparison rather than a number, because what matters is that
    // this is not the tightest target on the board.
    const ballTap = BASE_BALL_RADIUS + FREEZE_TAP_SLOP;
    expect(slingGrabReach(fence())).toBeGreaterThan(ballTap);
    // And the asymmetry that justifies being generous: a wrong grab costs the
    // gesture, a wrong cut costs a fence out of the map's budget.
    expect(SLING_GRAB_SLOP).toBeGreaterThan(FREEZE_TAP_SLOP);
  });

  it("draws the grip at the radius it tests", () => {
    // A grip smaller than the target teaches the player to aim finer than they
    // need to, which is the bug above; larger, it promises a grab that misses.
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/rendering/sleek/fxLayer.ts"), "utf8");
    expect(src, "the grip is drawn at some other radius")
      .toMatch(/slingGrabReach\(wall\) \* scale/);
  });

  it("ignores every other kind of fence", () => {
    for (const id of ["standard", "ice", "flare", "tripwire", "drill", undefined]) {
      const g = board([fence({ fenceTypeId: id })]);
      expect(loadedSlingAt(g, { x: 400, y: 400 }), `${id} was grabbable`).toBeNull();
    }
  });

  it("ignores a spent one", () => {
    const g = board([fence({ slingSpent: true })]);
    expect(loadedSlingAt(g, { x: 400, y: 400 })).toBeNull();
    expect(isLoadedSling(fence({ slingSpent: true }))).toBe(false);
  });

  it("ignores one stranded in captured space", () => {
    // The ghost-wall bug, re-entered through a new door: player fences are
    // never pruned when their region locks, so an invisible one in grey space
    // would answer a grab and swallow a legal cut the player was starting.
    const grid = createSpaceGrid(
      { vertices: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }] },
      [],
    );
    const w = fence();
    const g = { walls: [w], balls: [], spaceGrid: grid } as unknown as CanvasGameState;
    const press = { x: 400, y: 380 };
    expect(loadedSlingAt(g, press), "a live fence was not grabbable").toBe(w);

    // Kill the cells on the press side: the fence is now stranded behind a lock.
    for (let y = 300; y < 400; y += 5) {
      for (let x = 300; x < 500; x += 5) {
        const i = worldToGridIndex(grid, x, y);
        if (i >= 0) markCellRemoved(grid, i);
      }
    }
    expect(loadedSlingAt(g, press)).toBeNull();
  });

  it("takes the nearest when two meet", () => {
    const near = fence({ id: "near" }, 120, 400, 400);
    const far = fence({ id: "far" }, 120, 400, 415);
    const g = board([far, near]);
    expect(loadedSlingAt(g, { x: 400, y: 401 })?.id).toBe("near");
  });
});

describe("the pull", () => {
  it("is not a throw below the dead zone", () => {
    // A tap on a fence must not spend it.
    expect(slingShape(fence(), pullDown(BAND_DEAD_PULL - 1))).toBeNull();
    expect(slingShape(fence(), pullDown(BAND_DEAD_PULL + 1))).not.toBeNull();
  });

  it("throws opposite the pull, from the fence's resting line", () => {
    const w = fence();
    const s = slingShape(w, pullDown(100))!;
    expect(s.heading.y).toBeLessThan(0);          // pulled down, throws up
    expect(s.centre).toEqual({ x: 400, y: 400 }); // the fence, not the finger
  });

  it("spans the fence, not the ability's fixed width", () => {
    // The whole reason halfWidth lives on the shape. A 40-unit fence throws a
    // 40-unit lane; the ability's band is 220 wide whatever is under it.
    const short = slingShape(fence({}, 40), pullDown(100))!;
    expect(short.halfWidth).toBe(20);
    const long = slingShape(fence({}, 300), pullDown(100))!;
    expect(long.halfWidth).toBe(150);
    expect(bandShape({ x: 0, y: 0 }, { x: 0, y: 100 })!.halfWidth).toBe(BAND_HALF_WIDTH);
  });

  it("reaches full power at the same stretch the other slingshots do", () => {
    const s = slingShape(fence(), pullDown(1000))!;
    expect(s.power).toBeCloseTo(BAND_MAX_POWER, 5);
    expect(s.powerT).toBe(1);
  });
});

describe("the throw", () => {
  it("flings what is in front and leaves what is behind", () => {
    // Pulled down, so the throw is up: the ball ABOVE the fence is the one it
    // snaps over.
    const w = fence();
    const infront = ball(400, 360);
    const behind = ball(400, 440);
    const g = board([w], [infront, behind]);
    const s = slingShape(w, pullDown(120))!;

    expect(slingCatches(g, s)).toEqual([infront]);
    expect(fireSlingFence(g, w, s)).toBe(true);
    expect(infront.velocity.y).toBeLessThan(0);
    expect(Math.hypot(infront.velocity.x, infront.velocity.y))
      .toBeCloseTo(infront.baseSpeed! * s.power, 4);
    expect(behind.velocity).toEqual({ x: 0, y: 100 });
  });

  it("leaves a ball beyond the fence's ends alone", () => {
    // The span again, this time through the throw rather than the number: a
    // ball off the end of a short fence is not in its lane.
    const w = fence({}, 40);
    const b = ball(460, 370);
    const g = board([w], [b]);
    const s = slingShape(w, pullDown(120))!;
    expect(fireSlingFence(g, w, s)).toBe(false);
    expect(b.velocity).toEqual({ x: 0, y: 100 });
  });

  it("does not throw a ball that is not in play", () => {
    const w = fence();
    const dormant = ball(400, 360, { state: "dormant" });
    const g = board([w], [dormant]);
    expect(fireSlingFence(g, w, slingShape(w, pullDown(120))!)).toBe(false);
  });

  it("spends the fence, once", () => {
    const w = fence();
    const g = board([w], [ball(400, 360)]);
    expect(fireSlingFence(g, w, slingShape(w, pullDown(120))!)).toBe(true);
    expect(w.slingSpent).toBe(true);
    expect(isLoadedSling(w)).toBe(false);
    expect(loadedSlingAt(g, { x: 400, y: 400 })).toBeNull();
  });

  it("spends every segment of the same cut", () => {
    // A cut that bounced is one fence in several walls. Leaving the rest loaded
    // would pay a bounced cut twice for one gesture.
    const a = fence({ id: "a", cutId: "cut-1" });
    const b = fence({ id: "b", cutId: "cut-1" }, 120, 400, 300);
    const other = fence({ id: "c", cutId: "cut-2" }, 120, 700, 700);
    const g = board([a, b, other], [ball(400, 360)]);
    expect(fireSlingFence(g, a, slingShape(a, pullDown(120))!)).toBe(true);
    expect(b.slingSpent).toBe(true);
    expect(other.slingSpent).toBeUndefined();
  });

  it("costs nothing when it catches nothing", () => {
    const w = fence();
    const g = board([w], [ball(400, 440)]);   // behind it
    expect(fireSlingFence(g, w, slingShape(w, pullDown(120))!)).toBe(false);
    expect(w.slingSpent).toBeUndefined();
    expect(isLoadedSling(w)).toBe(true);
  });
});

describe("the sweep it shares with the Rubber Band ability", () => {
  it("still reads the ability's own width", () => {
    // The refactor that put halfWidth on the shape must not have changed what
    // the ability catches. A point 100 out is inside its 220-wide band and
    // outside a 120-long fence's.
    const s = bandShape({ x: 400, y: 400 }, { x: 400, y: 500 })!;
    expect(inBandSweep({ x: 500, y: 460 }, s)).toBe(true);
    const f = slingShape(fence(), pullDown(100))!;
    expect(inBandSweep({ x: 500, y: 360 }, f)).toBe(false);
  });
});

describe("the gesture is actually wired up", () => {
  // The launcher shipped inert for exactly this reason: every piece existed and
  // one assignment was missing, so nothing on screen ever said. These name the
  // links in the chain from a finger to a thrown ball, so a refactor that drops
  // one fails here rather than on somebody's phone.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("grabs, drags and throws from the input layer", () => {
    const src = read("src/hooks/useGameInput.ts");
    expect(src, "nothing grabs a fence").toMatch(/loadedSlingAt\(/);
    expect(src, "the pull is never followed").toMatch(/slingDrag\.current\s*=/);
    expect(src, "letting go never throws").toMatch(/fireSlingFence\(/);
  });

  it("grabs BEFORE the cut path can refuse the press", () => {
    // A press on a fence is "wall in the way". If the grab were checked after
    // that refusal it would never run, and the fence would simply not respond.
    const src = read("src/hooks/useGameInput.ts");
    expect(src.indexOf("loadedSlingAt(")).toBeGreaterThan(-1);
    expect(src.indexOf("loadedSlingAt(")).toBeLessThan(src.indexOf("wallInTheWay"));
  });

  it("drops a half-drawn pull when the map or the pause does", () => {
    // A throw resumed across a pause or into the next map would be aimed at a
    // board that has moved, at a fence that no longer exists.
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src.match(/slingDrag = null/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("draws the grip and the stretch", () => {
    const src = read("src/lib/rendering/sleek/fxLayer.ts");
    expect(src, "a loaded fence has no affordance").toMatch(/isLoadedSling\(/);
    expect(src, "the pull is invisible").toMatch(/slingCatches\(/);
  });
});

import { describe, it, expect } from "vitest";
import { buildFenceChains, buildFenceTaper, taperFactor, chainFlareEnds } from "@/lib/rendering/wallChains";
import { Wall } from "@/lib/wallGeometry";
import { Polygon } from "@/lib/polygon";

// Minimal fence segment factory.
let n = 0;
function fence(ax: number, ay: number, bx: number, by: number, createdAt = 100): Wall {
  return { id: `wall-${n++}`, start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: 6, createdAt };
}

describe("buildFenceChains", () => {
  it("joins a fence's two arms into one continuous polyline through the centre", () => {
    // Fence drawn from centre (50,50) out to (0,50) and (50,0).
    const walls = [
      fence(50, 50, 0, 50),
      fence(50, 50, 50, 0),
    ];
    const chains = buildFenceChains(walls);
    expect(chains).toHaveLength(1);
    const pts = chains[0].points;
    expect(pts).toHaveLength(3);
    // Endpoints are the two outer ends; the centre sits between them.
    expect(pts[1]).toEqual({ x: 50, y: 50 });
    const ends = [pts[0], pts[2]].map(p => `${p.x},${p.y}`).sort();
    expect(ends).toEqual(["0,50", "50,0"]);
  });

  it("joins a multi-segment (bounced) arm end to end", () => {
    const walls = [
      fence(50, 50, 30, 30), // centre -> bounce
      fence(30, 30, 10, 50), // bounce -> outer
      fence(50, 50, 90, 50), // centre -> other outer
    ];
    const chains = buildFenceChains(walls);
    expect(chains).toHaveLength(1);
    expect(chains[0].points).toHaveLength(4);
  });

  it("keeps two disconnected fences as separate chains", () => {
    const walls = [
      fence(0, 0, 10, 0),
      fence(100, 100, 110, 100),
    ];
    const chains = buildFenceChains(walls);
    expect(chains).toHaveLength(2);
  });

  it("ignores board-edge and mirror walls", () => {
    const walls: Wall[] = [
      { id: "board-edge-0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6 },
      { id: "mirror-edge-0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 }, thickness: 6, isMirror: true },
    ];
    expect(buildFenceChains(walls)).toHaveLength(0);
  });

  it("carries createdAt (newest) and thickness for the fresh-draw bloom", () => {
    const walls = [fence(50, 50, 0, 50, 200), fence(50, 50, 50, 0, 300)];
    const chains = buildFenceChains(walls);
    expect(chains[0].createdAt).toBe(300);
    expect(chains[0].thickness).toBe(6);
  });
});

describe("wall-join flare", () => {
  it("keeps full width and intensity at the contact (enlargement disabled, TAPER_FLARE = 1)", () => {
    expect(taperFactor(20, 10)).toEqual({ w: 1, a: 1 }); // past the join zone
    expect(taperFactor(10, 10)).toEqual({ w: 1, a: 1 }); // exactly at the zone edge
    const tip = taperFactor(0, 10);
    expect(tip.w).toBe(1);            // no enlargement at the wall
    expect(tip.a).toBe(1);            // full intensity
  });

  it("returns full scale when the join flare is disabled", () => {
    expect(taperFactor(0, 0)).toEqual({ w: 1, a: 1 });
  });

  it("subdivides the join zones (for the white fade) and leaves the middle a single piece", () => {
    // 100px straight line, 20px join zone each end.
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const pieces = buildFenceTaper(pts, 20);
    expect(pieces.length).toBeGreaterThan(2);
    // Width is constant (enlargement off) — the merge is carried by the fade.
    const mid = pieces.find(p => (p.x1 + p.x2) / 2 > 45 && (p.x1 + p.x2) / 2 < 55)!;
    expect(mid.w).toBe(1);
    expect(mid.a).toBe(1);
    // Pieces span the whole line.
    expect(pieces[0].x1).toBeCloseTo(0);
    expect(pieces[pieces.length - 1].x2).toBeCloseTo(100);
  });

  it("tags each piece with its distance to the wall so the white core can stop short", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const pieces = buildFenceTaper(pts, 20);
    expect(pieces[0].dw).toBeLessThan(5); // first piece sits right at the wall
    const mid = pieces.find(p => (p.x1 + p.x2) / 2 > 45 && (p.x1 + p.x2) / 2 < 55)!;
    expect(mid.dw).toBeGreaterThan(20);   // interior piece is far from either wall
  });

  it("overshoots past the endpoints so the core buries under the wall", () => {
    const pts = [{ x: 10, y: 0 }, { x: 90, y: 0 }];
    const pieces = buildFenceTaper(pts, 20, 5);
    // Ends extended outward by 5px so the bright cap lands past the wall.
    expect(pieces[0].x1).toBeLessThan(10);
    expect(pieces[pieces.length - 1].x2).toBeGreaterThan(90);
  });

  it("does not flare/overshoot a non-wall (fence-to-fence) end", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const flared = buildFenceTaper(pts, 20, 5, [true, true]);
    const plain = buildFenceTaper(pts, 20, 5, [true, false]);
    expect(flared[flared.length - 1].x2).toBeGreaterThan(100); // flared end overshoots
    expect(plain[plain.length - 1].x2).toBeCloseTo(100);       // plain end stops at the point
    expect(plain[plain.length - 1].w).toBe(1);                 // and has no flare
  });

  it("butt-caps the terminal piece at a non-wall (fence-to-fence) end only", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const oneWall = buildFenceTaper(pts, 20, 5, [true, false]);
    expect(oneWall[oneWall.length - 1].butt).toBe(true); // fence-to-fence end → butt
    expect(oneWall[0].butt).toBeFalsy();                 // wall end stays round
    const bothWall = buildFenceTaper(pts, 20, 5, [true, true]);
    expect(bothWall.every(p => !p.butt)).toBe(true);     // both wall ends → no butt
  });
});

describe("chainFlareEnds", () => {
  const square: Polygon = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };

  it("flags ends that sit on the board boundary", () => {
    expect(chainFlareEnds([{ x: 0, y: 50 }, { x: 100, y: 50 }], square, [])).toEqual([true, true]);
  });

  it("does not flag an end that lands in the interior (on another fence)", () => {
    expect(chainFlareEnds([{ x: 0, y: 50 }, { x: 50, y: 50 }], square, [])).toEqual([true, false]);
  });
});

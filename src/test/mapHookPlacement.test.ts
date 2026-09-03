/**
 * Nothing a map authors may sit on top of anything else it authors.
 *
 * Written while adding breakables and colored areas to the eleven maps that had
 * neither. Placing them by eye is exactly the kind of edit that looks right in
 * the YAML and is wrong on the board: a bonus pocket half-buried under a wall
 * pays a multiplier the player cannot reach, and a chest inside a pillar cannot
 * be smashed at all. Neither shows up as an error anywhere - the map just
 * quietly stops offering what it says it offers.
 *
 * So the check is geometric and covers the WHOLE ladder, not only the maps
 * touched here: every authored rect and circle, every colored area, and the
 * worst case of every random slot (its candidate range at maximum radius,
 * because the slot rolls at runtime and any roll must be safe).
 *
 * Colored areas overlapping walls is the interesting case and the reason for
 * the separate, tighter rule below: an area is a REGION you lock a ball inside,
 * so it needs its interior clear, while two walls touching is ordinary level
 * geometry.
 */
import { describe, it, expect } from "vitest";
import { entityOutlineBounds } from "@/lib/entityOutline";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { LevelConfig } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as { levels: LevelConfig[] }).levels;

interface Box { x0: number; y0: number; x1: number; y1: number; id: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Every authored solid on a map, as an axis-aligned box. */
function solids(level: any): Box[] {
  const out: Box[] = [];
  for (const e of level.entities ?? []) {
    // The DEFORMED bounds. These were the authored x/y/width/height, which stop
    // describing the object the moment it is bowed or turned - and level 6 is
    // exactly that case: a wall bent 0.428 and a barrel turned -120 degrees
    // overlap as RECTANGLES by 25x50 units and do not touch at all as shapes.
    // The guard failed a layout that was fine, which is the worse direction for
    // a guard to fail in: it teaches the author to stop believing it.
    const b = entityOutlineBounds(e);
    if (b) out.push({ ...b, id: e.id });
  }
  // A slot's WORST case: the whole candidate range, at the largest radius it
  // may roll. A placement that only collides on an unlucky roll is a bug that
  // reproduces one run in five, which is worse than one that always does.
  for (const slot of level.slots ?? []) {
    for (const c of slot.candidates ?? []) {
      if (c.shape === "circle") {
        const r = Array.isArray(c.radius) ? c.radius[1] : c.radius;
        const cx = Array.isArray(c.cx) ? c.cx : [c.cx, c.cx];
        const cy = Array.isArray(c.cy) ? c.cy : [c.cy, c.cy];
        out.push({ x0: cx[0] - r, y0: cy[0] - r, x1: cx[1] + r, y1: cy[1] + r, id: `slot:${slot.id}` });
      }
    }
  }
  return out;
}

function areas(level: any): Box[] {
  return (level.coloredAreas ?? []).map((a: any, i: number) => ({
    x0: a.x, y0: a.y, x1: a.x + a.width, y1: a.y + a.height, id: `${a.kind}-area-${i}`,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const label = (l: { level: number; id: string }) => `${l.id} (level ${l.level})`;

/**
 * How much of an area is open board, sampled on a grid.
 *
 * Not "does it touch a wall": level 33's const nook is BUILT from a shelf and a
 * lip inside the zone, and level 10's var box clips the centre pillar by about
 * thirty pixels of corner. Both are deliberate, and a zero-overlap rule would
 * call the game's two best-composed pockets broken. What actually matters is
 * whether a ball can still be sealed in there.
 */
function freeFraction(area: Box, blockers: Box[], step = 5): number {
  let open = 0, total = 0;
  for (let x = area.x0 + step / 2; x < area.x1; x += step) {
    for (let y = area.y0 + step / 2; y < area.y1; y += step) {
      total++;
      if (!blockers.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) open++;
    }
  }
  return total === 0 ? 0 : open / total;
}

/** Side of the largest axis-aligned clear square inside the area. */
function largestClearSquare(area: Box, blockers: Box[], step = 5): number {
  const cols = Math.floor((area.x1 - area.x0) / step);
  const rows = Math.floor((area.y1 - area.y0) / step);
  // Classic largest-square DP over the free/blocked grid.
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  let best = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const x = area.x0 + (c - 0.5) * step;
      const y = area.y0 + (r - 0.5) * step;
      const blocked = blockers.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      dp[r][c] = blocked ? 0 : 1 + Math.min(dp[r - 1][c], dp[r][c - 1], dp[r - 1][c - 1]);
      if (dp[r][c] > best) best = dp[r][c];
    }
  }
  return best * step;
}

describe("every colored area is somewhere a ball can actually be locked", () => {
  it("keeps most of every area as open board", () => {
    // An area is a REGION you seal a ball inside. Fill it with wall and it pays
    // a multiplier on a pocket that cannot be made, which no screen reports.
    const buried: string[] = [];
    for (const level of LEVELS) {
      const blockers = solids(level);
      for (const area of areas(level)) {
        const free = freeFraction(area, blockers);
        if (free < 0.6) buried.push(`${label(level)}: ${area.id} only ${Math.round(free * 100)}% open`);
      }
    }
    expect(buried).toEqual([]);
  });

  it("leaves room inside every area to actually seal a pocket", () => {
    // A ball is about 14-20 units across and a lock needs a pocket around it.
    // An area whose free space is all thin strips down the edges is decorative.
    const cramped: string[] = [];
    for (const level of LEVELS) {
      const blockers = solids(level);
      for (const area of areas(level)) {
        const room = largestClearSquare(area, blockers);
        if (room < 60) cramped.push(`${label(level)}: ${area.id} biggest clear square ${room}`);
      }
    }
    expect(cramped).toEqual([]);
  });

  it("never puts two areas on top of each other", () => {
    // Overlapping zones pay the higher multiplier and read as one shape, so the
    // lower one is invisible and free: the player is told a lie about the board.
    const clashes: string[] = [];
    for (const level of LEVELS) {
      const list = areas(level);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (overlaps(list[i], list[j])) clashes.push(`${label(level)}: ${list[i].id} / ${list[j].id}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps every area fully on the board", () => {
    // A clipped area is a pocket that pays only where it happens to be drawn.
    const off: string[] = [];
    for (const level of LEVELS) {
      for (const a of areas(level)) {
        if (a.x0 < 0 || a.y0 < 0 || a.x1 > BOARD_WIDTH || a.y1 > BOARD_HEIGHT) {
          off.push(`${label(level)}: ${a.id}`);
        }
      }
    }
    expect(off).toEqual([]);
  });
});

/**
 * The detectors themselves.
 *
 * Both checks above pass on the shipped ladder, which is what you want and also
 * exactly how a broken detector looks. A thin spine crossing a large area does
 * NOT ruin it - correctly - so the shipped content cannot demonstrate the
 * failing case, and these do it with geometry made for the purpose.
 */
describe("the placement checks can actually fail", () => {
  const area: Box = { x0: 0, y0: 0, x1: 200, y1: 200, id: "probe" };

  it("reports an empty area as fully open, with all of it usable", () => {
    expect(freeFraction(area, [])).toBe(1);
    expect(largestClearSquare(area, [])).toBeGreaterThanOrEqual(195);
  });

  it("catches an area buried under a wall", () => {
    const wall: Box = { x0: -10, y0: -10, x1: 210, y1: 210, id: "slab" };
    expect(freeFraction(area, [wall])).toBe(0);
    expect(largestClearSquare(area, [wall])).toBe(0);
  });

  it("catches an area that is mostly wall", () => {
    const wall: Box = { x0: 0, y0: 0, x1: 200, y1: 150, id: "slab" };
    expect(freeFraction(area, [wall])).toBeLessThan(0.6);
  });

  it("catches an area whose free space is only thin strips", () => {
    // 40% open, but in 20-unit lanes: no pocket, so the multiplier is
    // unreachable even though plenty of the box is technically clear.
    const bars: Box[] = [];
    for (let y = 0; y < 200; y += 40) bars.push({ x0: 0, y0: y, x1: 200, y1: y + 25, id: `bar${y}` });
    expect(largestClearSquare(area, bars)).toBeLessThan(60);
  });

  it("passes a thin spine through a large area, which is not a fault", () => {
    // The shipped case this must NOT flag: level 21's spine, level 33's nook
    // shelf. A rule that called these broken would be worse than no rule.
    const spine: Box = { x0: 90, y0: 0, x1: 116, y1: 200, id: "spine" };
    expect(freeFraction(area, [spine])).toBeGreaterThan(0.6);
    expect(largestClearSquare(area, [spine])).toBeGreaterThanOrEqual(60);
  });
});

describe("every breakable can be reached and hit", () => {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const breakables = (level: any) =>
    (level.entities ?? []).filter((e: any) => e.breakable);  // eslint-disable-line @typescript-eslint/no-explicit-any

  it("never buries one inside another solid", () => {
    const clashes: string[] = [];
    for (const level of LEVELS) {
      for (const b of breakables(level)) {
        // Deformed, like the solids it is compared against. Measuring one side
        // of the comparison after its bend and the other before it is worse
        // than measuring neither.
        const bounds = entityOutlineBounds(b);
        if (!bounds) continue;
        const box: Box = { ...bounds, id: b.id };
        for (const solid of solids(level)) {
          if (solid.id === b.id) continue;
          // A breakable stacked flush ON another solid is a deliberate pattern
          // (level 11's chest and its cover), so only real interpenetration is
          // a fault: boxes that merely share an edge do not overlap here.
          if (overlaps(box, solid) && solid.id !== b.id) {
            const bury = Math.min(box.x1, solid.x1) - Math.max(box.x0, solid.x0) > 8
              && Math.min(box.y1, solid.y1) - Math.max(box.y0, solid.y0) > 8;
            if (bury) clashes.push(`${label(level)}: ${b.id} inside ${solid.id}`);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("gives every breakable a hit count", () => {
    // Without one it either shatters on the first touch or never breaks,
    // depending on the default, and both read as a bug.
    const missing: string[] = [];
    for (const level of LEVELS) {
      for (const b of breakables(level)) {
        if (!Number.isFinite(b.hitsToBreak) || b.hitsToBreak < 1) missing.push(`${label(level)}: ${b.id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the ladder actually carries these hooks", () => {
  const withArea = LEVELS.filter(l => (l.coloredAreas?.length ?? 0) > 0);
   
  const withBreak = LEVELS.filter(l => ((l as any).entities ?? []).some((e: any) => e.breakable));  // eslint-disable-line @typescript-eslint/no-explicit-any

  it("puts a colored area or a breakable on most maps", () => {
    // Reported as "there need to be more breakable items and coloured areas".
    // Before this, 18 of 40 map entries had neither and the two mechanics were
    // rare enough that a player could finish an act without meeting either.
    const ids = new Set([...withArea, ...withBreak].map(l => l.id));
    expect(ids.size).toBeGreaterThanOrEqual(27);
  });

  it("keeps a win GATE out of the tutorial band, and allows a bonus", () => {
    // Was "leaves the first four levels clean". The designer put a bonus var
    // zone on level 3, deliberately and repeatedly, so the convention has been
    // narrowed rather than enforced against them: what must stay out of levels
    // 1-4 is a REQUIRED area, because a win the player cannot yet read is the
    // thing that actually hurts in the teaching band. An optional pocket to
    // aim at is just a target.
    for (const l of LEVELS.filter(l => l.level <= 4)) {
      const gates = (l.coloredAreas ?? []).filter(a => a.required !== false);
      expect(gates, `${l.id} (level ${l.level}) gates the tutorial band`).toHaveLength(0);
    }
  });

  it("keeps every added area a BONUS, never a win gate", () => {
    // A GATE area is a win condition: locking the target outside it fails the
    // map and costs a life. Adding those wholesale would silently rewrite what
    // a dozen maps ask for, which is a design change nobody asked for.
    //
    // The gates that legitimately exist are the four boss maps (fence the boss
    // into the pink box) and level 34, whose whole premise is the box. Listing
    // them by name rather than by a rule is the point: a new one appearing here
    // should be a decision someone made, not something an edit did quietly.
    const GATE_MAPS = ["level-10", "level-20", "level-30", "level-34", "level-35"];
    const gates = LEVELS
      .filter(l => (l.coloredAreas ?? []).some(a => a.required !== false))
      .map(l => l.id);
    expect(gates.sort()).toEqual(GATE_MAPS);
  });
});

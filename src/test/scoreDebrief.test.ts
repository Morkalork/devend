/**
 * The end-of-map debrief (lib/scoreDebrief.ts, ui/game/ScoreDebrief.tsx):
 * "The line that runs over the board after a finished map can be removed as
 * well. What would be nice is some command and conqueresque highlight overlay
 * rectangles over things that generated score with some little text of what
 * gave score and why."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { CanvasGameState } from "@/types/gameState";
import type { DebriefItem } from "@/types/debrief";
import { DEBRIEF_COLORS, buildScoreDebrief, debriefDurationMs, type DebriefSummary } from "@/lib/scoreDebrief";
import {
  MIN_BOX, TAG_H, hoursText, itemFrame, notesRect, overlayAlpha, placeDebrief, tagWidth, typedText, worldToCss,
} from "@/ui/game/scoreDebriefModel";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";

const read = (p: string) => readFileSync(p, "utf8");

const summary = (over: Partial<DebriefSummary> = {}): DebriefSummary => ({
  underParBonus: 0, fencesUsed: 5, par: 5, spaceBonus: 0, remainingPercent: 20, thresholdPercent: 15,
  shipEarlyBonus: 0, winBonus: 0, objectiveBonus: 0, hazardPay: 0, pushBonus: 0, ...over,
});

const square = (x: number, y: number, s: number) =>
  [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

function game(over: Record<string, unknown> = {}): CanvasGameState {
  return {
    lockPayouts: {}, assimilations: new Map(), balls: [], destructibles: [], walls: [],
    spaceGrid: null, gridRegions: [], ...over,
  } as unknown as CanvasGameState;
}

const flash = (ballId: string, x: number, y: number, s: number, zoneColor?: string) =>
  [ballId, { ballId, contours: [square(x, y, s)], ballPos: { x: x + s / 2, y: y + s / 2 }, zoneColor }] as const;

describe("what gets boxed", () => {
  it("boxes each lock round its pocket, with what it paid", () => {
    const g = game({
      lockPayouts: { a: { hours: 12, superior: false, zone: false, together: 1 } },
      assimilations: new Map([flash("a", 100, 200, 80)]),
    });
    const [item] = buildScoreDebrief(g, summary()).items;
    expect(item.kind).toBe("lock");
    expect(item.hours).toBe(12);
    expect(item.detail.key).toBe("debrief.lockDetail");
    // The pocket, padded a little so the brackets sit outside its outline.
    expect(item.box.x).toBeLessThan(100);
    expect(item.box.x + item.box.w).toBeGreaterThan(180);
    expect(item.color).toBeNull();
  });

  it("says why: superior in gold, a zone in its own colour, a multi-lock by count", () => {
    const g = game({
      lockPayouts: {
        s: { hours: 30, superior: true, zone: false, together: 1 },
        z: { hours: 20, superior: false, zone: true, together: 1 },
        m: { hours: 10, superior: false, zone: false, together: 3 },
      },
      assimilations: new Map([flash("s", 0, 0, 50), flash("z", 100, 0, 50, "#aa55ff"), flash("m", 200, 0, 50)]),
    });
    const items = buildScoreDebrief(g, summary()).items;
    const by = (k: string) => items.find(i => i.title.key === `debrief.${k}`)!;
    expect(by("superior").color).toBe(DEBRIEF_COLORS.superior);
    expect(by("superior").detail.key).toBe("debrief.superiorDetail");
    expect(by("zone").color).toBe("#aa55ff");
    expect(items.find(i => i.hours === 10)!.detail).toEqual({ key: "debrief.multiDetail", values: { n: 3 } });
  });

  it("falls back to the ball when a lock has no pocket outline", () => {
    const g = game({
      lockPayouts: { a: { hours: 5, superior: false, zone: false, together: 1 } },
      balls: [{ id: "a", position: { x: 300, y: 300 }, radius: 10 }],
    });
    const [item] = buildScoreDebrief(g, summary()).items;
    expect(item.box).toEqual({ x: 275, y: 275, w: 50, h: 50 });
  });

  it("boxes what was smashed, and says when it was the objective", () => {
    const g = game({
      destructibles: [
        { destroyed: true, obstaclePolygon: { vertices: square(400, 400, 40) } },
        { destroyed: true, objective: true, mirrorPolygon: { vertices: square(600, 400, 40) } },
        { destroyed: false, obstaclePolygon: { vertices: square(10, 10, 40) } },
      ],
    });
    const items = buildScoreDebrief(g, summary()).items;
    expect(items.map(i => i.detail.key)).toEqual(["debrief.smashDetail", "debrief.smashObjectiveDetail"]);
    expect(items.every(i => i.color === DEBRIEF_COLORS.smash)).toBe(true);
  });

  it("boxes the fences only when they came in under par", () => {
    const walls = [
      { id: "w1", start: { x: 100, y: 100 }, end: { x: 500, y: 100 } },
      { id: "board-top", start: { x: 0, y: 0 }, end: { x: 900, y: 0 } },
    ];
    expect(buildScoreDebrief(game({ walls }), summary()).items).toEqual([]);
    const [item] = buildScoreDebrief(game({ walls }), summary({ underParBonus: 8, fencesUsed: 3, par: 5 })).items;
    expect(item.kind).toBe("fences");
    expect(item.hours).toBe(8);
    expect(item.detail.values).toEqual({ used: 3, par: 5 });
    // The board's own edge is not one of the player's fences.
    expect(item.box.y).toBeGreaterThan(50);
  });

  it("boxes the space left only when the map was won under its target", () => {
    const g = game({
      spaceGrid: { width: 10, originX: 0, originY: 0, cellSize: 10 },
      gridRegions: [{ cellIndices: [11, 12, 21] }],
    });
    expect(buildScoreDebrief(g, summary({ remainingPercent: 20 })).items).toEqual([]);
    const [item] = buildScoreDebrief(g, summary({ remainingPercent: 9.6, spaceBonus: 4 })).items;
    expect(item.box).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(item.detail.values).toEqual({ left: 10, target: 15 });
    expect(item.hours).toBe(4);
  });

  it("ends on the locks, the big money", () => {
    const g = game({
      lockPayouts: { a: { hours: 12, superior: false, zone: false, together: 1 } },
      assimilations: new Map([flash("a", 100, 200, 80)]),
      destructibles: [{ destroyed: true, obstaclePolygon: { vertices: square(400, 400, 40) } }],
    });
    expect(buildScoreDebrief(g, summary()).items.map(i => i.kind)).toEqual(["smash", "lock"]);
  });

  it("lists what paid off the board, and only what paid", () => {
    const d = buildScoreDebrief(game(), summary({ shipEarlyBonus: 9.4, winBonus: 0, pushBonus: 3 }));
    expect(d.notes).toEqual([
      { title: { key: "debrief.shipEarly" }, hours: 9 },
      { title: { key: "debrief.push" }, hours: 3 },
    ]);
  });
});

describe("the small things smashed", () => {
  // "For small destructables, just create one label and then run lines to each
  // of the destructables from the label. That ought to reduce the clutter."
  const brick = (x: number, y: number) =>
    ({ destroyed: true, brittle: true, obstaclePolygon: { vertices: [{ x, y }, { x: x + 60, y }, { x: x + 60, y: y + 22 }, { x, y: y + 22 }] } });

  it("share one tag, with each brick a member of it", () => {
    const g = game({ destructibles: [brick(100, 100), brick(170, 100), brick(240, 100), brick(100, 130)] });
    const items = buildScoreDebrief(g, summary()).items;
    expect(items).toHaveLength(1);
    const [group] = items;
    expect(group.title).toEqual({ key: "debrief.smashGroup", values: { n: 4 } });
    expect(group.members).toHaveLength(4);
    // The box the tag is placed against holds every member.
    for (const m of group.members!) {
      expect(m.x).toBeGreaterThanOrEqual(group.box.x);
      expect(m.x + m.w).toBeLessThanOrEqual(group.box.x + group.box.w + 1e-9);
    }
  });

  it("leave a slab, chest or mirror boxed on its own, and a lone brick too", () => {
    const g = game({ destructibles: [brick(100, 100), { destroyed: true, obstaclePolygon: { vertices: square(400, 400, 80) } }] });
    const items = buildScoreDebrief(g, summary()).items;
    expect(items).toHaveLength(2);
    expect(items.every(i => !i.members)).toBe(true);
  });

  it("get a leader from the tag to every brick, and no tag of their own", () => {
    const canvas = { canvasWidth: 450, canvasHeight: 450, canvasOffsetLeft: 0, canvasOffsetTop: 0 };
    const bounds = { x: 0, y: 0, w: 450, h: 450 };
    const g = game({ destructibles: [brick(300, 300), brick(380, 300), brick(460, 300), brick(300, 340), brick(460, 340)] });
    const items = buildScoreDebrief(g, summary()).items;
    const [p] = placeDebrief(items, canvas, bounds);
    expect(p.members).toHaveLength(5);
    expect(p.leaders).toHaveLength(5);
    for (let k = 0; k < 5; k++) {
      const [a, b] = p.leaders![k];
      const m = p.members![k];
      // Starts on the tag, ends on its brick.
      expect(a.x).toBeGreaterThanOrEqual(p.tag.x - 1e-9);
      expect(a.x).toBeLessThanOrEqual(p.tag.x + p.tag.w + 1e-9);
      expect(b.x).toBeGreaterThanOrEqual(m.x - 1e-9);
      expect(b.x).toBeLessThanOrEqual(m.x + m.w + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(m.y - 1e-9);
      expect(b.y).toBeLessThanOrEqual(m.y + m.h + 1e-9);
    }
    // Drawn small: a brick is not blown up to the minimum box a lone thing gets.
    expect(p.members![0].h).toBeLessThan(MIN_BOX);
  });

  it("take one beat of the debrief, not one per brick", () => {
    const many = game({ destructibles: Array.from({ length: 20 }, (_, i) => brick(50 + (i % 10) * 64, 100 + Math.floor(i / 10) * 30)) });
    const d = buildScoreDebrief(many, summary());
    expect(d.items).toHaveLength(1);
    expect(d.durationMs).toBe(debriefDurationMs(1, 0));
  });

  it("is drawn as brackets on each brick and leaders to the one tag", () => {
    expect(read("src/ui/game/ScoreDebrief.tsx")).toContain("for (const [a, b] of p.leaders) {");
    expect(read("src/ui/dev/gallery/board.tsx")).toContain('id: "ScoreDebrief-bricks"');
  });
});

describe("how long it stays up", () => {
  it("is long enough to read, a beat per box, and never drags", () => {
    expect(debriefDurationMs(0, 0)).toBe(1800);
    expect(debriefDurationMs(4, 1)).toBeGreaterThan(debriefDurationMs(1, 1));
    expect(debriefDurationMs(40, 5)).toBe(3400);
  });

  it("times the shatter after it, on both ways a map ends", () => {
    expect(read("src/lib/physics/applyCut.ts")).toContain("lockDelay + game.debrief.durationMs + LEVEL_CLEAR_HOLD_MS");
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("150 + game.debrief.durationMs + LEVEL_CLEAR_HOLD_MS");
    expect(canvas).toContain("<ScoreDebrief ");
  });
});

describe("the sweep is gone", () => {
  it("is no longer drawn or timed", () => {
    expect(read("src/lib/rendering/sleek/transitions.ts")).not.toContain("SweepTransition");
    expect(read("src/lib/rendering/sleek/SleekRenderer.ts")).not.toMatch(/sweep\s*[:=(]|teardownSweep/i);
    expect(read("src/lib/gameConstants.ts")).not.toContain("LEVEL_CLEAR_SHIMMER_MS");
  });
});

describe("each lock's pay is recorded as it seals", () => {
  it("writes lockPayouts from the same terms as the lock bonus", () => {
    const src = read("src/lib/physics/checkBallWonState.ts");
    expect(src).toContain("const payouts = (game.lockPayouts ??= {});");
    expect(src).toContain("payouts[p.id] = {");
    expect(src).toMatch(/simultaneousMultiplier \* lockValue \* quality/);
  });
});

describe("where the boxes and tags go", () => {
  const canvas = { canvasWidth: 450, canvasHeight: 450, canvasOffsetLeft: 20, canvasOffsetTop: 30 };
  const bounds = { x: 20, y: 30, w: 450, h: 450 };
  const item = (box: DebriefItem["box"]): DebriefItem => ({
    kind: "lock", box, title: { key: "debrief.lock" }, detail: { key: "debrief.lockDetail" }, hours: 1, color: null,
  });
  const within = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= bounds.x && r.y >= bounds.y && r.x + r.w <= bounds.x + bounds.w && r.y + r.h <= bounds.y + bounds.h;

  it("maps the world onto the board, and never draws a box too small to see", () => {
    expect(worldToCss({ x: 100, y: 200, w: 200, h: 100 }, canvas)).toEqual({ x: 70, y: 130, w: 100, h: 50 });
    const tiny = worldToCss({ x: 450, y: 450, w: 0, h: 0 }, canvas);
    expect(tiny.w).toBe(MIN_BOX);
    expect(tiny.x + tiny.w / 2).toBeCloseTo(245);
  });

  it("puts a tag above its box when there is room", () => {
    const [p] = placeDebrief([item({ x: 300, y: 400, w: 100, h: 100 })], canvas, bounds);
    expect(p.tag.y + p.tag.h).toBeLessThanOrEqual(p.box.y);
    expect(p.tag.h).toBe(TAG_H);
  });

  it("flips it below at the top edge, and keeps every tag on the board", () => {
    const [p] = placeDebrief([item({ x: 300, y: 0, w: 100, h: 60 })], canvas, bounds);
    expect(p.tag.y).toBeGreaterThanOrEqual(p.box.y + p.box.h);
    const all = placeDebrief([
      item({ x: 0, y: 0, w: 900, h: 900 }), item({ x: 820, y: 820, w: 80, h: 80 }), item({ x: 0, y: 850, w: 50, h: 50 }),
    ], canvas, bounds);
    for (const q of all) expect(within(q.tag)).toBe(true);
  });

  it("does not stack two tags on each other, nor on the notes", () => {
    const notes = notesRect(bounds, 2)!;
    const placed = placeDebrief([
      item({ x: 300, y: 400, w: 100, h: 100 }), item({ x: 320, y: 420, w: 100, h: 100 }), item({ x: 700, y: 60, w: 100, h: 100 }),
    ], canvas, bounds, notes);
    const rects = [notes, ...placed.map(p => p.tag)];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
  });

  it("keeps a tag off the next small box, so it never hides what is named after it", () => {
    const placed = placeDebrief([item({ x: 300, y: 400, w: 100, h: 100 }), item({ x: 300, y: 300, w: 60, h: 60 })], canvas, bounds);
    const [first, second] = placed;
    const apart = (a: typeof first.tag, b: typeof first.box) =>
      a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(apart(first.tag, second.box)).toBe(true);
  });

  it("runs its leader from the box to the tag", () => {
    const [p] = placeDebrief([item({ x: 300, y: 400, w: 100, h: 100 })], canvas, bounds);
    expect(p.leader[0].y).toBe(p.box.y);
    expect(p.leader[1].y).toBe(p.tag.y + p.tag.h);
  });

  it("sizes the tags to the board", () => {
    expect(tagWidth({ x: 0, y: 0, w: 1000, h: 1000 })).toBe(190);
    expect(tagWidth({ x: 0, y: 0, w: 200, h: 200 })).toBe(120);
    expect(notesRect(bounds, 0)).toBeNull();
  });
});

describe("how each box locks on", () => {
  it("waits its turn, slams in wide and blinks, then types its tag out", () => {
    expect(itemFrame(100, 1, 150, false).alpha).toBe(0);
    const start = itemFrame(0, 0, 150, false);
    expect(start.scale).toBeGreaterThan(1.5);
    expect(start.typed).toBe(0);
    expect(itemFrame(70, 0, 150, false).alpha).toBeLessThan(1);
    const done = itemFrame(2000, 0, 150, false);
    expect(done).toEqual({ alpha: 1, scale: 1, typed: 1 });
  });

  it("just appears with reduced motion", () => {
    expect(itemFrame(1, 0, 150, true)).toEqual({ alpha: 1, scale: 1, typed: 1 });
  });

  it("fades as the board shatters, unless the Playground holds it", () => {
    expect(overlayAlpha(1000, 2000, false)).toBe(1);
    expect(overlayAlpha(2110, 2000, false)).toBeCloseTo(0.5);
    expect(overlayAlpha(9000, 2000, false)).toBe(0);
    expect(overlayAlpha(9000, 2000, true)).toBe(1);
  });

  it("writes hours and types text the way the tag shows them", () => {
    expect(hoursText(11.6)).toBe("+12h");
    expect(hoursText(null)).toBe("");
    expect(typedText("THREAD", 0.5)).toBe("THR");
    expect(typedText("THREAD", 1)).toBe("THREAD");
  });
});

describe("the words", () => {
  const keys = [
    "notes", "lock", "lockDetail", "superior", "superiorDetail", "zone", "zoneDetail", "multiDetail",
    "smash", "smashDetail", "smashObjectiveDetail", "smashGroup", "smashGroupDetail", "fences", "fencesDetail", "space", "spaceDetail",
    "shipEarly", "winBonus", "objective", "hazardPay", "push",
  ];
  it.each([["en", en], ["es", es], ["sv", sv]] as const)("are all in %s, with no em-dash", (_, locale) => {
    const d = (locale as unknown as { debrief: Record<string, string> }).debrief;
    for (const k of keys) {
      expect(d[k], k).toBeTruthy();
      expect(d[k]).not.toContain("—");
    }
  });

  it("covers every key the builder uses", () => {
    const src = read("src/lib/scoreDebrief.ts");
    const used = new Set([...src.matchAll(/"debrief\.(\w+)"/g)].map(m => m[1]));
    for (const kind of ["lock", "superior", "zone"]) { used.add(kind); used.add(`${kind}Detail`); }
    for (const k of used) expect(keys).toContain(k);
  });
});

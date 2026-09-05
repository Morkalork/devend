/**
 * The board keeps pointing at what the win still needs.
 *
 * Reported: "I still didn't notice the pulsating effect that ought to direct me
 * to the object in the win condition." The pulse was there and drawing - the
 * data was right, the layer ran every frame - but it was a one-shot 3.2 second
 * flash at map open, which is the window in which a player is still taking the
 * whole board in. On a phone at arm's length the announcement could finish
 * before the eye arrived, and nothing afterwards pointed at anything.
 *
 * So there are two effects now, answering different questions. The opening
 * pulse says "here is what is on this board", once, louder and for longer. The
 * target marker says "this is the one you still have to deal with", quietly,
 * for as long as that is true.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startupPulse, winTargetPulse, STARTUP_PULSE_SECONDS } from "@/lib/rendering/startupPulse";
import { winHighlightRects } from "@/lib/winHighlight";
import type { CanvasGameState } from "@/types/gameState";
import type { WinSpec } from "@/types/winSpec";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the opening pulse lasts long enough to be caught", () => {
  it("runs for several seconds, not a blink", () => {
    // The specific complaint. Three seconds was measured as missable; this is
    // the number that changed, so it is the number pinned.
    expect(STARTUP_PULSE_SECONDS).toBeGreaterThanOrEqual(5);
  });

  it("is still strongest at the start and still ends", () => {
    // Loud when the player is looking at the whole board, gone before it can
    // turn into scenery. A pulse that never ended would be the other failure.
    expect(startupPulse(0).strength).toBeGreaterThan(startupPulse(STARTUP_PULSE_SECONDS / 2).strength);
    expect(startupPulse(STARTUP_PULSE_SECONDS + 0.1).active).toBe(false);
  });
});

describe("the target marker does not stop", () => {
  it("is still breathing minutes into a map", () => {
    // THE fix. The old effect was four minutes gone by the time a player
    // wondered which object the map wanted.
    const late = winTargetPulse(240);
    expect(late.breathe).toBeGreaterThanOrEqual(0);
    expect(late.breathe).toBeLessThanOrEqual(1);
    // Over one period it must actually vary, or it is a static outline.
    const samples = [0, 0.45, 0.9, 1.35].map(t => winTargetPulse(240 + t).breathe);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
  });

  it("stays inside 0..1 for any input a clock can produce", () => {
    for (const t of [-1, 0, 0.001, 1, 59.9, 1e6]) {
      const b = winTargetPulse(t).breathe;
      expect(b, `t=${t}`).toBeGreaterThanOrEqual(0);
      expect(b, `t=${t}`).toBeLessThanOrEqual(1);
    }
  });

  it("is quieter than the opening pulse", () => {
    // Anything drawn for the length of a map becomes scenery if it shouts, and
    // scenery is invisible in its own way. Read off the layer, because the
    // numbers that matter are the ones it actually strokes with.
    const layer = read("src/lib/rendering/sleek/areaLayer.ts");
    const target = layer.slice(layer.indexOf("private drawWinTargets"), layer.indexOf("private drawStartupPulse"));
    expect(target, "the target ring stopped being drawn").toContain("stroke({");
    // Its peak alpha (0.18 + 0.22 = 0.40) sits well under the opening pulse's.
    expect(target).toContain("0.18 + breathe * 0.22");
  });
});

describe("the marker goes out when the job is done", () => {
  const spec = (require: WinSpec["require"]): WinSpec =>
    ({ require, alsoWinIf: [], authored: true });
  const slab = (destroyed: boolean) => ({
    id: "slab", kind: "breakable" as const, hits: 0, maxHits: 3, lastHitAt: 0, destroyed,
    obstaclePolygon: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
  });

  it("drops a breakable from the set once it is rubble", () => {
    // A marker breathing over something already smashed is worse than none: it
    // is an instruction to do a thing that is done.
    const s = spec([{ kind: "smashed", count: 1 }]);
    expect(winHighlightRects(s, { destructibles: [slab(false)] } as unknown as CanvasGameState))
      .toHaveLength(1);
    expect(winHighlightRects(s, { destructibles: [slab(true)] } as unknown as CanvasGameState))
      .toHaveLength(0);
  });

  it("is recomputed by the loop, not only at map build", () => {
    // Computed once at init would freeze the set at its opening state, so
    // every marker would burn for the whole map however much you did.
    const canvas = read("src/components/game/GameCanvas.tsx");
    const at = canvas.indexOf("checkWinCondition: () =>");
    expect(at, "the per-frame win check is gone").toBeGreaterThan(-1);
    expect(canvas.slice(at, at + 900), "the set is never refreshed during play")
      .toContain("game.winHighlights = winHighlightRects(");
  });
});

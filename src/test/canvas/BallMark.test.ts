/**
 * The canvas codex draws the same marks the board does (ballMarkCodex.test.tsx),
 * checked against the drawing the component turns into Pixi strokes.
 */
import { describe, it, expect } from "vitest";
import { BALL_MARKS, markColor } from "@/lib/rendering/sleek/ballMark";
import { ballMarkDrawing } from "@/ui/game/ballMarkModel";

describe("a ball's mark in the canvas codex", () => {
  it("draws one shape per stroke, for every ability the game has", () => {
    for (const [ability, strokes] of Object.entries(BALL_MARKS)) {
      expect(ballMarkDrawing(ability, "#ff5b5b", 48)!.shapes.length, `${ability} drew the wrong number of shapes`)
        .toBe(strokes.length);
    }
  });

  it("draws nothing at all for a ball that just rolls, or an unknown ability", () => {
    expect(ballMarkDrawing("none", "#ff5b5b", 48)).toBeNull();
    expect(ballMarkDrawing("notAThing", "#ff5b5b", 48)).toBeNull();
    expect(ballMarkDrawing(undefined, "#ff5b5b", 48)).toBeNull();
  });

  it("inks the mark the same way the board does", () => {
    expect(ballMarkDrawing("tappable", "#ffffff", 48)!.ink).toBe(markColor("#ffffff"));
    expect(ballMarkDrawing("tappable", "#101010", 48)!.ink).toBe(markColor("#101010"));
  });

  it("closes a closed shape rather than leaving it open", () => {
    const shape = ballMarkDrawing("moneyBall", "#00c853", 48)!.shapes[0];
    expect(shape.kind).toBe("line");
    if (shape.kind !== "line") return;
    const p = shape.points;
    expect([p[0], p[1]]).toEqual([p[p.length - 2], p[p.length - 1]]);
  });

  it("keeps the stroke proportional to the swatch, with a floor for tiny ones", () => {
    const rel = (size: number) => ballMarkDrawing("turnTimer", "#c08cff", size)!.width / size;
    expect(rel(24)).toBeCloseTo(rel(96), 6);
    expect(rel(96)).toBeGreaterThan(0);
    // Below markWidth's pixel floor a tiny swatch gets a relatively fatter
    // stroke: a sub-pixel line is not a faint mark, it is nothing.
    expect(rel(12)).toBeGreaterThan(rel(96));
  });

  it("maps the unit ball onto the swatch", () => {
    // The centre dot of `tappable` sits in the middle of the swatch.
    const dot = ballMarkDrawing("tappable", "#ffffff", 40)!.shapes[0];
    expect(dot).toMatchObject({ kind: "dot", cx: 20, cy: 20 });
  });
});

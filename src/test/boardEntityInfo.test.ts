/**
 * Hit-testing for press-and-hold explainers.
 *
 * The whole value is answering "what is my finger on", so ORDER is the thing
 * worth pinning: a pickup lying on an obstacle inside a marked zone must resolve
 * to the pickup, because that is what the player is pointing at. Get the order
 * wrong and holding a chest explains the zone it happens to sit in.
 */
import { describe, it, expect } from "vitest";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import { createRectPolygon } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";

const rect = (x: number, y: number, w: number, h: number) =>
  createRectPolygon(x, y, x + w, y + h);

/** Only the fields boardEntityAt reads; everything else is irrelevant here. */
function game(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    balls: [], pickups: [], chestLoot: [], destructibles: [],
    obstaclePolygons: [], mirrorPolygons: [], phasingObjects: [], movers: [],
    coloredAreas: [], circuit: null,
    ...over,
  } as unknown as CanvasGameState;
}

describe("board entity hit-testing", () => {
  it("finds nothing on empty board space", () => {
    expect(boardEntityAt(game(), 400, 400)).toBeNull();
  });

  it("identifies a plain obstacle", () => {
    const g = game({ obstaclePolygons: [rect(300, 300, 200, 200)] });
    expect(boardEntityAt(g, 400, 400)?.kind).toBe("obstacle");
  });

  it("tells a dormant ball from a live one, which is the common question", () => {
    const g = game({
      balls: [
        { id: "a", state: "dormant", position: { x: 200, y: 200 }, radius: 18, typeId: "blue" },
        { id: "b", state: "active", position: { x: 600, y: 600 }, radius: 18, typeId: "red" },
      ] as never,
    });
    expect(boardEntityAt(g, 200, 200)?.kind).toBe("dormantBall");
    expect(boardEntityAt(g, 600, 600)?.kind).toBe("ball");
  });

  it("distinguishes chest, objective and plain breakable", () => {
    const g = game({
      destructibles: [
        { kind: "breakable", chest: true, obstaclePolygon: rect(100, 100, 60, 60) },
        { kind: "breakable", objective: true, obstaclePolygon: rect(300, 100, 60, 60) },
        { kind: "breakable", obstaclePolygon: rect(500, 100, 60, 60) },
        { kind: "mirror", mirrorPolygon: rect(700, 100, 60, 60) },
      ] as never,
    });
    expect(boardEntityAt(g, 130, 130)?.kind).toBe("chest");
    expect(boardEntityAt(g, 330, 130)?.kind).toBe("objective");
    expect(boardEntityAt(g, 530, 130)?.kind).toBe("breakable");
    expect(boardEntityAt(g, 730, 130)?.kind).toBe("mirror");
  });

  it("skips a destroyed breakable and reports what is underneath", () => {
    const g = game({
      destructibles: [{ kind: "breakable", destroyed: true, obstaclePolygon: rect(300, 300, 200, 200) }] as never,
      coloredAreas: [{ kind: "var", x: 250, y: 250, width: 300, height: 300 }] as never,
    });
    expect(boardEntityAt(g, 400, 400)?.kind).toBe("area");
  });

  // The ordering cases: each of these sits on top of something larger.
  it("resolves a pickup lying on an obstacle inside a zone", () => {
    const g = game({
      pickups: [{ position: { x: 400, y: 400 }, effect: "fork" }] as never,
      obstaclePolygons: [rect(300, 300, 200, 200)],
      coloredAreas: [{ kind: "let", x: 200, y: 200, width: 400, height: 400 }] as never,
    });
    expect(boardEntityAt(g, 400, 400)?.kind).toBe("pickup");
  });

  it("resolves a ball standing inside a marked zone as the ball", () => {
    const g = game({
      balls: [{ id: "a", state: "active", position: { x: 400, y: 400 }, radius: 18, typeId: "red" }] as never,
      coloredAreas: [{ kind: "const", x: 200, y: 200, width: 400, height: 400 }] as never,
    });
    expect(boardEntityAt(g, 400, 400)?.kind).toBe("ball");
  });

  it("falls through to the zone when nothing is standing in it", () => {
    const g = game({
      coloredAreas: [{ kind: "const", x: 200, y: 200, width: 400, height: 400 }] as never,
    });
    expect(boardEntityAt(g, 400, 400)).toMatchObject({ kind: "area", detail: "const" });
  });

  it("hits a terminal from slightly off-centre, since fingers are not precise", () => {
    const g = game({ circuit: { terminals: [{ x: 400, y: 400 }] } as never });
    expect(boardEntityAt(g, 412, 408)?.kind).toBe("terminal");
    expect(boardEntityAt(g, 500, 500)).toBeNull();
  });

  it("ignores a locked ball: it is gone, and the pocket is the story", () => {
    const g = game({
      balls: [{ id: "a", state: "won", position: { x: 400, y: 400 }, radius: 18, typeId: "red" }] as never,
    });
    expect(boardEntityAt(g, 400, 400)).toBeNull();
  });
});

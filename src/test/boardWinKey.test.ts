/**
 * The per-frame win check runs the real evaluation only when the board
 * changed (lib/boardWinKey.ts, GameCanvas checkWinCondition).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boardWinKey } from "@/lib/boardWinKey";
import type { CanvasGameState } from "@/types/gameState";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function board(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: { activeCount: 1000 },
    walls: [{}, {}],
    wallCount: 1,
    balls: [{ state: "active", regionId: "r1", radius: 18, position: { x: 10, y: 10 } }],
    destructibles: [{ destroyed: false }],
    coloredAreas: [{ satisfied: false }],
    deliveryBoxes: [],
    lockedBallsCount: 0,
    ...over,
  } as unknown as CanvasGameState;
}

describe("the board's win key", () => {
  it("is stable while only positions move", () => {
    const a = board();
    const k1 = boardWinKey(a);
    a.balls[0].position.x = 400;
    expect(boardWinKey(a)).toBe(k1);
  });

  it("changes on everything a clause can read", () => {
    const k = boardWinKey(board());
    expect(boardWinKey(board({ spaceGrid: { activeCount: 900 } as never }))).not.toBe(k);
    expect(boardWinKey(board({ walls: [{}, {}, {}] as never }))).not.toBe(k);
    expect(boardWinKey(board({ balls: [{ state: "won", regionId: "r1", radius: 18, position: { x: 0, y: 0 } }] as never }))).not.toBe(k);
    expect(boardWinKey(board({ balls: [{ state: "active", regionId: "r2", radius: 18, position: { x: 0, y: 0 } }] as never }))).not.toBe(k);
    expect(boardWinKey(board({ destructibles: [{ destroyed: true }] as never }))).not.toBe(k);
    expect(boardWinKey(board({ coloredAreas: [{ satisfied: true }] as never }))).not.toBe(k);
    expect(boardWinKey(board({ lockedBallsCount: 1 }))).not.toBe(k);
  });

  it("gates the per-frame check, with the clock still checked every frame", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    const at = canvas.indexOf("checkWinCondition: () =>");
    const body = canvas.slice(at, at + 1800);
    expect(body).toContain("const key = boardWinKey(game);");
    expect(body).toContain("if (key === winKeyRef.current && !outOfTime) return null;");
  });
});

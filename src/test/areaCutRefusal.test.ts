/**
 * A fence that would seal the win's zone with no ball in it is refused.
 *
 * The zone sibling of smashCutRefusal. Sealing the box empty used to cost a
 * life on the spot (applyCut's areaUnreachable), while the same mistake against
 * a slab the win needed was refused as a cut with a line of text. Level 3 now
 * asks for a ball in its pink box, which made the harsher answer land on the
 * map that introduces the box.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBotGame, stepBot, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { cutWouldBuryArea } from "@/lib/physics/areaReach";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import { LADDER, byLevel } from "./fixtures/maps";
import type { CanvasGameState } from "@/types/gameState";

afterEach(() => releaseClock());

const L3 = byLevel(LADDER, 3)!;

// Level 3 never rotates, so the box is where map.yml draws it: x 630-855,
// y 45-270, with its floor (the nook lip) at y 270. One vertical fence down
// its open side closes it.
const SEAL_THE_BOX = [{ start: { x: 632, y: 45 }, end: { x: 632, y: 282 } }];
const ELSEWHERE = [{ start: { x: 200, y: 45 }, end: { x: 200, y: 300 } }];

function board(balls: Array<{ x: number; y: number }>): CanvasGameState {
  releaseClock();
  setRunSeedText("area-refusal");
  installClock();
  const ctx = createBotGame(L3, 3);
  for (let i = 0; i < 10; i++) stepBot(ctx);
  const game = ctx.game as unknown as CanvasGameState;
  game.balls.forEach((b, i) => {
    b.position = { ...balls[i] };
    b.prevPosition = { ...balls[i] };
  });
  return game;
}

const refused = (game: CanvasGameState, segs: typeof SEAL_THE_BOX) =>
  cutWouldBuryArea(game, resolveWinSpec(L3, NO_RUN_RULES), readWinSnapshot(game, L3), segs, 8);

describe("sealing the win's zone", () => {
  it("asks for the box on level 3, so this is testing the real map", () => {
    expect(resolveWinSpec(L3, NO_RUN_RULES).require.map(c => c.kind)).toContain("area");
  });

  it("refuses the fence when no ball is inside", () => {
    expect(refused(board([{ x: 200, y: 450 }, { x: 300, y: 700 }]), SEAL_THE_BOX)).toBe(true);
  });

  it("lets it land with a ball inside, because that is the lock the map wants", () => {
    expect(refused(board([{ x: 740, y: 150 }, { x: 300, y: 700 }]), SEAL_THE_BOX)).toBe(false);
  });

  it("says nothing about a fence that leaves the box open", () => {
    expect(refused(board([{ x: 400, y: 450 }, { x: 300, y: 700 }]), ELSEWHERE)).toBe(false);
  });

  it("is wired into applyCut with a message of its own, in every locale", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
    expect(src).toContain('onGameMessage?.("cutWouldBuryArea")');
    for (const loc of ["en", "es", "sv"]) {
      const json = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${loc}.json`), "utf8"));
      expect(JSON.stringify(json), loc).toContain('"cutWouldBuryArea"');
    }
  });
});

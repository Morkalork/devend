/**
 * A smashed chest's reward is the player's immediately.
 *
 * It used to require a second action: the chest dropped a gem and the player
 * had two seconds to TAP it, or the reward was lost. That made an earned thing
 * conditional on a reflex unrelated to earning it. Steering a ball into a chest
 * is the skill; the board does not pause afterwards, so the collect window fell
 * exactly when the player had the least attention to spare, and the punishment
 * for being busy was losing the thing they had just won.
 *
 * The gem still drops. It is now a receipt, showing what came out of the chest,
 * and nothing is riding on it.
 */
import { describe, it, expect, vi } from "vitest";
import { processDestroysFn } from "@/lib/physics/destructibles";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";
import { getAbility } from "@/lib/abilities";
import { setRunSeedText } from "@/lib/runRng";

const BOX = (x: number, y: number) => ({
  vertices: [
    { x, y }, { x: x + 60, y }, { x: x + 60, y: y + 60 }, { x, y: y + 60 },
  ],
});

function chest(id: string, opts: Partial<DestructibleState> = {}): DestructibleState {
  return {
    id,
    kind: "breakable",
    hits: 3,
    maxHits: 3,
    destroyed: true,
    chest: true,
    obstaclePolygon: BOX(300, 300),
    ...opts,
  } as unknown as DestructibleState;
}

function gameWith(...pending: DestructibleState[]): CanvasGameState {
  return {
    destructibles: [...pending],
    pendingDestroys: [...pending],
    stackObjects: [],
    mirrorPolygons: [],
    obstaclePolygons: [],
    objectDebris: [],
    movers: [],
    balls: [],
    walls: [],
    regions: [],
    chestLoot: [],
    breakBonus: 0,
    breakMultiplier: 1,
    objectivesBroken: 0,
    activePlaySeconds: 4,
    spaceGrid: null,
  } as unknown as CanvasGameState;
}

const smash = (game: CanvasGameState, onChestReward?: (id: string) => void, level = 12) =>
  processDestroysFn(game, {
    repaintRegionCanvas: () => {},
    setRemainingPercent: () => {},
    onChestReward,
  }, level);

describe("breaking a chest", () => {
  it("hands over the reward there and then, with no tap", () => {
    const game = gameWith(chest("c1"));
    const granted = vi.fn();

    smash(game, granted);

    expect(granted).toHaveBeenCalledTimes(1);
    const rewardId = granted.mock.calls[0][0] as string;
    // A real ability, not a stray id.
    expect(getAbility(rewardId)).toBeTruthy();
  });

  it("still drops the gem, as a receipt for what was won", () => {
    const game = gameWith(chest("c1"));
    const granted = vi.fn();

    smash(game, granted);

    expect(game.chestLoot).toHaveLength(1);
    // The gem shows the SAME reward that was banked, or it is a receipt for
    // something else.
    expect(game.chestLoot![0].reward).toBe(granted.mock.calls[0][0]);
  });

  it("drops the gem where the chest stood", () => {
    const game = gameWith(chest("c1"));
    smash(game);

    const gem = game.chestLoot![0];
    expect(gem.x).toBeCloseTo(330, 5); // centroid of BOX(300,300)
    expect(gem.y).toBeCloseTo(330, 5);
    expect(gem.bornActiveSeconds).toBe(4); // anchored to the active-play clock
  });

  it("pays once per chest, not once per frame it stays broken", () => {
    const game = gameWith(chest("c1"));
    const granted = vi.fn();

    smash(game, granted);
    smash(game, granted); // pendingDestroys is drained; nothing left to pay
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("pays for each chest when several go at once", () => {
    const game = gameWith(
      chest("c1"),
      chest("c2", { obstaclePolygon: BOX(600, 200) }),
    );
    const granted = vi.fn();

    smash(game, granted);
    expect(granted).toHaveBeenCalledTimes(2);
    expect(game.chestLoot).toHaveLength(2);
  });

  it("pays nothing for an ordinary breakable", () => {
    const game = gameWith(chest("box", { chest: false }));
    const granted = vi.fn();

    smash(game, granted);
    expect(granted).not.toHaveBeenCalled();
    expect(game.chestLoot).toHaveLength(0);
  });

  /**
   * In a SEEDED run (Daily, record replay) the roll is keyed on the chest id, so
   * everyone playing that seed gets the same reward out of the same chest. That
   * only became a real guarantee once the grant stopped being conditional:
   * before, two players on one seed could finish with different abilities purely
   * because one of them was mid-cut when the gem landed.
   */
  it("rolls the same reward for the same chest on the same seed", () => {
    const rollFor = (seed: string, id: string) => {
      setRunSeedText(seed);
      const granted = vi.fn();
      smash(gameWith(chest(id)), granted);
      setRunSeedText(null);
      return granted.mock.calls[0][0] as string;
    };

    expect(rollFor("daily:2026-08-15", "c1")).toBe(rollFor("daily:2026-08-15", "c1"));
    // Different chests on one seed roll independently, or every chest on a map
    // would hand out the same ability.
    const a = rollFor("daily:2026-08-15", "c1");
    const differing = ["c2", "c3", "c4", "c5"].map(id => rollFor("daily:2026-08-15", id));
    expect(differing.some(r => r !== a)).toBe(true);
  });

  it("honours a chest's authored reward pool", () => {
    const only = "freezeAll";
    const game = gameWith(chest("c1", { chestRewards: [only] } as Partial<DestructibleState>));
    const granted = vi.fn();

    smash(game, granted);
    expect(granted).toHaveBeenCalledWith(only);
  });

  it("does not fall over when nothing is listening", () => {
    const game = gameWith(chest("c1"));
    expect(() => smash(game, undefined)).not.toThrow();
    expect(game.chestLoot).toHaveLength(1);
  });
});

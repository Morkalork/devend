/**
 * Level 17's portal pipe: a shortcut and a trap, and they are the same object.
 *
 * A portal pair changes what is NEXT TO what without moving a wall, so the two
 * chambers of a budget map are joined without using the neck - a route the
 * player did not have to pay a fence for.
 *
 * And a region holding a live portal CANNOT be locked (portal.test.ts pins the
 * rule against the shipped lock path). A pocket the ball can leave is not a
 * pocket. So the corridor is the cheapest-looking pocket on the board and
 * sealing it pays nothing, which on a map that counts every fence is the most
 * expensive mistake available.
 *
 * Both halves rest on facts that fail silently in opposite directions:
 *
 *   A LONE portal is inert. portalExit returns null for a mouth with no
 *   partner, so a pair that loses one end is a decorative circle - and the
 *   corridor it was supposed to poison becomes an ordinary free lock.
 *
 *   A pair in the SAME chamber is not a shortcut. It still poisons the pocket,
 *   so the trap half keeps working and nothing looks broken, while the thing
 *   the player was being offered in exchange has quietly gone.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {}, vibrateDeath: () => {},
  vibrateBallLock: () => {}, setHapticsEnabled: () => {}, isHapticsEnabled: () => false,
}));

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { portalExit } from "@/lib/physics/portal";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig, LevelData } from "@/types/level";

const level17 = (): LevelConfig => {
  const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
  const l = doc.levels.find(x => x.level === 17);
  if (!l) throw new Error("map.yml has no level 17");
  return l as unknown as LevelConfig;
};

/** The portals as the GAME built them, not as they were authored: a map is
 *  dealt in one of four rotations and authored coordinates move with it. */
function built(seed: string) {
  setRunSeedText(seed);
  const d = createInitialGameData(level17(), 17, DEFAULT_MODIFIERS);
  setRunSeedText(null);
  return { mouths: [...(d.portals?.values() ?? [])], rotation: d.mapRotation, walls: d.walls };
}

describe("the pipe is a corridor with a portal in it", () => {
  it("has both walls and both mouths", () => {
    const ids = (level17().entities ?? []).map(e => e.id);
    for (const id of ["wip-pipe-l", "wip-pipe-r", "warp-near", "warp-far"]) {
      expect(ids, `${id} is gone, and the pipe stops being what it is`).toContain(id);
    }
  });

  it("links the two mouths to each other", () => {
    // A lone portal is inert by design - portalExit returns null rather than
    // eating the ball - so an unpaired link name is a decorative circle and
    // the corridor quietly becomes an ordinary free lock.
    const links = (level17().entities ?? [])
      .map(e => (e as unknown as { portal?: string }).portal)
      .filter(Boolean);
    expect(links).toHaveLength(2);
    expect(links[0], "the two mouths are not on the same link").toBe(links[1]);
  });

  it("puts the far mouth in the OTHER chamber, so it is a shortcut", () => {
    // The divider runs down x=437 as authored. A pair on one side of it still
    // poisons the pocket, so the trap half keeps working and nothing looks
    // broken - while the route the player was being offered has gone.
    const near = (level17().entities ?? []).find(e => e.id === "warp-near") as unknown as { cx: number };
    const far = (level17().entities ?? []).find(e => e.id === "warp-far") as unknown as { cx: number };
    const divider = (level17().entities ?? []).find(e => e.id === "divider-top") as unknown as { x: number };
    expect(near.cx > divider.x, "the near mouth is not in the right-hand chamber").toBe(true);
    expect(far.cx < divider.x, "both mouths sit in the same chamber").toBe(true);
  });
});

describe("the pair works on the board the game actually deals", () => {
  it.each(["deal-a", "deal-b", "deal-c", "deal-d"])("sends a ball out of the far end (%s)", seed => {
    const { mouths } = built(seed);
    expect(mouths, "the map built something other than a pair").toHaveLength(2);
    const [a, b] = mouths;
    expect(portalExit(a, mouths)?.id, "the near mouth leads nowhere").toBe(b.id);
    expect(portalExit(b, mouths)?.id, "the far mouth leads nowhere").toBe(a.id);
  });

  it("keeps the mouths far apart in every deal, so the hop is worth taking", () => {
    // A rotation is an isometry, so this is really one fact checked four times -
    // which is the point: it is the assumption that would break first if the
    // pair were ever moved by hand on one of them.
    for (const seed of ["deal-a", "deal-b", "deal-c", "deal-d"]) {
      const { mouths, rotation } = built(seed);
      const [a, b] = mouths;
      const span = Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y);
      expect(span, `rotation ${rotation}: the mouths are close enough to walk between`)
        .toBeGreaterThan(400);
    }
  });

  it("stands the pipe's walls up as real geometry", () => {
    // The corridor has to exist in the walls the physics reads, not only in
    // map.yml: a pocket with no sides is not a pocket to be tempted by.
    const { walls } = built("deal-a");
    for (const id of ["wip-pipe-l", "wip-pipe-r"]) {
      expect(walls.some(w => w.id.startsWith(`obstacle-${id}-`)), `${id} built no edges`).toBe(true);
    }
  });
});

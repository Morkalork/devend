/**
 * The Full Gravity stinger (ui/game/GravityStinger.tsx): a full-map gravity
 * map opens with the rule shouted over the held board, once the reveal is done.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STINGER_SECONDS, STINGER_SECONDS_STILL, stingerState } from "@/ui/game/gravityStingerModel";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";
import bn from "@/i18n/locales/bn.json";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the stinger's timeline", () => {
  it("slams in, holds, fades, and is done after its length", () => {
    expect(stingerState(0).alpha).toBe(0);
    expect(stingerState(0).scale).toBeGreaterThan(1.3);
    const mid = stingerState(STINGER_SECONDS / 2);
    expect(mid.alpha).toBe(1);
    expect(mid.scale).toBeCloseTo(1, 1);
    expect(mid.done).toBe(false);
    expect(stingerState(STINGER_SECONDS - 0.05).alpha).toBeLessThan(0.5);
    expect(stingerState(STINGER_SECONDS).done).toBe(true);
  });

  it("is shorter and still under reduced motion", () => {
    expect(STINGER_SECONDS_STILL).toBeLessThan(STINGER_SECONDS);
    const s = stingerState(STINGER_SECONDS_STILL / 2, true);
    expect(s.scale).toBe(1);
    expect(stingerState(STINGER_SECONDS_STILL, true).done).toBe(true);
  });
});

describe("on the board", () => {
  const canvas = read("src/components/game/GameCanvas.tsx");

  it("shows only on a full-map gravity mutator, after the reveal", () => {
    expect(canvas).toContain('const fullGravity = mapMutator?.behavior === "gravity";');
    expect(canvas).toContain("if (revealed && fullGravity) setStinger(true);");
  });

  it("holds the map still under it, the way the boot reveal does", () => {
    expect(canvas).toContain("game.bootHold = !revealed || stinger;");
    expect(canvas).toContain("game.paused = paused || !!pendingLaunch || !revealed || stinger;");
  });

  it("is in the gallery and says it in every language", () => {
    expect(read("src/ui/dev/gallery/board.tsx")).toContain('id: "GravityStinger"');
    for (const loc of [en, es, sv, bn] as unknown as Array<{ game: { fullGravityStinger: string } }>) {
      expect(loc.game.fullGravityStinger).toMatch(/!$/);
      expect(loc.game.fullGravityStinger).not.toContain("—");
    }
  });
});

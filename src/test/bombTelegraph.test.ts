/**
 * Two follow-ups to the bombs ("Go, do both"):
 *
 * 1. Slab and chest bombs blast only from act II (game-config.yml
 *    `box_bombs.start_level`, 11). Act I still has the bomb in every box and
 *    the hit on it still finishes the box, but it strikes, carves and throws
 *    nothing, and holding one says so rather than promising a crater.
 * 2. The reach ring: how far a blast goes, on the floor round every armed
 *    bomb a player can see.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { TFunction } from "i18next";
import type { CanvasGameState } from "@/types/gameState";
import { DEFAULT_SHARD_BOMB_CONFIG, bombExposeAt, boxBlastArmed, mapCanHaveBoxBlasts } from "@/lib/bombCore";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import { boardEntityCopy } from "@/ui/game/BoardEntityInfoModalModel";
import { REACH_RING, reachDashes } from "@/lib/rendering/sleek/bombLook";
import { createBotGame } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { LADDER } from "./fixtures/maps";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";

const CFG = DEFAULT_SHARD_BOMB_CONFIG;
const read = (p: string) => readFileSync(p, "utf8");
afterEach(() => setRunSeedText(null));

describe("box blasts wait for act II", () => {
  it("are off before the start level and on from it, and a map overrides both ways", () => {
    expect(boxBlastArmed(CFG, CFG.boxStartLevel - 1, undefined)).toBe(false);
    expect(boxBlastArmed(CFG, CFG.boxStartLevel, undefined)).toBe(true);
    expect(boxBlastArmed(CFG, 7, true)).toBe(true);
    expect(boxBlastArmed(CFG, 15, false)).toBe(false);
  });

  it("start where game-config.yml says, and the code's default agrees", () => {
    const doc = yaml.load(read("public/game-config.yml")) as { box_bombs: { start_level: number } };
    expect(doc.box_bombs.start_level).toBe(CFG.boxStartLevel);
    expect(CFG.boxStartLevel).toBe(11);
  });

  it("leave every act I map quiet", () => {
    const blasting = LADDER.filter(l => mapCanHaveBoxBlasts(l)).map(l => l.level);
    expect(blasting.length).toBeGreaterThan(0);
    expect(blasting.every(n => n >= 11)).toBe(true);
    // Act I has boxes (chest met at 7, slab at 8), so the gate is doing work.
    expect(LADDER.some(l => l.level < 11 && (l.entities ?? []).some(e => e.kind === "wall" && "chest" in e && e.chest))).toBe(true);
  });

  it("are dealt that way, by the browser and the harness alike", () => {
    for (const p of ["src/components/game/GameCanvas.tsx", "src/lib/bot/headlessGame.ts"]) {
      expect(read(p)).toContain("game.boxBombBlast = cfg && boxBlastArmed(cfg, levelNumber, level.boxBombBlast) ? { ...cfg.box } : null;");
    }
    const at = (n: number) => {
      setRunSeedText(`box-blast-${n}`);
      return createBotGame(LADDER.find(l => l.level === n)!, n, undefined, { bombs: CFG }).game;
    };
    expect(at(7).boxBombBlast).toBeNull();
    expect(at(11).boxBombBlast).toEqual(CFG.box);
    // The bomb is still in the act I chest: only the blast waits.
    expect(at(7).destructibles.some(d => d.bomb)).toBe(true);
  });

  it("can be set per map in the Level panel", () => {
    const panel = read("src/components/admin/LevelPanel.tsx");
    expect(panel).toContain("next.boxBombBlast = e.target.value === 'on'");
    expect(panel).toContain("delete next.boxBombBlast");
  });
});

describe("holding a quiet box", () => {
  const poly = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  const game = (armed: boolean) => ({
    balls: [], pickups: [], chestLoot: [], phasingObjects: [], movers: [], mirrorPolygons: [], obstaclePolygons: [],
    boxBombBlast: armed ? CFG.box : null,
    destructibles: [{
      id: "slab", kind: "breakable", hits: 0, maxHits: 3, lastHitAt: 0, destroyed: false,
      bomb: true, bombExposeAt: bombExposeAt(3), obstaclePolygon: poly,
    }],
  }) as unknown as CanvasGameState;

  it("says it goes up without a blast, and only there", () => {
    expect(boardEntityAt(game(false), 50, 50)).toEqual({ kind: "bombBox", detail: "quiet" });
    expect(boardEntityAt(game(true), 50, 50)).toEqual({ kind: "bombBox", detail: undefined });
    const g = game(false);
    g.destructibles[0].chest = true;
    expect(boardEntityAt(g, 50, 50)).toEqual({ kind: "bombChest", detail: "quiet" });
  });

  it("reads the quiet body", () => {
    const t = ((k: string) => k) as unknown as TFunction;
    expect(boardEntityCopy(t, { kind: "bombBox", detail: "quiet" }, "#fff").body).toBe("boardInfo.bombBox.bodyQuiet");
    expect(boardEntityCopy(t, { kind: "bombBox" }, "#fff").body).toBe("boardInfo.bombBox.body");
  });

  it.each([["en", en], ["es", es], ["sv", sv]] as const)("has its copy in %s, the ring in every bomb's, and no em-dash", (_, l) => {
    const info = (l as unknown as { boardInfo: Record<string, { body: string; bodyQuiet?: string }> }).boardInfo;
    for (const k of ["bombBox", "bombChest"]) {
      expect(info[k].bodyQuiet).toBeTruthy();
      expect(info[k].bodyQuiet).not.toContain("—");
    }
    // Every blasting bomb's copy names the ring (the last sentence), and the
    // quiet one does not.
    const ringWord = { en: "ring", es: "anillo", sv: "ring" }[_];
    for (const k of ["bombBox", "bombChest", "bombShard"]) expect(info[k].body).toContain(ringWord);
    expect(info.bombBox.bodyQuiet).not.toContain(ringWord);
  });
});

describe("the reach ring", () => {
  it("is whole dashes, evenly spread, round the full circle", () => {
    const d = reachDashes(150);
    expect(d.length).toBe(Math.round((Math.PI * 2 * 150) / (REACH_RING.dashPx + REACH_RING.gapPx)));
    const step = d[1][0] - d[0][0];
    for (let i = 0; i < d.length; i++) {
      expect(d[i][0]).toBeCloseTo(i * step, 9);
      expect(d[i][1] - d[i][0]).toBeCloseTo(step * REACH_RING.dashPx / (REACH_RING.dashPx + REACH_RING.gapPx), 9);
    }
    expect(d.at(-1)![1]).toBeLessThan(Math.PI * 2);
    expect(reachDashes(2).length).toBe(8);
  });

  it("is a steady, faint mark, not a blink", () => {
    expect(REACH_RING.strokeAlpha).toBeLessThanOrEqual(0.6);
    expect(REACH_RING.fillAlpha).toBeLessThan(0.1);
  });

  it("is drawn under the bricks, round a shard bomb always and a box bomb once exposed, at the armed radius", () => {
    const src = read("src/lib/rendering/sleek/objectLayer.ts");
    // The reach rings stay under the bricks in both the kept and the live drawing.
    expect(src).toContain("this.container.addChild(this.keptReach, this.reach, this.keptBodies, this.bodies, this.keptRims, this.rims);");
    expect(src).toContain("const reach = alwaysShown ? this.shardReach : d.bombExposed ? this.boxReach : null;");
    expect(src).toContain("this.shardReach = game.shardBombBlast?.radius ?? null;");
    expect(src).toContain("this.boxReach = game.boxBombBlast?.radius ?? null;");
    expect(src).toContain("this.drawReach(cx, cy, reach * scale, scale);");
  });
});

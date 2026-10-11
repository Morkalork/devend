/**
 * No Pixi app in the game may release the process-wide pools on teardown.
 *
 * Reported as "it crashes after finishing the first map. No map statistics
 * page, just a black background". The board renderer was destroyed with
 * `app.destroy(true, ...)`; in Pixi 8 a bare `true` also means
 * releaseGlobalResources, which clears TexturePool and the other registered
 * pools for EVERY renderer on the page. The interface is a second Pixi app on
 * its own canvas (src/ui), and its text still held pooled textures: its next GC
 * pass returned one to the wiped pool ("Cannot read properties of undefined
 * (reading 'push')" in TexturePool.returnTexture) and the interface stopped
 * drawing, exactly as the board came down for the results screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { GlobalResourceRegistry, TexturePool } from "pixi.js";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("Pixi's global pools survive a renderer's teardown", () => {
  it("is what the bug was: the shared texture pool is one of the pools a release clears", () => {
    // Pins the Pixi behaviour the fix depends on, so an upgrade that changes
    // it shows up here rather than as a black screen.
    expect(GlobalResourceRegistry.isRegistered(TexturePool)).toBe(true);
  });

  it("no app or renderer in the game is destroyed with a bare true", () => {
    const offenders: string[] = [];
    for (const file of [...sources(resolve(process.cwd(), "src/lib")), ...sources(resolve(process.cwd(), "src/ui")), ...sources(resolve(process.cwd(), "src/components"))]) {
      const src = readFileSync(file, "utf8");
      // An Application or renderer teardown: `app.destroy(true` / `renderer.destroy(true`.
      for (const m of src.matchAll(/\b(app|application|renderer|pixiApp)\??\.destroy\(\s*true\b/gi)) {
        offenders.push(`${file}: ${m[0]}`);
      }
      if (/releaseGlobalResources:\s*true/.test(src)) {
        offenders.push(`${file}: releaseGlobalResources: true`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the board renderer keeps the pools when it goes", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/rendering/sleek/SleekRenderer.ts"), "utf8");
    expect(src).toContain("this.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });");
  });
});

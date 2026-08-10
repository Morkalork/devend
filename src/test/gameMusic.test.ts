import { describe, it, expect, vi } from "vitest";
import { musicFileForLevel } from "@/lib/gameMusic";

/** The 5-level band mapping that drives track selection. */
describe("musicFileForLevel", () => {
  it("maps each level to its 5-level band track", () => {
    expect(musicFileForLevel(1)).toBe("/assets/music/maps_1-5.mp3");
    expect(musicFileForLevel(5)).toBe("/assets/music/maps_1-5.mp3");
    expect(musicFileForLevel(6)).toBe("/assets/music/maps_6-10.mp3");
    expect(musicFileForLevel(10)).toBe("/assets/music/maps_6-10.mp3");
    expect(musicFileForLevel(11)).toBe("/assets/music/maps_11-15.mp3");
    expect(musicFileForLevel(37)).toBe("/assets/music/maps_36-40.mp3");
  });

  it("clamps non-positive / invalid levels to the first band", () => {
    expect(musicFileForLevel(0)).toBe("/assets/music/maps_1-5.mp3");
    expect(musicFileForLevel(-3)).toBe("/assets/music/maps_1-5.mp3");
    expect(musicFileForLevel(NaN)).toBe("/assets/music/maps_1-5.mp3");
  });

  it("keeps a whole band on one track (boundaries only at multiples of 5)", () => {
    for (let lvl = 1; lvl <= 5; lvl++) {
      expect(musicFileForLevel(lvl)).toBe("/assets/music/maps_1-5.mp3");
    }
    for (let lvl = 6; lvl <= 10; lvl++) {
      expect(musicFileForLevel(lvl)).toBe("/assets/music/maps_6-10.mp3");
    }
  });
});

/**
 * Mobile unlocks media PER ELEMENT, and the crossfade deck has two. Whatever
 * runs inside the first user gesture must touch both, or the first band switch
 * (level start) lands on a never-unlocked element and plays nothing while the
 * menu track keeps going: "no music once the game starts, only the main menu".
 *
 * Desktop never shows this, so it needs a test rather than a play-through.
 */
describe("first-gesture unlock covers BOTH deck elements", () => {
  it("startMenuMusic plays the foreground element and primes the partner", async () => {
    const played: string[] = [];
    class FakeAudio {
      src = ""; volume = 0; muted = false; currentTime = 0; preload = "";
      dataset: Record<string, string> = {};
      addEventListener() {} removeEventListener() {} pause() {}
      play() { played.push(this.src); return Promise.resolve(); }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    vi.resetModules();
    const music = await import("@/lib/gameMusic");
    music.startMenuMusic();
    await Promise.resolve();

    // One element gets the real menu loop; the other gets silence, which is what
    // unlocks it. Priming with the audible track instead would cut off the first.
    expect(played.some(s => s.includes("main.mp3")), `played: ${played}`).toBe(true);
    expect(played.some(s => s.startsWith("data:audio")), `played: ${played}`).toBe(true);

    vi.unstubAllGlobals();
  });
});

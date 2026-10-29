import { describe, it, expect, vi } from "vitest";
import { musicFileForLevel } from "@/lib/gameMusic";

/** The 5-level band mapping that drives track selection. */
describe("musicFileForLevel", () => {
  it("maps each level to its 5-level band track", () => {
    expect(musicFileForLevel(1)).toBe("/assets/music/maps_1-5.ogg");
    expect(musicFileForLevel(5)).toBe("/assets/music/maps_1-5.ogg");
    expect(musicFileForLevel(6)).toBe("/assets/music/maps_6-10.ogg");
    expect(musicFileForLevel(10)).toBe("/assets/music/maps_6-10.ogg");
    expect(musicFileForLevel(11)).toBe("/assets/music/maps_11-15.ogg");
    expect(musicFileForLevel(37)).toBe("/assets/music/maps_36-40.ogg");
    expect(musicFileForLevel(44)).toBe("/assets/music/maps_41-45.ogg"); // the name; the catalogue picks .mp3
  });

  it("clamps non-positive / invalid levels to the first band", () => {
    expect(musicFileForLevel(0)).toBe("/assets/music/maps_1-5.ogg");
    expect(musicFileForLevel(-3)).toBe("/assets/music/maps_1-5.ogg");
    expect(musicFileForLevel(NaN)).toBe("/assets/music/maps_1-5.ogg");
  });

  it("keeps a whole band on one track (boundaries only at multiples of 5)", () => {
    for (let lvl = 1; lvl <= 5; lvl++) {
      expect(musicFileForLevel(lvl)).toBe("/assets/music/maps_1-5.ogg");
    }
    for (let lvl = 6; lvl <= 10; lvl++) {
      expect(musicFileForLevel(lvl)).toBe("/assets/music/maps_6-10.ogg");
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
    expect(played.some(s => s.includes("main.ogg")), `played: ${played}`).toBe(true);
    expect(played.some(s => s.startsWith("data:audio")), `played: ${played}`).toBe(true);

    vi.unstubAllGlobals();
  });
});

/**
 * A band may ship as .ogg or .mp3 (the owner's 41-45 track came in as MP3).
 * Once music.yml has loaded, its row names the file; before that both are tried.
 */
describe("band tracks play as .ogg or .mp3", () => {
  it("follows the catalogue's file once it has loaded, and plays main for a band with no row", async () => {
    vi.resetModules();
    const cat = await import("@/lib/musicCatalogue");
    const music = await import("@/lib/gameMusic");
    // Before the catalogue: the band name as .ogg, then as .mp3.
    expect(music.musicSourcesForLevel(42)).toEqual(["/assets/music/maps_41-45.ogg", "/assets/music/maps_41-45.mp3"]);

    const { readFileSync } = await import("node:fs");
    const yaml = (await import("js-yaml")).default;
    const doc = yaml.load(readFileSync("public/music.yml", "utf8")) as Record<string, unknown>;
    vi.spyOn(cat, "getMusicCatalogue").mockReturnValue(cat.parseMusicDoc(doc));
    expect(music.musicSourcesForLevel(42)).toEqual(["/assets/music/maps_41-45.mp3"]);
    expect(music.musicSourcesForLevel(3)).toEqual(["/assets/music/maps_1-5.ogg"]);
    expect(music.musicSourcesForLevel(37)).toEqual([]); // no track yet: straight to main
    vi.restoreAllMocks();
  });

  it("walks .ogg -> .mp3 -> main.ogg on load errors", async () => {
    const tried: string[] = [];
    const elements: FakeAudio[] = [];
    class FakeAudio {
      _src = ""; volume = 0; muted = false; currentTime = 0; preload = ""; loop = false; paused = true;
      duration = NaN;
      dataset: Record<string, string> = {};
      onerror: (() => void) | null = null;
      constructor() { elements.push(this); }
      get src() { return this._src; }
      set src(v: string) {
        this._src = v;
        if (v.startsWith("data:")) return;
        tried.push(v);
        // Only the 41-45 .mp3 and main.ogg exist.
        if (!v.endsWith("41-45.mp3") && !v.endsWith("main.ogg")) queueMicrotask(() => this.onerror?.());
      }
      addEventListener() {} removeEventListener() {} pause() { this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.resetModules();
    const music = await import("@/lib/gameMusic");
    music.playMusicForLevel(42);
    await new Promise(r => setTimeout(r, 0));
    expect(tried).toEqual(["/assets/music/maps_41-45.ogg", "/assets/music/maps_41-45.mp3"]);

    tried.length = 0;
    music.playMusicForLevel(37); // a band with neither file
    await new Promise(r => setTimeout(r, 0));
    expect(tried).toEqual(["/assets/music/maps_36-40.ogg", "/assets/music/maps_36-40.mp3", "/assets/music/main.ogg"]);
    vi.unstubAllGlobals();
  });
});

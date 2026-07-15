import { describe, it, expect } from "vitest";
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

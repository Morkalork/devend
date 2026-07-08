import { describe, it, expect } from "vitest";
import { bestHighscore, isHighscoreRecord, highscoreBonus } from "@/lib/highscore";

describe("map highscore logic (#45)", () => {
  describe("bestHighscore", () => {
    it("first play stores the score as the baseline", () => {
      expect(bestHighscore(null, 120)).toBe(120);
    });
    it("keeps the higher of previous vs new", () => {
      expect(bestHighscore(100, 120)).toBe(120);
      expect(bestHighscore(150, 120)).toBe(150);
    });
  });

  describe("isHighscoreRecord", () => {
    it("first-ever play is NOT a record (no bonus on the baseline)", () => {
      expect(isHighscoreRecord(null, 120)).toBe(false);
    });
    it("beating an existing best is a record", () => {
      expect(isHighscoreRecord(100, 120)).toBe(true);
    });
    it("tying or falling short is not a record", () => {
      expect(isHighscoreRecord(120, 120)).toBe(false);
      expect(isHighscoreRecord(150, 120)).toBe(false);
    });
  });

  describe("highscoreBonus", () => {
    it("pays round(score * (mult - 1)) when a record is beaten", () => {
      expect(highscoreBonus(100, 200, 1.25)).toBe(50); // 200 * 0.25
      expect(highscoreBonus(100, 120, 1.25)).toBe(30); // 120 * 0.25
    });
    it("pays nothing on a first play or a non-record", () => {
      expect(highscoreBonus(null, 200, 1.25)).toBe(0);
      expect(highscoreBonus(200, 120, 1.25)).toBe(0);
      expect(highscoreBonus(120, 120, 1.25)).toBe(0);
    });
    it("a 1x (or bad) multiplier pays no bonus even on a record", () => {
      expect(highscoreBonus(100, 200, 1)).toBe(0);
      expect(highscoreBonus(100, 200, 0)).toBe(0);
      expect(highscoreBonus(100, 200, NaN)).toBe(0);
    });
  });
});

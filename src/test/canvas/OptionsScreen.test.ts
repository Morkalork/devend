/** The Options screen's rules (src/ui/screens/optionsModel.ts). */
import { describe, it, expect } from "vitest";
import { activeLanguageOf, sliderValueAt, volumePercent } from "@/ui/screens/optionsModel";

describe("the active language", () => {
  it("is the resolved language when the game ships it", () => {
    expect(activeLanguageOf("sv", "sv-SE")).toBe("sv");
    expect(activeLanguageOf(undefined, "es")).toBe("es");
  });

  it("falls back to English otherwise", () => {
    expect(activeLanguageOf("de", "de")).toBe("en");
    expect(activeLanguageOf(undefined, "fr-FR")).toBe("en");
  });
});

describe("the volume slider", () => {
  it("maps a position on the track to 0..1 in 0.01 steps, like the range input", () => {
    expect(sliderValueAt(0, 200)).toBe(0);
    expect(sliderValueAt(200, 200)).toBe(1);
    expect(sliderValueAt(100, 200)).toBe(0.5);
    expect(sliderValueAt(33.37, 100)).toBe(0.33);
  });

  it("clamps a drag past either end", () => {
    expect(sliderValueAt(-40, 200)).toBe(0);
    expect(sliderValueAt(400, 200)).toBe(1);
    expect(sliderValueAt(10, 0)).toBe(0);
  });

  it("shows a whole percentage", () => {
    expect(volumePercent(0.555)).toBe("56%");
    expect(volumePercent(1)).toBe("100%");
  });
});

/**
 * The canvas FeatureUnlockedModal's icon and colour (src/ui/game/FeatureUnlockedModalModel.ts).
 */
import { describe, it, expect } from "vitest";
import { Backpack, Sparkles, Trophy } from "lucide-react";
import { getAllFeatures } from "@/lib/features";
import { featureAccent, featureIcon } from "@/ui/game/FeatureUnlockedModalModel";

describe("the feature unlocked modal", () => {
  it("resolves a catalogue icon name, and falls back to Sparkles", () => {
    expect(featureIcon({ id: "x", icon: "Backpack", color: "#fff000" })).toBe(Backpack);
    expect(featureIcon({ id: "x", icon: "Trophy", color: "#fff000" })).toBe(Trophy);
    expect(featureIcon({ id: "x", icon: "NotAnIcon", color: "#fff000" })).toBe(Sparkles);
    expect(featureIcon(null)).toBe(Sparkles);
  });

  it("takes the feature's colour, else the brand green", () => {
    expect(featureAccent({ id: "x", icon: "Zap", color: "#123456" })).toBe("#123456");
    expect(featureAccent(null)).toBe("#00ff88");
  });

  it("has a mapped icon for every feature in the catalogue", () => {
    for (const f of getAllFeatures()) {
      if (f.icon === "Sparkles") continue;
      expect(featureIcon(f), `${f.id} uses an unmapped icon "${f.icon}"`).not.toBe(Sparkles);
    }
  });
});

/**
 * FeatureUnlockedModal's icon table, in a .ts file so the component file
 * exports components only.
 */
import { Backpack, Sparkles, Trophy, Award, Zap, type LucideIcon } from "lucide-react";
import type { GameFeature } from "@/lib/features";

// Resolves the `icon` NAME from features.yml to a lucide component. Add an entry
// here when a feature uses a new icon; unmapped names fall back to Sparkles.
export const FEATURE_ICONS: Record<string, LucideIcon> = {
  Backpack,
  Sparkles,
  Trophy,
  Award,
  Zap,
};

export function featureIcon(feature: GameFeature | null): LucideIcon {
  return (feature && FEATURE_ICONS[feature.icon]) || Sparkles;
}

/** The modal's accent: the feature's own colour, else the brand green. */
export function featureAccent(feature: GameFeature | null): string {
  return feature?.color ?? "#00ff88";
}

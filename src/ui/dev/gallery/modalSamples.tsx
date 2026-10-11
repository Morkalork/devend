/** Stateful samples for the modal gallery (src/ui/dev/gallery/modals.tsx). */
import { useEffect } from "react";
import type { LevelConfig } from "@/types/level";
import { clearMapTuning } from "@/lib/mapTuning";
import { MapTuningModal } from "../../game/MapTuningModal";

/**
 * The map tuner on a made-up map, which forgets whatever was tuned on it when
 * the sample closes: any saved tuning keeps every later run off the records
 * (useGameSession), and a tester poking at the gallery must not cost that.
 */
export function MapTuningSample({ level }: { level: LevelConfig }) {
  useEffect(() => () => clearMapTuning(level.id), [level.id]);
  return <MapTuningModal level={level} onClose={() => clearMapTuning(level.id)} />;
}

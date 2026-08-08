/**
 * Win-conditions summary for the per-map "How to win" modal.
 *
 * Derives a short, human sentence list from the level config, since maps now end
 * in several different ways (clear %, lock count, Colored Area, boss, plus the
 * time-limit / fence-budget fail states). Pure w.r.t. rendering; takes `t` so the
 * strings stay translatable.
 */
import type { TFunction } from "i18next";
import type { LevelConfig } from "@/types/level";
import { getMapTimeLimit } from "@/lib/mapTiming";
import { AREA_KINDS, gateAreas } from "@/lib/coloredAreas";

export function winConditionsBody(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): string {
  const parts: string[] = [];
  // Only GATE areas are win conditions; a bonus pocket is pure upside and has
  // nothing to say here (the board's own marking sells it).
  const areas = gateAreas(level.coloredAreas ?? []);
  const isBoss = !!level.boss;
  const target = t(isBoss ? "winConditions.targetBoss" : "winConditions.targetBall");

  if (areas.length > 0) {
    // Colored Area is the sole win path (lock a target inside; outside fails).
    const a = areas[0];
    const mult = AREA_KINDS[a.kind]?.multiplier ?? 1;
    parts.push(t("winConditions.areaWin", { target, area: a.kind, mult }));
    parts.push(t("winConditions.areaFail", { target }));
  } else if (isBoss) {
    parts.push(t("winConditions.boss"));
  } else {
    parts.push(t("winConditions.clear", { percent: Math.max(1, 100 - level.sizeThreshold) }));
    if (level.threadLockRequired && level.threadLockRequired > 0) {
      parts.push(t("winConditions.lock", { count: level.threadLockRequired }));
    }
  }

  const timeLimit = getMapTimeLimit(level, levelNumber);
  if (timeLimit != null) parts.push(t("winConditions.time", { seconds: timeLimit }));
  if (level.fenceBudget != null) parts.push(t("winConditions.fences", { count: level.fenceBudget }));

  return parts.join(" ");
}

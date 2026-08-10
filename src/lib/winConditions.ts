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

/**
 * The clauses of a map's win conditions, plus whether any of them says something
 * the player could not already read off the HUD.
 *
 * Both outputs come from one pass on purpose. The modal's trigger and its text
 * have to agree, and a separately written predicate would drift the first time a
 * clause was added: a map would then either open a modal saying nothing new, or
 * silently stop announcing a real constraint.
 */
function winConditionParts(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): { parts: string[]; noteworthy: boolean } {
  const parts: string[] = [];
  let noteworthy = false;
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
    noteworthy = true;
  } else if (isBoss) {
    parts.push(t("winConditions.boss"));
    noteworthy = true;
  } else {
    // The default win, and the ONE clause that is not worth interrupting for:
    // the top bar shows "X% to go" for the whole map, permanently.
    parts.push(t("winConditions.clear", { percent: Math.max(1, 100 - level.sizeThreshold) }));
    if (level.threadLockRequired && level.threadLockRequired > 0) {
      parts.push(t("winConditions.lock", { count: level.threadLockRequired }));
      noteworthy = true;
    }
  }

  const timeLimit = getMapTimeLimit(level, levelNumber);
  if (timeLimit != null) {
    parts.push(t("winConditions.time", { seconds: timeLimit }));
    // Only an AUTHORED timer is worth announcing. getMapTimeLimit returns a
    // value for every map past the tutorial band, so counting it would mark 37
    // of 40 maps noteworthy and change nothing. The default ramp is the same
    // deal on every map, has its own one-time explainer, and runs down a bar the
    // player can see; a map that sets its own timer is the exception.
    if (level.timeLimit != null) noteworthy = true;
  }
  if (level.fenceBudget != null) {
    parts.push(t("winConditions.fences", { count: level.fenceBudget }));
    noteworthy = true;
  }

  return { parts, noteworthy };
}

export function winConditionsBody(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): string {
  return winConditionParts(t, level, levelNumber).parts.join(" ");
}

/**
 * Should this map ANNOUNCE its win conditions unprompted?
 *
 * Only when it has something to say beyond "clear X% of the board", which the
 * top bar already reports continuously. Opening a modal to restate a number that
 * is permanently on screen spends the player's attention and teaches them that
 * these modals are safe to dismiss unread, which is the real cost.
 *
 * The menu entry stays available on every map, so nothing becomes unreachable.
 */
export function shouldAnnounceWinConditions(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): boolean {
  return winConditionParts(t, level, levelNumber).noteworthy;
}

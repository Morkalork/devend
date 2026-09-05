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
import { resolveWinSpec } from "@/lib/winSpec";
import type { WinCondition } from "@/types/winSpec";
import { getBallType } from "@/lib/ballTypes";

/**
 * The clauses of a map's win conditions, plus whether any of them says
 * something the player could not already read off the HUD.
 *
 * Reads the SAME WinSpec the gate does. It used to re-derive the win from the
 * level fields independently, which meant a map could tell the player one thing
 * and check another, and the original comment here already worried about that
 * drift. Now the only way to change what a map asks is to change the spec, and
 * both readers see it.
 *
 * Both outputs still come from one pass, for the same reason as before: the
 * modal's trigger and its text have to agree.
 */
/** A ball type's display name, falling back to its id for an unknown one so a
 *  typo in an authored win reads as the typo rather than as nothing. */
function ballName(id: string): string {
  return getBallType(id)?.name ?? id;
}

function winConditionParts(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): { parts: string[]; noteworthy: boolean } {
  const parts: string[] = [];
  let noteworthy = false;
  const spec = resolveWinSpec(level);
  const isBoss = !!level.boss;
  const target = t(isBoss ? "winConditions.targetBoss" : "winConditions.targetBall");
  const areas = gateAreas(level.coloredAreas ?? []);

  for (const c of spec.require) {
    switch (c.kind) {
      case "space":
        // The ONE clause not worth interrupting for: the top bar shows "X% to
        // go" for the whole map, permanently.
        parts.push(t("winConditions.clear", { percent: Math.max(1, 100 - c.threshold) }));
        break;
      case "locks":
        parts.push(t("winConditions.lock", { count: c.count }));
        noteworthy = true;
        break;
      case "superiorLocks":
        parts.push(t("winConditions.superiorLocks", { count: c.count }));
        noteworthy = true;
        break;
      case "area": {
        const kind = areas[0]?.kind;
        const mult = kind ? (AREA_KINDS[kind]?.multiplier ?? 1) : 1;
        parts.push(c.count > 1
          ? t("winConditions.areaWinMany", { count: c.count, area: kind, mult })
          : t("winConditions.areaWin", { target, area: kind, mult }));
        parts.push(t("winConditions.areaFail", { target }));
        noteworthy = true;
        break;
      }
      case "lockType":
        parts.push(t("winConditions.lockType", {
          count: c.count, ball: ballName(c.ballType),
        }));
        noteworthy = true;
        break;
      case "boss": {
        // Say WHERE, when there is a where. Every boss on the ladder is beaten
        // by fencing it into a var zone, and the map used to derive an `area`
        // clause that spelled that out. The clause is `boss` now - it is the
        // only one that waits for BOTH halves of a chained pair - but the
        // player still has to be told the same thing, so the area lines come
        // along with it rather than being lost with the clause that carried
        // them.
        const zone = areas[0]?.kind;
        if (zone) {
          const mult = AREA_KINDS[zone]?.multiplier ?? 1;
          parts.push(t("winConditions.areaWin", { target, area: zone, mult }));
          parts.push(t("winConditions.areaFail", { target }));
        }
        // Two chained bosses are ONE win and neither trap ends the map alone,
        // which is not something the board tells you.
        if ((level.boss?.bossBall?.count ?? 1) > 1) {
          parts.push(t("winConditions.bossPair"));
        } else {
          parts.push(t("winConditions.boss"));
        }
        noteworthy = true;
        break;
      }
      case "allLocked":
        parts.push(t("winConditions.allLocked"));
        noteworthy = true;
        break;
      case "smashed":
        parts.push(t("winConditions.smashed", { count: c.count }));
        noteworthy = true;
        break;
      case "terminals":
        parts.push(t("winConditions.terminals", { count: c.count }));
        noteworthy = true;
        break;
      case "harvested":
        parts.push(t("winConditions.harvested", { count: c.count }));
        noteworthy = true;
        break;
      case "delivered":
        parts.push(t("winConditions.delivered", { count: c.count }));
        noteworthy = true;
        break;
      case "underPar":
        parts.push(t("winConditions.underPar", { count: level.expectedCuts + c.delta }));
        noteworthy = true;
        break;
      case "speedClear":
        parts.push(t("winConditions.speedClear", { seconds: c.seconds }));
        noteworthy = true;
        break;
    }
  }

  // Alternatives are worth stating only when they are not the standing
  // all-balls-locked shortcut every ordinary map has always had, which would
  // otherwise add a line to 38 of 40 maps and teach nobody anything.
  for (const c of spec.alsoWinIf) {
    if (c.kind === "allLocked" && !spec.authored) continue;
    parts.push(t("winConditions.orElse", { clause: clauseText(t, c, level) }));
    noteworthy = true;
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

/**
 * One clause as a bare phrase, for an "or" alternative and for the admin
 * preview. Shares its wording with the sentences above so the builder shows the
 * player's words rather than an editor's paraphrase of them.
 */
export function clauseText(t: TFunction, c: WinCondition, level: LevelConfig): string {
  switch (c.kind) {
    case "space": return t("winConditions.shortClear", { percent: Math.max(1, 100 - c.threshold) });
    case "locks": return t("winConditions.shortLock", { count: c.count });
    case "superiorLocks": return t("winConditions.shortSuperior", { count: c.count });
    case "area": return t("winConditions.shortArea", { count: c.count });
    case "lockType": return t("winConditions.shortLockType", {
      count: c.count, ball: ballName(c.ballType) });
    case "boss": return t("winConditions.shortBoss");
    case "allLocked": return t("winConditions.shortAllLocked");
    case "smashed": return t("winConditions.shortSmashed", { count: c.count });
    case "terminals": return t("winConditions.shortTerminals", { count: c.count });
    case "harvested": return t("winConditions.shortHarvested", { count: c.count });
    case "delivered": return t("winConditions.shortDelivered", { count: c.count });
    case "underPar": return t("winConditions.shortUnderPar", { count: level.expectedCuts + c.delta });
    case "speedClear": return t("winConditions.shortSpeed", { seconds: c.seconds });
  }
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

/**
 * Win-conditions summary for the per-map "Acceptance Criteria" modal.
 *
 * GROUPED, because it used to be one run-on paragraph. Every clause - the
 * required ones, the alternatives, the time limit, the fence budget - was joined
 * with a space into a single block of centred prose, and the player had to work
 * out from the wording alone which parts they HAD to do and which were merely
 * things that were true. On a map with four clauses and a fail state that is a
 * paragraph nobody reads twice.
 *
 * Four questions the player is actually asking, in this order:
 *
 *   REQUIRED   what must be true for this map to end
 *   OPTIONAL   what pays extra and costs nothing to skip
 *   OR         a different way to finish, when the map offers one
 *   TRADE      the two things that cannot both be had, when the map poses one
 *   FAIL       what takes a life
 *
 * The optional group is new content, not just a new heading. A BONUS colored
 * area (`required: false`) pays 1.5x to 3x and was never mentioned here at all:
 * the switch below only ever fired on a `area` win CLAUSE, so the greed hook -
 * the thing half of section 6.2 is about - was invisible in the one screen that
 * exists to say what a map wants.
 *
 * Pure w.r.t. rendering; takes `t` so the strings stay translatable.
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

/**
 * Which list a criterion belongs in.
 *
 * Ordered as the player asks: what must I do, what may I do, what else ends
 * this, what can I not have both of, and what takes a life.
 */
export type CriterionGroup = "required" | "optional" | "either" | "trade" | "fail";

export const CRITERION_GROUPS: CriterionGroup[] =
  ["required", "optional", "either", "trade", "fail"];

export interface Criterion {
  group: CriterionGroup;
  text: string;
}

function winConditionParts(
  t: TFunction,
  level: LevelConfig,
  levelNumber: number,
): { criteria: Criterion[]; noteworthy: boolean } {
  const criteria: Criterion[] = [];
  let noteworthy = false;
  const spec = resolveWinSpec(level);
  const isBoss = !!level.boss;
  const target = t(isBoss ? "winConditions.targetBoss" : "winConditions.targetBall");
  const areas = gateAreas(level.coloredAreas ?? []);
  const bonusAreas = (level.coloredAreas ?? []).filter(a => a.required === false);

  const say = (group: CriterionGroup, text: string) => criteria.push({ group, text });
  /** Required, and worth interrupting the map to say. */
  const must = (text: string) => { say("required", text); noteworthy = true; };

  for (const c of spec.require) {
    switch (c.kind) {
      case "space":
        // The ONE clause not worth interrupting for: the top bar shows "X% to
        // go" for the whole map, permanently. Required, so it is listed - but
        // `say` rather than `must`, because listing it and interrupting the map
        // to announce it are different questions.
        say("required", t("winConditions.clear", { percent: Math.max(1, 100 - c.threshold) }));
        break;
      case "locks":
        must(t("winConditions.lock", { count: c.count }));
        break;
      case "superiorLocks":
        must(t("winConditions.superiorLocks", { count: c.count }));
        break;
      case "area": {
        const kind = areas[0]?.kind;
        const mult = kind ? (AREA_KINDS[kind]?.multiplier ?? 1) : 1;
        must(c.count > 1
          ? t("winConditions.areaWinMany", { count: c.count, area: kind, mult })
          : t("winConditions.areaWin", { target, area: kind, mult }));
        // The fail is a FAIL, not a second thing to do. Sitting beside the win
        // in one paragraph, "trap it outside and you lose a life" read as an
        // instruction rather than as the penalty it is.
        say("fail", t("winConditions.areaFail", { target }));
        break;
      }
      case "lockType":
        must(t("winConditions.lockType", {
          count: c.count, ball: ballName(c.ballType),
        }));
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
          must(t("winConditions.areaWin", { target, area: zone, mult }));
          say("fail", t("winConditions.areaFail", { target }));
        }
        // Two chained bosses are ONE win and neither trap ends the map alone,
        // which is not something the board tells you.
        must((level.boss?.bossBall?.count ?? 1) > 1
          ? t("winConditions.bossPair")
          : t("winConditions.boss"));
        break;
      }
      case "allLocked":
        must(t("winConditions.allLocked"));
        break;
      case "smashed":
        must(t("winConditions.smashed", { count: c.count }));
        break;
      case "terminals":
        must(t("winConditions.terminals", { count: c.count }));
        break;
      case "harvested":
        must(t("winConditions.harvested", { count: c.count }));
        break;
      case "delivered":
        must(t("winConditions.delivered", { count: c.count }));
        break;
      case "underPar":
        must(t("winConditions.underPar", { count: level.expectedCuts + c.delta }));
        break;
      case "speedClear":
        must(t("winConditions.speedClear", { seconds: c.seconds }));
        break;
    }
  }

  // Alternatives are worth stating only when they are not the standing
  // all-balls-locked shortcut every ordinary map has always had, which would
  // otherwise add a line to 38 of 40 maps and teach nobody anything.
  for (const c of spec.alsoWinIf) {
    if (c.kind === "allLocked" && !spec.authored) continue;
    say("either", clauseText(t, c, level));
    noteworthy = true;
  }

  const timeLimit = getMapTimeLimit(level, levelNumber);
  if (timeLimit != null) {
    say("fail", t("winConditions.time", { seconds: timeLimit }));
    // Only an AUTHORED timer is worth announcing. getMapTimeLimit returns a
    // value for every map past the tutorial band, so counting it would mark 37
    // of 40 maps noteworthy and change nothing. The default ramp is the same
    // deal on every map, has its own one-time explainer, and runs down a bar the
    // player can see; a map that sets its own timer is the exception.
    if (level.timeLimit != null) noteworthy = true;
  }
  if (level.fenceBudget != null) {
    say("fail", t("winConditions.fences", { count: level.fenceBudget }));
    noteworthy = true;
  }

  // ── OPTIONAL: the greed hook, which this modal never mentioned ──────────
  //
  // A bonus area pays 1.5x to 3x and gates nothing. It was invisible here
  // because the switch above only fires on an `area` win CLAUSE, so a player
  // reading the criteria had no way to learn the pocket existed, let alone what
  // it was worth - on a mechanic the map design guidelines give half a section
  // to. Saying "skipping it costs nothing" in as many words is the other half:
  // the whole point of a bonus pocket is that misreading it is free.
  //
  // Listed, but NOT noteworthy: a bonus pocket does not on its own earn an
  // unprompted modal. It is upside rather than a condition, the board already
  // draws it with its keyword, and 19 of the 31 playable maps carry one - so
  // announcing it would interrupt most of the game to say something optional.
  // Being in the body is the fix; being in the trigger would be a regression.
  for (const a of bonusAreas) {
    const mult = AREA_KINDS[a.kind]?.multiplier ?? 1;
    say("optional", t("winConditions.bonusArea", { area: a.kind, mult }));
  }

  // ── THE TRADE: two things this map will not let you have both of ─────────
  //
  // Only stated where it is REAL. A WIP limit rations the fences, and the walk
  // to a bonus pocket spends some of them, so on a budgeted map the pocket and
  // a comfortable clear are genuinely in competition - MAP_DESIGN_GUIDELINES
  // puts it as "the bonus is affordable or the map is, not both".
  //
  // Deliberately narrow. Every map past the tutorial band has a clock, and
  // "the pocket costs time" is true everywhere, which would make this a line
  // that appears on 30 maps and therefore says nothing. A trade the player is
  // told about on every map is not a trade, it is wallpaper.
  // Not noteworthy on its own either: a map with a fence budget is already
  // announcing itself for the budget, so this rides along rather than being a
  // second reason to open the same modal.
  if (level.fenceBudget != null && bonusAreas.length > 0) {
    say("trade", t("winConditions.tradeBudgetBonus", { count: level.fenceBudget }));
  }

  return { criteria, noteworthy };
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
  return renderCriteria(t, winConditions(t, level, levelNumber));
}

/** The grouped criteria, for anything that wants to lay them out itself. */
export function winConditions(
  t: TFunction, level: LevelConfig, levelNumber: number,
): Criterion[] {
  return winConditionParts(t, level, levelNumber).criteria;
}

/**
 * The criteria as a plain block of text: a heading per group, a bullet per
 * criterion, a blank line between groups.
 *
 * A string rather than JSX because the modal that shows this also shows the
 * boss intro, the fence tutorial and half a dozen other explainers, all through
 * one `body: string`. Giving one of them a bespoke component would mean two
 * ways to open an overlay, and the format here needs nothing richer: the work
 * was deciding WHICH list each line belongs in, not how to draw a bullet.
 *
 * Empty groups print nothing at all - no "Optional: none", which is a line that
 * costs a reader attention to learn something they did not ask.
 */
export function renderCriteria(t: TFunction, criteria: Criterion[]): string {
  const blocks: string[] = [];
  for (const group of CRITERION_GROUPS) {
    const lines = criteria.filter(c => c.group === group);
    if (lines.length === 0) continue;
    // "all of these" is only true when there is more than one, and a heading
    // that says it over a single bullet reads as though something is missing.
    const heading = group === "required" && lines.length > 1
      ? t("winConditions.groupRequiredAll")
      : t(`winConditions.group.${group}`);
    blocks.push([heading, ...lines.map(l => `  - ${l.text}`)].join("\n"));
  }
  return blocks.join("\n\n");
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

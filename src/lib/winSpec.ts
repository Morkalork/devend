/**
 * Resolving and evaluating a map's win.
 *
 * The important function here is `resolveWinSpec`, and the important thing
 * about it is that it changes nothing. Every one of the 40 authored maps has
 * its win expressed today as an accident of which LevelConfig fields happen to
 * be set, and the runtime read them in a fixed order where a gate area or a
 * boss REPLACED the space clear rather than adding to it. Deriving a spec from
 * those same fields, and having the gate read the spec, means the model can be
 * introduced without re-tuning a single map. An authored `win:` block then
 * overrides the derivation for maps that want to say something new.
 *
 * The second reason it exists: the "How to win" modal used to read the same
 * five fields a second time and reach its own conclusion, so a map could tell
 * the player one thing and check another. Both now read one spec.
 */
import type { LevelConfig, ColoredArea } from "@/types/level";
import type {
  WinCondition, WinConditionProgress, WinSnapshot, WinSpec,
} from "@/types/winSpec";
import type { WinReason } from "@/types/game";
import { gateAreas } from "@/lib/coloredAreas";

/** The alternative win every non-boss, non-gate map has always had. */
const ALL_LOCKED: WinCondition = { kind: "allLocked" };

/**
 * A level's win spec: the authored one if it has it, else derived from the
 * legacy fields exactly as the old chain read them.
 *
 * The derivation is the compatibility contract, so it is written to mirror the
 * old `if` order rather than to be tidy:
 *
 *   gate area present -> the area is the SOLE win (no space clause at all)
 *   boss present      -> the boss is the SOLE win, space never applies
 *   otherwise         -> clear to the threshold, and lock threadLockRequired,
 *                        with all-balls-locked as a standing alternative
 */
export function resolveWinSpec(level: LevelConfig): WinSpec {
  if (level.win) {
    return {
      require: level.win.require ?? [],
      // An authored spec that says nothing about alternatives keeps none. A map
      // that wants the all-locked shortcut has to ask for it, or a gate the
      // author wrote could be walked around by locking everything.
      alsoWinIf: level.win.alsoWinIf ?? [],
      authored: true,
    };
  }

  // A gate area is the sole win: locking a target inside ships the map whatever
  // space is left, and no other clause applies. Count 1 reproduces the old
  // boolean `coloredAreaSatisfied`.
  if (gateAreas(level.coloredAreas ?? []).length > 0) {
    return { require: [{ kind: "area", count: 1 }], alsoWinIf: [], authored: false };
  }

  // Boss maps are about the boss, not about grinding the board.
  if (level.boss) {
    return { require: [{ kind: "boss" }], alsoWinIf: [], authored: false };
  }

  const require: WinCondition[] = [{ kind: "space", threshold: level.sizeThreshold }];
  if ((level.threadLockRequired ?? 0) > 0) {
    require.push({ kind: "locks", count: level.threadLockRequired! });
  }
  return { require, alsoWinIf: [ALL_LOCKED], authored: false };
}

/**
 * Evaluate one clause against a snapshot.
 *
 * `limit` clauses (underPar, speedClear) are the awkward ones: they are met
 * until they are blown, so `met` is provisional and only means anything at the
 * moment the rest of the win lands. Reporting them as "complete" from second
 * zero would be a lie the HUD then has to walk back.
 */
export function evaluateWinCondition(
  condition: WinCondition, snap: WinSnapshot,
): WinConditionProgress {
  const accumulate = (current: number, target: number): WinConditionProgress =>
    ({ condition, current, target, met: current >= target, mode: "accumulate" });
  const limit = (current: number, target: number): WinConditionProgress =>
    ({ condition, current, target, met: current <= target, mode: "limit" });

  switch (condition.kind) {
    case "space":
      // Remaining percent counts DOWN to the threshold, so it is a limit.
      // Matches the HUD, which shows CLEAR at exactly the threshold: a
      // strictly-less check left the map unfinished on an exact landing.
      return limit(snap.remainingPercent, condition.threshold);
    case "locks":
      return accumulate(snap.lockedBalls, condition.count);
    case "superiorLocks":
      return accumulate(snap.superiorLocks, condition.count);
    case "area":
      return accumulate(snap.areaTargets, condition.count);
    case "lockType":
      return accumulate(snap.lockedByType[condition.ballType] ?? 0, condition.count);
    case "boss":
      return accumulate(snap.bossDefeated ? 1 : 0, 1);
    case "allLocked":
      return accumulate(snap.allLocked ? 1 : 0, 1);
    case "delivered":
      return accumulate(snap.delivered, condition.count);
    case "smashed":
      return accumulate(snap.smashed, condition.count);
    case "underPar":
      return limit(snap.cuts, snap.par + condition.delta);
    case "speedClear":
      return limit(snap.activeSeconds, condition.seconds);
  }
}

/** Every clause of a spec, required ones first, for the HUD and the preview. */
export function evaluateWinSpec(spec: WinSpec, snap: WinSnapshot): WinConditionProgress[] {
  return [...spec.require, ...spec.alsoWinIf].map(c => evaluateWinCondition(c, snap));
}

/**
 * Is the map won?
 *
 * An empty `require` list would be won on the first frame, so it is treated as
 * unwinnable instead: a map with no stated win is an authoring mistake, and
 * completing instantly is a far more confusing way to report it than never
 * completing at all. The admin panel flags it outright.
 */
export function isWinMet(spec: WinSpec, snap: WinSnapshot): boolean {
  for (const c of spec.alsoWinIf) {
    if (evaluateWinCondition(c, snap).met) return true;
  }
  if (spec.require.length === 0) return false;
  return spec.require.every(c => evaluateWinCondition(c, snap).met);
}

/**
 * The alternative clause that ended the map, or null.
 *
 * Separate from isWinMet because the two answers are used differently: a win
 * reached through an ALTERNATIVE has to end the map outright, while the
 * ordinary requirements route through the push-your-luck prompt. Collapsing
 * them into one boolean is what made "every ball locked" open a prompt on a
 * board with nothing left to push with.
 */
export function metAlternative(spec: WinSpec, snap: WinSnapshot): WinCondition | null {
  for (const c of spec.alsoWinIf) {
    if (evaluateWinCondition(c, snap).met) return c;
  }
  return null;
}

/** Are all the REQUIRED clauses met? An empty list is never met (see isWinMet). */
export function requirementsMet(spec: WinSpec, snap: WinSnapshot): boolean {
  if (spec.require.length === 0) return false;
  return spec.require.every(c => evaluateWinCondition(c, snap).met);
}

/**
 * Which clause should be reported as the reason a map ended.
 *
 * The results screen and the highscore ledger both key off this, so it has to
 * name the clause that actually finished the map rather than the first one in
 * the list: an alternative win beat the requirements, and among requirements
 * the one that landed last is the one the player just did.
 */
export function winningCondition(spec: WinSpec, snap: WinSnapshot): WinCondition | null {
  for (const c of spec.alsoWinIf) {
    if (evaluateWinCondition(c, snap).met) return c;
  }
  if (spec.require.length === 0) return null;
  if (!spec.require.every(c => evaluateWinCondition(c, snap).met)) return null;
  // Among met requirements, the most specific one reads best as "why you won":
  // "boss beaten" beats "cleared to 12%" on a map that asked for both.
  const rank: Record<WinCondition["kind"], number> = {
    // A delivery ranks just under a gate zone: both are "you put a ball
    // somewhere specific", and that reads better as the reason you won than a
    // plain lock count does.
    // A smash ranks with the "you did a specific thing" group: on a map whose
    // win is "clear the board AND break the slab", the slab is the story.
    boss: 0, area: 1, delivered: 2, smashed: 3, lockType: 4, superiorLocks: 5,
    allLocked: 6, locks: 7, speedClear: 8, underPar: 9, space: 10,
  };
  return [...spec.require].sort((a, b) => rank[a.kind] - rank[b.kind])[0];
}

/**
 * Reasons this spec can never be met, for the admin panel.
 *
 * A `require` list makes an unwinnable map easy to author by accident, and the
 * failure is silent: the map simply never completes and the author assumes they
 * misplayed it. Same job as the mover path flagging a patrol that leaves the
 * board.
 */
export function winSpecProblems(spec: WinSpec, level: LevelConfig): string[] {
  const problems: string[] = [];
  const kinds = new Set(spec.require.map(c => c.kind));

  if (spec.require.length === 0) {
    problems.push("No required condition, so this map can never be won.");
  }

  const areaClause = spec.require.find(c => c.kind === "area");
  if (areaClause?.kind === "area") {
    const gates = gateAreas(level.coloredAreas ?? []).length;
    if (gates === 0) {
      problems.push("Asks for a Colored Area lock, but the map has no gate area.");
    }
    if (areaClause.count > (level.maxBalls ?? 1)) {
      problems.push(
        `Asks for ${areaClause.count} balls in the area, but the map spawns at most ${level.maxBalls ?? 1}.`);
    }
  }

  if (kinds.has("boss") && !level.boss) {
    problems.push("Asks for a boss defeat, but the map has no boss.");
  }

  for (const c of spec.require) {
    if ((c.kind === "locks" || c.kind === "superiorLocks") && c.count > (level.maxBalls ?? 1)) {
      problems.push(
        `Asks for ${c.count} ${c.kind === "locks" ? "locks" : "superior locks"}, but the map spawns at most ${level.maxBalls ?? 1} balls.`);
    }
    if (c.kind === "lockType") {
      if (c.count > (level.maxBalls ?? 1)) {
        problems.push(
          `Asks for ${c.count} ${c.ballType} locks, but the map spawns at most ${level.maxBalls ?? 1} balls.`);
      }
      // A win that names a ball needs that ball to be THERE. Ball types are
      // otherwise picked from maxBalls and unlock levels, so left to the roll
      // the named ball may simply not spawn and the map is unwinnable through
      // no fault of the player.
      const roster = level.ballTypeIds;
      if (!roster) {
        problems.push(
          `Asks to lock a ${c.ballType}, but the roster is left to the roll: pin ballTypeIds or the ball may not spawn.`);
      } else if (!roster.includes(c.ballType)) {
        problems.push(
          `Asks to lock a ${c.ballType}, which is not in this map's pinned roster (${roster.join(", ")}).`);
      }
    }
    if (c.kind === "smashed") {
      // Breakables only, matching the clause: a map whose only destructibles
      // are mirrors and movers offers nothing to smash, and a win asking for
      // one would be unwinnable with no hint on the board as to why.
      const breakables = (level.entities ?? [])
        .filter(e => e.kind === "wall" && e.breakable).length;
      if (c.count > breakables) {
        problems.push(
          `Asks for ${c.count} smashed, but the map has ${breakables} breakable ${breakables === 1 ? "obstacle" : "obstacles"}.`);
      }
    }
    if (c.kind === "underPar" && level.expectedCuts + c.delta < 1) {
      problems.push("The cut budget this allows is less than one cut.");
    }
    if (c.kind === "speedClear" && c.seconds <= 0) {
      problems.push("The speed clear allows no time at all.");
    }
    if (c.kind === "space" && (c.threshold < 0 || c.threshold >= 100)) {
      problems.push("The space threshold is outside 0..99 percent.");
    }
  }

  // A premium far outside the range the economy is tuned for is almost always a
  // typo: a good map's whole earned pay is around 95h, so +500% is another four
  // maps' income for one win. The backstop would clamp it, silently.
  for (const c of [...spec.require, ...spec.alsoWinIf]) {
    const p = c.bonusPercent;
    if (p === undefined) continue;
    if (!Number.isFinite(p) || p < 0) problems.push(`A win premium on ${c.kind} is not a positive percent.`);
    else if (p > 200) problems.push(`A win premium of ${p}% on ${c.kind} is far past anything the economy is tuned for.`);
  }

  // Locking every ball leaves nothing to put in the zone or to grade superior.
  if (kinds.has("allLocked") && (kinds.has("area") || kinds.has("lockType"))) {
    problems.push("Requires every ball locked AND a specific ball locked somewhere; the second can never be checked after the first.");
  }

  return problems;
}

/**
 * Which WinReason to report on the results screen.
 *
 * WinReason predates the spec and several stored highscore records already use
 * its four values, so new condition kinds map onto the closest existing reason
 * rather than widening the type. The switch is exhaustive over WinConditionKind
 * on purpose: adding a kind without deciding how it is reported should fail to
 * compile, not silently report as a space clear.
 */
export function winReasonFor(spec: WinSpec, snap: WinSnapshot): WinReason {
  const winner = winningCondition(spec, snap);
  if (!winner) return "space";
  switch (winner.kind) {
    case "boss": return "boss";
    case "area": return "area";
    case "allLocked": return "allLocked";
    // Two endings that used to fall off this switch entirely and return
    // undefined, which the results screen and the highscore ledger both store.
    // `delivered` has been a legal clause the whole time; it was invisible only
    // because it was missing from WIN_CONDITION_KINDS, so the exhaustiveness
    // test never reached it.
    case "smashed": return "smashed";
    case "delivered": return "delivered";
    // A win earned by sealing balls reads as an all-locked ending: the map
    // finished because of what you trapped, not because the board ran out.
    case "locks":
    case "superiorLocks":
    case "lockType": return "allLocked";
    // These only ever gate a clear, never finish one on their own.
    case "space":
    case "underPar":
    case "speedClear": return "space";
  }
}

/**
 * The total win premium a finished map earned, in percent.
 *
 * Required clauses all pay, since the map cannot be won without them, so a
 * required premium is really a per-map difficulty price expressed on the clause
 * that causes the difficulty. That is the point: an author who adds "lock a
 * ball in the const zone" writes what it is worth in the same row and cannot
 * add a hard win and forget to price it.
 *
 * Alternative clauses pay only when they are the one that actually fired, which
 * is what lets a hard alternative route be worth taking rather than merely
 * possible. Only the FIRST met alternative counts, matching isWinMet: the map
 * ended on that clause and the others were never reached.
 *
 * Additive, not compounding, so a list of clauses can be totalled by eye.
 */
export function winBonusPercent(spec: WinSpec, snap: WinSnapshot): number {
  if (!isWinMet(spec, snap)) return 0;
  let percent = 0;
  const add = (c: WinCondition) => {
    const p = c.bonusPercent;
    if (Number.isFinite(p) && (p as number) > 0) percent += p as number;
  };

  for (const c of spec.alsoWinIf) {
    if (evaluateWinCondition(c, snap).met) {
      // An alternative ended the map on its own; the requirements were not the
      // reason it finished, so they do not collect.
      add(c);
      return percent;
    }
  }
  for (const c of spec.require) add(c);
  return percent;
}

/**
 * Make the map's areas gate the win, when a win condition has started asking
 * them to.
 *
 * An `area` clause reads a counter that is only ever incremented inside
 * `if (areaGate && ...)` in checkBallWonState, and `areaGate` is "this map has
 * at least one area without `required: false`". So asking for an area lock on a
 * map whose areas are all bonus pockets is not a hard win condition, it is an
 * impossible one - the clause can never be satisfied and the map is winnable
 * only through whatever alternative happens to be there. Level 5 shipped in
 * exactly that state: two bonus pockets, a required area clause, and a player
 * told to "lock a ball inside the area for a 1x payout" on a map where the
 * multiplier could not even be read (gateAreas was empty, so the copy fell back
 * to 1x while the board plainly showed x2 and x1.5).
 *
 * Setting the clause and setting the flag were two separate acts in two
 * different panels, so the editor let you do half of it. This makes the second
 * half follow from the first.
 *
 * ── Only when there is no gate at all ──────────────────────────────────────
 *
 * A map that already has one gate and one bonus pocket is a deliberate
 * arrangement: the gate is the target, the pocket is a reward. Promoting
 * everything there would flatten a real design decision, and the clause is
 * already satisfiable, so there is nothing to fix. This fires only on the
 * broken state, where nothing gates the win and the clause is dead.
 *
 * Both groups count. An `area` clause in `alsoWinIf` is just as dead as one in
 * `require` - it simply never fires - and winSpecProblems does not even look
 * there, so it would be the quieter of the two failures.
 */
export function areasGatingWin(
  areas: ColoredArea[],
  require: WinCondition[],
  alsoWinIf: WinCondition[],
): ColoredArea[] {
  const wantsArea = [...require, ...alsoWinIf].some(c => c.kind === "area");
  if (!wantsArea || areas.length === 0) return areas;
  if (gateAreas(areas).length > 0) return areas;

  // The key is DELETED rather than set to undefined. `required: undefined`
  // survives an object spread as a present key and js-yaml writes it out, so
  // the saved map would grow a `required: null` that reads as neither.
  return areas.map(a => {
    const next = { ...a };
    delete next.required;
    return next;
  });
}

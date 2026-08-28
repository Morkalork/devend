/**
 * Which win conditions the board has to shout about.
 *
 * Almost every map is won the same two ways: fence off enough space, and lock
 * the balls the map asks for. Three of the forty authored maps want something
 * else as well - a superior lock (32), a named ball type sealed (33), a ball
 * locked inside a coloured area (34) - and until now the only place that said
 * so was a "How to win" item inside the hamburger menu. The requirement was
 * real, checked every frame, and invisible unless you went looking for it.
 *
 * Two readouts are built on this, and the reason they both live here is that
 * they must not be able to disagree with the gate. Everything below runs the
 * same evaluateWinSpec the win check itself runs, so a chip cannot claim a
 * requirement is met on a map that refuses to finish.
 *
 * WHAT COUNTS AS EXTRA. Space and locks are the ordinary clear and the top bar
 * already reports both: space as "12% to go" / CLEAR, locks on the lock chip.
 * Repeating them would push the unusual requirement off the end of a row that
 * is already full on a phone. So the chips carry only what the player has no
 * other way to see.
 *
 * REQUIRED ONLY, never alsoWinIf. An alternative is a way OUT of the map, not a
 * demand on the player: rendering "all balls locked" as an unmet requirement
 * would tell a player they have to lock everything on a map where locking
 * everything is merely one option among two.
 */
import { evaluateWinCondition } from "@/lib/winSpec";
import type { WinCondition, WinConditionProgress, WinSnapshot, WinSpec } from "@/types/winSpec";

/**
 * The two the top bar already reports. Everything else is "extra" and gets a
 * chip of its own.
 */
const ORDINARY = new Set<WinCondition["kind"]>(["space", "locks"]);

/** Whether this clause is one the player has no other readout for. */
export function isExtraGate(condition: WinCondition): boolean {
  return !ORDINARY.has(condition.kind);
}

/**
 * The unusual requirements of a map, with live progress, in authored order.
 *
 * Empty on the great majority of maps, which is the point: a chip that appears
 * on every map is chrome, and a chip that appears on three of forty is a
 * signal that something is different about this one.
 */
export function extraGates(spec: WinSpec, snap: WinSnapshot): WinConditionProgress[] {
  return spec.require
    .filter(isExtraGate)
    .map(c => evaluateWinCondition(c, snap));
}

/**
 * Is this requirement actually in the bag?
 *
 * NOT simply `met`. A `limit` clause (finish under par, clear inside N seconds)
 * is met until it is blown, so it reads as satisfied from the first frame -
 * evaluateWinCondition says as much in its own comment, and calling that
 * "done" would light the board's frame green on a map the player has not begun
 * to earn yet. A limit is a constraint you are living under, not an achievement
 * you have banked, so it counts as outstanding until the map is actually won.
 */
export function gateSatisfied(progress: WinConditionProgress): boolean {
  return progress.mode === "accumulate" && progress.met;
}

/**
 * Does this map still owe something beyond an ordinary clear?
 *
 * This is the board frame's whole state: one boolean, deliberately. A colour
 * per condition kind would be a language, and a language is learned by
 * repetition - three sightings across a 35-level run teaches nobody. "This map
 * is not a normal clear, and the extra part is still outstanding" is one thing
 * to learn, and the chips carry which and how far.
 */
export function hasOutstandingGate(spec: WinSpec, snap: WinSnapshot): boolean {
  return extraGates(spec, snap).some(p => !gateSatisfied(p));
}

/** i18n key for a gate's short chip label. */
export function gateLabelKey(condition: WinCondition): string {
  return `winGate.${condition.kind}`;
}

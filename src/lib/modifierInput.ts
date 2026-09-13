/**
 * What a Playground modifier field's text means as a number.
 *
 * A controlled `<input type="number">` whose value is the parsed number cannot
 * be emptied: clearing it yields "", parseFloat("") is NaN, the change is
 * dropped, and React writes the old "0" straight back. To type 25 you had to
 * put the caret behind the 0 and hope the browser did not read "025" oddly.
 *
 *   ""      -> 0     an empty field is a zero, so it can be cleared and retyped
 *   "12.5"  -> 12.5
 *   "-"     -> null  still typing: keep the text, do not touch the value
 */
export function parseModifierInput(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

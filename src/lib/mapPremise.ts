/**
 * A map's premise: what it is ABOUT, in one sentence, for the designer.
 *
 * The rule the field carries is that a map which cannot state its idea in one
 * sentence does not have one yet. So the check is on shape, not on wording:
 * present, one line, short enough to be a sentence rather than a paragraph.
 * See MAP_DESIGN_CARD.md for why it exists.
 */

/** Long enough for "the one where..." plus a clause; short enough to stay one idea. */
export const PREMISE_MAX_CHARS = 140;

/** What is wrong with a premise, or an empty list. */
export function premiseProblems(premise: string | undefined): string[] {
  const p = (premise ?? "").trim();
  if (p === "") return ["no premise: state what the map is about in one sentence"];
  const out: string[] = [];
  if (p.length > PREMISE_MAX_CHARS) out.push(`premise is ${p.length} characters; one sentence is at most ${PREMISE_MAX_CHARS}`);
  if (/\n/.test(p)) out.push("premise spans lines; it is one sentence");
  // More than one sentence: a full stop followed by more words.
  if (/[.!?]\s+\S/.test(p)) out.push("premise is more than one sentence");
  return out;
}

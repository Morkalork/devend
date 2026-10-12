/**
 * What BoardEntityInfoModal says about a held board object, apart from how it
 * is drawn, so the copy rules can be checked without a canvas.
 */
import type { TFunction } from "i18next";
import type { BoardEntityHit } from "@/lib/boardEntityInfo";
import { getBug } from "@/lib/bugs";

export interface BoardEntityCopy {
  title: string;
  /** "#rrggbb": the bug's own colour for a carrying shard, else the accent. */
  titleColor: string;
  /** The framing paragraph (for a shard, what a shard is). */
  body: string;
  /** A shard with a known bug inside: what it GIVES and what it COSTS. */
  bug?: {
    color: string;
    givesLabel: string;
    gives: string;
    costsLabel: string;
    costs: string;
    /** Only on a dangerous bug. */
    danger?: string;
  };
  hint: string;
}

export function boardEntityCopy(t: TFunction, hit: BoardEntityHit, accent: string): BoardEntityCopy {
  // A carrying shard names what is inside it. An unknown id falls through to
  // the generic strings rather than rendering a blank card: a bugs.yml a
  // deployed build could not fetch must still explain what the glow is.
  const bug = hit.kind === "bugShard" ? getBug(hit.detail) : undefined;
  const hint = t("boardInfo.hint") as string;
  if (!bug) {
    return {
      title: t(`boardInfo.${hit.kind}.title`) as string,
      titleColor: accent,
      // A bomb box on a map where it does not blast has its own body.
      body: t(`boardInfo.${hit.kind}.${hit.detail === "quiet" ? "bodyQuiet" : "body"}`) as string,
      hint,
    };
  }
  // Two labelled blocks, what it GIVES and what it COSTS: every bug in the pool
  // is double-edged, and run together into one paragraph the same words read
  // as a list of gifts. Copy from public/bugs.yml, beside the tuning it
  // describes, so a rebalanced bug cannot outlive its explanation.
  return {
    title: bug.name,
    titleColor: bug.color,
    body: t("boardInfo.bugShard.body") as string,
    bug: {
      color: bug.color,
      givesLabel: t("boardInfo.bugShard.gives") as string,
      gives: bug.description,
      costsLabel: t("boardInfo.bugShard.costs") as string,
      costs: bug.cost,
      danger: bug.danger ? t("boardInfo.bugShard.danger") as string : undefined,
    },
    hint,
  };
}

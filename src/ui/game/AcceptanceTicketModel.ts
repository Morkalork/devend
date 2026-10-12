/**
 * The ticket's rows and their marks (AcceptanceTicket.tsx), apart from the
 * drawing so the marks can be checked without a canvas.
 */
import { ArrowLeftRight, CircleX, Square, SquareCheckBig, SquareX, Split } from "lucide-react";
import type { CriterionGroup } from "@/lib/winConditions";
import { ROLE } from "../theme";
import type { IconSource } from "../kit/icons";

export interface TicketRow {
  group: CriterionGroup;
  text: string;
  /** Marked after the map: met, missed, or null for nothing to check. Absent before it. */
  met?: boolean | null;
}

/** Each group's checklist mark and ink, before the map: a box to tick, a fork, a trade, a failure. */
function groupLook(group: CriterionGroup, accent: number): { icon: IconSource; color: number } {
  switch (group) {
    case "either": return { icon: Split, color: accent };
    case "trade": return { icon: ArrowLeftRight, color: ROLE.hours };
    case "fail": return { icon: CircleX, color: ROLE.cost };
    default: return { icon: Square, color: accent };
  }
}

/** A row's mark: the result once there is one, else its group's glyph. */
export function rowLook(row: TicketRow, accent: number): { icon: IconSource; color: number; label: string } {
  if (row.met === true) return { icon: SquareCheckBig, color: ROLE.pass, label: "met" };
  if (row.met === false) return { icon: SquareX, color: ROLE.cost, label: "missed" };
  return { ...groupLook(row.group, accent), label: "open" };
}


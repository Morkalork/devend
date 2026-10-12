/**
 * The pre-map Acceptance Criteria as the map's ticket
 * (src/ui/game/AcceptanceCriteriaModal.tsx), and the grouping it draws from
 * (criteriaSections in src/lib/winConditions.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criteriaSections, type Criterion } from "@/lib/winConditions";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const heading = (group: string) => `${group}:`;

describe("criteriaSections", () => {
  const criteria: Criterion[] = [
    { group: "fail", text: "clock" },
    { group: "required", text: "clear" },
    { group: "optional", text: "pocket" },
    { group: "required", text: "par" },
  ];

  it("keeps the groups in the order the text list used", () => {
    expect(criteriaSections(criteria, heading).map(s => s.group)).toEqual(["required", "optional", "fail"]);
  });

  it("keeps each group's items in their own order", () => {
    expect(criteriaSections(criteria, heading)[0].items.map(i => i.text)).toEqual(["clear", "par"]);
  });

  // An empty group prints nothing, not "Optional: none" (renderCriteria's rule).
  it("leaves out empty groups", () => {
    expect(criteriaSections([{ group: "required", text: "clear" }], heading)).toHaveLength(1);
  });

  it("drops the trailing colon the text list needed", () => {
    expect(criteriaSections(criteria, heading)[0].heading).toBe("required");
  });

  it("passes the count, so a language can pluralise the goals heading", () => {
    const seen: number[] = [];
    criteriaSections(criteria, (g, n) => { seen.push(n); return g; });
    expect(seen).toEqual([2, 1, 1]);
  });
});

describe("the game opens it", () => {
  const game = read("src/components/game/GameScreen.tsx");

  it("draws the win modal as the ticket, with the same criteria the text list had", () => {
    expect(game).toContain("criteria: winConditions(t, level, levelNumber, activeModifiers),");
    expect(game).toContain("<AcceptanceCriteriaModal");
    expect(game).toContain("if (active?.criteria) {");
  });

  it("has Admin gallery entries", () => {
    const g = read("src/ui/dev/gallery/modals.tsx");
    expect(g).toContain('id: "AcceptanceCriteriaModal"');
    expect(g).toContain('id: "AcceptanceCriteriaModal-plain"');
  });
});

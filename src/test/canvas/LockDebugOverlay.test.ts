/**
 * The admin lock log's rows, as the DOM overlay printed them.
 */
import { describe, it, expect } from "vitest";
import type { LockDecision } from "@/lib/lockDiagnostics";
import { OUTCOME_COLOR, lockDecisionLine } from "@/ui/game/overlayModel";

const base: LockDecision = {
  ballId: "b1", ballColor: "red", isBoss: false, regionCells: 42, denominator: 900, percentage: 4.666,
  thresholdPercent: 5, lockedByPercent: true, lockedBySliver: false, containedInArea: false,
  trulySealed: true, area: null, outcome: "locked",
};

describe("lock decision rows", () => {
  it("prints the outcome, the pocket and the verdict on one line", () => {
    expect(lockDecisionLine(base)).toBe("LOCK  cells=42 den=900 4.67%<=5 seal=yes");
  });

  it("flags the skipped seal check, a failed seal and the extra reasons", () => {
    expect(lockDecisionLine({ ...base, trulySealed: null })).toContain("seal=skip");
    expect(lockDecisionLine({ ...base, outcome: "rejected-unsealed", trulySealed: false }))
      .toMatch(/^open {2}.*seal=NO$/);
    expect(lockDecisionLine({ ...base, outcome: "below-gate", lockedBySliver: true, containedInArea: true, isBoss: true }))
      .toMatch(/^big {3}.* sliver inArea boss$/);
  });

  it("colours each outcome as the DOM did", () => {
    expect(OUTCOME_COLOR.locked).toBe(0x6bffbc);
    expect(OUTCOME_COLOR["rejected-unsealed"]).toBe(0xffd54a);
    expect(OUTCOME_COLOR["below-gate"]).toBe(0x8899aa);
  });
});

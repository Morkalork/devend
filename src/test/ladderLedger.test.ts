/**
 * The mechanic ledger in MAP_DESIGN_GUIDELINES.md matches the maps.
 *
 * It did not, for a long time, and the failure was invisible in the worst way:
 * the table described a PLAN (mirror at 11, portal at 14, launcher at 16,
 * phasing at 26) while the maps were built to a different one (mirror 14,
 * portal 17, launcher 11, phasing 20). Both documents read as authoritative,
 * neither said which was stale, and a whole act was nearly rebuilt to match a
 * table that was itself the artifact.
 *
 * So the table is a claim the suite can falsify. It is prose, deliberately - a
 * generated list nobody writes is a list nobody reads - but the numbers in it
 * are now checked against public/map.yml on every run.
 *
 * When a mechanic moves, the map and this table change together. That is the
 * whole point: the cost of moving one is having to say so.
 *
 * THE LADDER IS BEING REBUILT, so most of the table is currently a promise
 * rather than a description: maps 11-35 were removed and are being reauthored
 * one at a time. That does not make the ledger unfalsifiable, it splits it in
 * two, and both halves are checked below against `LADDER_END`:
 *
 *   meet <= LADDER_END   the map exists, so the number must be exactly right
 *   meet >  LADDER_END   the map does not exist, so the mechanic must be on NO
 *                        map at all
 *
 * The second half is not a placeholder. It catches a mechanic quietly landing
 * on an act I map ahead of its scheduled debut, which is the thing act I was
 * just rebuilt to stop, and it re-arms into the first half by itself as each
 * map lands.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { MECHANICS } from "@/lib/admin/mechanicSpread";
import { LADDER, LADDER_END } from "./fixtures/maps";

const LEVELS = LADDER;
const DOC = readFileSync(resolve(process.cwd(), "MAP_DESIGN_GUIDELINES.md"), "utf8");

/** Every map a mechanic appears on, lowest first. */
const mapsFor = (label: string): number[] => {
  const m = MECHANICS.find(x => x.label === label);
  if (!m) return [];
  return LEVELS.filter(l => l.level != null && m.detect(l)).map(l => l.level as number)
    .sort((a, b) => a - b);
};

/** The ledger rows, parsed out of the markdown table. */
interface Row { mechanic: string; status: string; meet: string; use: string }
const ROWS: Row[] = DOC
  .slice(DOC.indexOf("| mechanic | family | status |"))
  .split("\n")
  .slice(2)                                  // header + separator
  // takeWhile, NOT filter. Filtering collected every pipe-delimited line in the
  // REST OF THE DOCUMENT, so any later table with seven or more cells was read
  // as ledger rows: a four-row table of kick values in the level 15 entry
  // arrived here as mechanics called "1.05" and "1.25" and failed this file
  // with "the ledger names a mechanic the engine does not". The ledger is one
  // contiguous table and stops at the first line that is not part of it.
  .reduce<string[]>((rows, line) => {
    if (rows.at(-1) === null as unknown as string) return rows;
    if (!line.startsWith("|")) { rows.push(null as unknown as string); return rows; }
    rows.push(line);
    return rows;
  }, [])
  .filter((l): l is string => l !== null)
  .map(l => l.split("|").map(c => c.trim()))
  .filter(c => c.length >= 7)
  .map(c => ({ mechanic: c[1], status: c[3], meet: c[4], use: c[5] }));

/** The ledger's own name for a mechanic, mapped to mechanicSpread's label. */
const LABEL: Record<string, string> = {
  "colored area (bonus)": "Colored area", mover: "Mover", breakable: "Breakable",
  chest: "Chest", reveals: "Reveals", "pickup spots": "Pickup spots",
  launcher: "Launcher", bumper: "Bumper", deformable: "Deformable",
  phasing: "Phasing", rotor: "Rotor", mirror: "Mirror", terminals: "Terminals",
  portal: "Portal", "WIP limit": "WIP limit", cage: "Cage",
  "thread lock": "Thread lock", "gravity well": "Gravity well",
  "one-way": "One-way", "delivery box": "Delivery box",
  "fence ground": "Fence ground", charge: "Charge", latch: "Latch",
  "data stream": "Data stream", "ball gate": "Ball gate",
  "pinned mutator": "Pinned mutator", "bent shape": "Bent shape",
  "polygon shape": "Polygon",
  "live outer walls": "Live outer walls",
};

describe("the ledger describes the maps that exist", () => {
  it("parsed the table at all", () => {
    // A silent parse failure would make every check below vacuous, which is
    // the exact failure mode this file exists to end.
    expect(ROWS.length, "the ledger table moved or changed shape")
      .toBeGreaterThan(25);
    expect(ROWS.map(r => r.mechanic)).toContain("mirror");
  });

  const checkable = ROWS.filter(r => LABEL[r.mechanic]);

  it("names a mechanic this codebase has", () => {
    // Every row except the roster note should resolve. A row naming something
    // mechanicSpread does not know is a mechanic that was renamed or removed.
    const unknown = ROWS.map(r => r.mechanic)
      .filter(m => !LABEL[m] && m !== "colored area (gate)" && m !== "the second ball");
    expect(unknown, "the ledger names a mechanic the engine does not").toEqual([]);
  });

  it.each(checkable.map(r => [r.mechanic, r] as const))(
    "%s meets where the ledger says", (_m, row) => {
      const on = mapsFor(LABEL[row.mechanic]);
      if (row.meet === "-") {
        expect(on, `${row.mechanic} is on maps but the ledger says none`).toEqual([]);
        return;
      }
      if (Number(row.meet) > LADDER_END) {
        // Scheduled for a map that has not been rebuilt yet. Being on a map
        // anyway means it debuted early, on a map act I owns.
        expect(on, `${row.mechanic} is scheduled for ${row.meet} but already on `
          + `${on.join(", ")}, which is ahead of its debut`).toEqual([]);
        return;
      }
      expect(on[0], `${row.mechanic} first appears on ${on[0] ?? "no map"}`)
        .toBe(Number(row.meet));
    });

  it.each(checkable
    .filter(r => /^\d+$/.test(r.use) && Number(r.use) <= LADDER_END)
    .map(r => [r.mechanic, r] as const))(
    "%s is used again where the ledger says", (_m, row) => {
      expect(mapsFor(LABEL[row.mechanic]), `${row.mechanic}'s second map`)
        .toContain(Number(row.use));
    });

  it("marks the unplaced ones as seasoning, not as Meets with no map", () => {
    // The honest way off the unused list. A mechanic no map can be ABOUT gets
    // `headline: false`; what it must never get is a token home invented to
    // satisfy a table.
    for (const row of checkable.filter(r => r.meet === "-")) {
      const m = MECHANICS.find(x => x.label === LABEL[row.mechanic]);
      expect(m?.headline, `${row.mechanic} is unplaced but still headline`).toBe(false);
      expect(row.status, `${row.mechanic} is unplaced but not seasoning`).toBe("Seasoning");
    }
  });
});

describe("nobody meets a mechanic during a boss fight", () => {
  it("introduces nothing new on 10, 20, 30 or 35", () => {
    // Phasing did exactly this: it shipped on 20, 28 and 35, so a player's
    // first encounter with a wall that is not always there was mid-boss - where
    // the map is already asking for everything they have and an obstacle going
    // intangible reads as the game glitching.
    const debuts = new Map<number, string[]>();
    for (const m of MECHANICS.filter(x => x.headline)) {
      const on = LEVELS.filter(l => l.level != null && m.detect(l)).map(l => l.level as number);
      if (on.length === 0) continue;
      const first = Math.min(...on);
      if (!debuts.has(first)) debuts.set(first, []);
      debuts.get(first)!.push(m.label);
    }
    for (const boss of [10, 20, 30, 35].filter(b => b <= LADDER_END)) {
      expect(debuts.get(boss) ?? [], `level ${boss} is a boss and teaches something new`)
        .toEqual([]);
    }
  });
});

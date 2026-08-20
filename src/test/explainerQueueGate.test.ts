/**
 * Every modal in GameScreen's explainer queue must be listed in the flag that
 * gates the queue.
 *
 * The queue renders only when `anyExplainerModal` is true, and that same flag
 * pauses the game behind whatever is showing. A modal present in the queue but
 * missing from the flag fails twice over:
 *
 *   1. When it is the ONLY modal waiting, the queue never renders, so it never
 *      appears at all. It looks shipped and is not.
 *   2. Because it never renders, nothing dismisses it, so its open flag stays
 *      true. The next time some OTHER modal flips the flag on, the forgotten
 *      one is still in the queue and, being earlier, jumps in front of that
 *      map's own explainer. It ambushes a later map, looking like a tutorial
 *      that will not stay dismissed.
 *
 * The ascension announcement shipped with exactly that bug. This is a source
 * check rather than a render test because the failure is structural: the two
 * lists have to agree, and nothing in the type system makes them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../components/game/GameScreen.tsx"), "utf8",
);

/** The `show:` expressions inside the queue literal. */
function queueShowFlags(): string[] {
  const start = SRC.indexOf("const queue: Explainer[] = [");
  expect(start, "explainer queue not found: has it been renamed?").toBeGreaterThan(-1);
  const end = SRC.indexOf("const active = queue.find", start);
  expect(end, "end of the explainer queue not found").toBeGreaterThan(start);

  const body = SRC.slice(start, end);
  const flags: string[] = [];
  for (const m of body.matchAll(/show:\s*([^,\n]+)/g)) {
    // Take the identifiers out of expressions like `ascModalOpen && !paused`.
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (!["true", "false", "undefined", "null"].includes(id[0])) flags.push(id[0]);
    }
  }
  return [...new Set(flags)];
}

/** The identifiers making up the anyExplainerModal expression. */
function gateFlags(): string[] {
  const m = SRC.match(/const anyExplainerModal\s*=\s*([\s\S]*?);/);
  expect(m, "anyExplainerModal not found: has it been renamed?").toBeTruthy();
  return [...new Set(
    [...m![1].matchAll(/[A-Za-z_$][\w$]*/g)].map(x => x[0]),
  )];
}

describe("the explainer queue and the flag that gates it", () => {
  it("finds both lists, so a rename cannot quietly disable this test", () => {
    expect(queueShowFlags().length).toBeGreaterThanOrEqual(5);
    expect(gateFlags().length).toBeGreaterThanOrEqual(5);
  });

  it("gates on every flag the queue can show on", () => {
    const gate = new Set(gateFlags());
    const missing = queueShowFlags().filter(f => !gate.has(f));
    expect(
      missing,
      `these modals can never show on their own, and will ambush a later map: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("includes the ascension announcement, which shipped without it", () => {
    expect(gateFlags()).toContain("ascModalOpen");
  });
});

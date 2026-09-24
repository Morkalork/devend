/**
 * A board with full-map gravity says so, in the words a player reads first.
 *
 * Level 19 was reported as "unclear, needs a better warning about full
 * gravity". The banner that announces a map's rule shows the rule's NAME in
 * its largest type, and the name was "Standup": a flavour word that says
 * nothing about falling, on the map that combines the pull with four patrol
 * bars. The turn warning was a second and a half, too short to hold a cut.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { URGENT_SECONDS } from "@/lib/rendering/sleek/gravityCue";

const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/mapMutators.yml"), "utf8")) as {
  mutators: Array<{ id: string; name: string; description: string; behavior: string }>;
};
const gravity = doc.mutators.filter(m => m.behavior === "gravity");

describe("full-map gravity announces itself", () => {
  it("has at least one full-gravity rule to check", () => {
    expect(gravity.length).toBeGreaterThan(0);
  });

  it("names gravity in the rule's name, not a flavour word", () => {
    for (const m of gravity) expect(m.name, m.id).toMatch(/gravity/i);
  });

  it("says that everything falls, and that the pull turns", () => {
    for (const m of gravity) {
      expect(m.description, m.id).toMatch(/fall/i);
      expect(m.description, m.id).toMatch(/turn/i);
    }
  });

  it("warns of each turn long enough to hold a cut", () => {
    expect(URGENT_SECONDS).toBeGreaterThanOrEqual(3);
  });
});

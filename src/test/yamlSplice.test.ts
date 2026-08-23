/**
 * Saving one level from the Playground must not delete the rest of map.yml's
 * comments.
 *
 * The editor used to parse map.yml, edit the object and dump the whole document
 * back. js-yaml keeps no comments, so every save silently deleted the schema
 * header, the per-map design notes and the LEVELDESIGN.md cross-references.
 * Nothing complained, because the game loads a comment-free file perfectly well.
 *
 * The splice replaces only the edited entry's lines. Comments inside that entry
 * are still lost (it is regenerated from a plain object), but the blast radius
 * drops from the file to one level.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { spliceYamlEntry, spliceYamlEntries, findEntryRange } from "@/lib/yamlSplice";

const DOC = [
  "# map.yml - the level list.",
  "# Every map follows the three conventions in LEVELDESIGN.md.",
  "",
  "levels:",
  "  # The onboarding map: one ball, no obstacles.",
  "  - id: level-1",
  "    level: 1",
  "    points: 20",
  "",
  "  # The Turn arrives here: the map stops being a straight clear.",
  "  - id: level-2",
  "    level: 2",
  "    points: 20",
  "",
  "  - id: level-3",
  "    level: 3",
  "    points: 25",
  "",
].join("\n");

describe("finding an entry", () => {
  const lines = DOC.split("\n");

  it("locates a level by id", () => {
    const r = findEntryRange(lines, "id", "level-2")!;
    expect(r).toBeTruthy();
    expect(lines[r.start].trim()).toBe("- id: level-2");
  });

  it("stops before the comment introducing the next level", () => {
    const r = findEntryRange(lines, "id", "level-1")!;
    // The range must not swallow level-2's comment, or saving level 1 eats it.
    const swallowed = lines.slice(r.start, r.end).join("\n");
    expect(swallowed).not.toContain("The Turn arrives here");
  });

  it("returns null for a level that is not there", () => {
    expect(findEntryRange(lines, "id", "level-99")).toBeNull();
  });

  /** Two entries with the same id means the file is not what we think it is. */
  it("refuses an ambiguous match rather than picking one", () => {
    const dupe = DOC + "  - id: level-2\n    level: 9\n";
    expect(findEntryRange(dupe.split("\n"), "id", "level-2")).toBeNull();
  });
});

describe("splicing an entry back in", () => {
  const replacement = "  - id: level-2\n    level: 2\n    points: 99\n";

  it("keeps every comment in the file", () => {
    const out = spliceYamlEntry(DOC, "id", "level-2", replacement)!;
    expect(out).toContain("# map.yml - the level list.");
    expect(out).toContain("# Every map follows the three conventions");
    expect(out).toContain("# The onboarding map: one ball, no obstacles.");
    expect(out).toContain("# The Turn arrives here");
  });

  it("applies the edit", () => {
    const out = spliceYamlEntry(DOC, "id", "level-2", replacement)!;
    const parsed = yaml.load(out) as { levels: { id: string; points: number }[] };
    expect(parsed.levels.find(l => l.id === "level-2")!.points).toBe(99);
  });

  it("leaves the other levels untouched", () => {
    const out = spliceYamlEntry(DOC, "id", "level-2", replacement)!;
    const parsed = yaml.load(out) as { levels: { id: string; points: number }[] };
    expect(parsed.levels.map(l => l.id)).toEqual(["level-1", "level-2", "level-3"]);
    expect(parsed.levels.find(l => l.id === "level-1")!.points).toBe(20);
    expect(parsed.levels.find(l => l.id === "level-3")!.points).toBe(25);
  });

  it("still produces loadable YAML when editing the last entry", () => {
    const out = spliceYamlEntry(DOC, "id", "level-3", "  - id: level-3\n    level: 3\n    points: 40\n")!;
    const parsed = yaml.load(out) as { levels: { id: string; points: number }[] };
    expect(parsed.levels).toHaveLength(3);
    expect(parsed.levels[2].points).toBe(40);
  });

  it("preserves CRLF, so a save is not a whole-file diff", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    const out = spliceYamlEntry(crlf, "id", "level-2", replacement)!;
    expect(out).toContain("\r\n");
    expect(out.split("\r\n").length).toBeGreaterThan(10);
  });

  it("returns null rather than mangling the file when the level is missing", () => {
    expect(spliceYamlEntry(DOC, "id", "level-99", replacement)).toBeNull();
  });
});

// ── Against the real file ───────────────────────────────────────────────────

describe("the real map.yml", () => {
  const RAW = readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8");
  const parsed = yaml.load(RAW) as { levels: Record<string, unknown>[] };

  it("has comments worth protecting", () => {
    expect(RAW.split("\n").filter(l => l.trim().startsWith("#")).length)
      .toBeGreaterThan(10);
  });

  it("can locate every level it defines", () => {
    const lines = RAW.split(/\r?\n/);
    const missing = parsed.levels
      .map(l => String(l.id))
      .filter(id => findEntryRange(lines, "id", id) === null);
    expect(missing, `could not locate: ${missing.join(", ")}`).toEqual([]);
  });

  /**
   * The end-to-end property: round-tripping a level through the editor changes
   * that level and nothing else, and the file still parses.
   */
  it("round-trips a level without losing comments or other levels", () => {
    const target = parsed.levels[2];
    const edited = { ...target, points: 4242 };
    const entry = yaml.dump([edited], { indent: 2, lineWidth: -1, noRefs: true })
      .split("\n").map(l => (l ? "  " + l : l)).join("\n");

    const out = spliceYamlEntry(RAW, "id", String(target.id), entry)!;
    expect(out).toBeTruthy();

    const after = yaml.load(out) as { levels: Record<string, unknown>[] };
    expect(after.levels).toHaveLength(parsed.levels.length);
    expect(after.levels[2].points).toBe(4242);
    expect(after.levels.map(l => l.id)).toEqual(parsed.levels.map(l => l.id));

    // The header comment, and the comment count outside the edited level, hold.
    // Both sides split the same way: map.yml is CRLF, and splitting one on a
    // bare newline leaves a trailing CR that makes an identical line differ.
    expect(out.split(/\r?\n/)[0]).toBe(RAW.split(/\r?\n/)[0]);
    const commentsIn = (s: string) => s.split(/\r?\n/).filter(l => l.trim().startsWith("#")).length;
    expect(commentsIn(out)).toBeGreaterThanOrEqual(commentsIn(RAW) - commentsIn(entry) - 2);
  });
});

/**
 * Saving several levels at once, which is what the Map Builder does.
 *
 * The builder holds the whole ladder in memory and used to save it with one
 * `yaml.dump({ levels })`. That rewrote all 40 entries and deleted all 269
 * comment lines in map.yml: the act headers, the per-map design notes, the
 * LEVELDESIGN.md cross-references. Moving one wall cost the file's entire
 * commentary, and nothing complained because the game loads a comment-free
 * map.yml perfectly well. It is how the file got flattened once already.
 */
describe("splicing several entries at once", () => {
  const RAW = readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8");
  const commentLines = (text: string) =>
    text.split(/\r?\n/).filter(l => l.trim().startsWith("#")).length;

  const entryFor = (id: string, extra: Record<string, unknown>) => {
    const doc = yaml.load(RAW) as { levels: Record<string, unknown>[] };
    const level = { ...doc.levels.find(l => l.id === id)!, ...extra };
    return yaml.dump([level], { indent: 2, lineWidth: -1, noRefs: true })
      .split("\n").map(l => (l ? "  " + l : l)).join("\n");
  };

  const twoEdits = () => [
    { value: "level-1", entry: entryFor("level-1", { points: 21 }) },
    { value: "level-3", entry: entryFor("level-3", { points: 22 }) },
  ];

  it("keeps every comment when several levels change", () => {
    const out = spliceYamlEntries(RAW, "id", twoEdits())!;
    expect(out, "splice should have succeeded").toBeTruthy();
    expect(commentLines(out)).toBe(commentLines(RAW));
  });

  it("applies all of them, not just the first", () => {
    const out = spliceYamlEntries(RAW, "id", twoEdits())!;
    const levels = (yaml.load(out) as { levels: Record<string, unknown>[] }).levels;
    expect(levels.find(l => l.id === "level-1")!.points).toBe(21);
    expect(levels.find(l => l.id === "level-3")!.points).toBe(22);
  });

  it("leaves the levels it was not asked about untouched", () => {
    const out = spliceYamlEntries(RAW, "id", [twoEdits()[0]])!;
    const before = (yaml.load(RAW) as { levels: Record<string, unknown>[] }).levels;
    const after = (yaml.load(out) as { levels: Record<string, unknown>[] }).levels;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      if (before[i].id === "level-1") continue;
      expect(after[i], `level ${before[i].id}`).toEqual(before[i]);
    }
  });

  it("refuses the whole batch rather than writing it half applied", () => {
    expect(spliceYamlEntries(RAW, "id", [
      twoEdits()[0],
      { value: "level-99", entry: "  - id: level-99" },
    ])).toBeNull();
  });

  it("is a no-op for an empty batch", () => {
    expect(spliceYamlEntries(RAW, "id", [])).toBe(RAW);
  });
});

/**
 * The builder is the caller that flattened the file, so check the call site and
 * not only the helper. A perfect splice function is worth nothing if Save still
 * dumps the document, which is exactly the state this was found in.
 */
describe("the Map Builder saves by splicing", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/MapBuilder.tsx"), "utf8",
  );
  const saveYaml = SRC.slice(SRC.indexOf("const saveYaml"), SRC.indexOf("const saveToServer"));

  it("routes Save through the splice, not a whole-document dump", () => {
    expect(saveYaml).toMatch(/spliceYamlEntries/);
    expect(SRC).toMatch(/const yamlContent = saveYaml\(\);/);
  });

  it("only rewrites the levels that actually changed", () => {
    expect(saveYaml).toMatch(/originalLevels/);
    expect(saveYaml).toMatch(/changed/);
  });

  it("still has a full dump to fall back on", () => {
    expect(saveYaml).toMatch(/fullDump\(\)/);
  });
});

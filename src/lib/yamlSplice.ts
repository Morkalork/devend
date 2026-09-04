/**
 * Replace one entry of a YAML sequence in place, leaving the rest of the file
 * byte-identical.
 *
 * The Playground's map editor used to save by parsing map.yml, editing the
 * object and dumping the whole thing back. js-yaml keeps no comments, so every
 * save silently deleted the entire file's commentary: the header explaining the
 * schema, the notes on why a map is tuned the way it is, the MAP_DESIGN_GUIDELINES.md
 * cross-references. Editing one field of one level cost all of it, and because
 * the game still loaded fine, nothing complained.
 *
 * So: find the edited entry's line range and splice the newly dumped entry over
 * exactly that, touching nothing else. Comments inside the edited entry are
 * still lost, which is unavoidable when that entry is regenerated from a plain
 * object, but the blast radius drops from the file to one level.
 *
 * Falls back to returning null when the entry cannot be located unambiguously,
 * so the caller can dump the whole document rather than write a mangled file.
 */

/** Lines that open a sequence entry at `indent`, e.g. "  - id: level-3". */
function isEntryStart(line: string, indent: number): boolean {
  return line.startsWith(" ".repeat(indent) + "- ") ||
         line.trimEnd() === " ".repeat(indent) + "-";
}

/**
 * The [start, end) line range of the sequence entry whose `key: value` matches,
 * or null when it is missing or appears more than once.
 *
 * Ambiguity is treated as failure on purpose: two entries with the same id means
 * the file is not what the caller thinks it is, and picking one at random is how
 * an editor overwrites the wrong level.
 */
export function findEntryRange(
  lines: string[], key: string, value: string, indent = 2,
): { start: number; end: number } | null {
  const pad = " ".repeat(indent);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isEntryStart(lines[i], indent)) continue;
    starts.push(i);
  }
  if (starts.length === 0) return null;

  const matches: number[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    // The entry's own keys sit either on the "- " line or indented beneath it.
    const needleInline = `${pad}- ${key}: ${value}`;
    const needleBelow = `${pad}  ${key}: ${value}`;
    for (let i = from; i < to; i++) {
      const line = lines[i].trimEnd();
      if (line === needleInline || line === needleBelow) { matches.push(s); break; }
    }
  }
  if (matches.length !== 1) return null;

  const s = matches[0];
  const start = starts[s];
  let end = s + 1 < starts.length ? starts[s + 1] : lines.length;

  // A comment block sitting directly above the NEXT entry belongs to that
  // entry, not to this one, so leave it outside the replaced range. Without
  // this, saving level 3 eats the comment introducing level 4.
  if (s + 1 < starts.length) {
    while (end - 1 > start) {
      const prev = lines[end - 1].trim();
      if (prev.startsWith("#") || prev === "") end--;
      else break;
    }
  }
  return { start, end };
}

/**
 * Splice `replacement` (a full YAML sequence entry, already indented) over the
 * matching entry in `original`. Returns null when the entry is not found
 * unambiguously, leaving the fallback to the caller.
 */
export function spliceYamlEntry(
  original: string, key: string, value: string, replacement: string, indent = 2,
): string | null {
  // Preserve the file's own line endings: rewriting a CRLF file as LF shows up
  // as a whole-file diff and buries the one line that actually changed.
  const crlf = original.includes("\r\n");
  const lines = original.split(/\r?\n/);
  const range = findEntryRange(lines, key, value, indent);
  if (!range) return null;

  const replacementLines = replacement.replace(/\s+$/, "").split(/\r?\n/);
  const next = [
    ...lines.slice(0, range.start),
    ...replacementLines,
    ...lines.slice(range.end),
  ];
  return next.join(crlf ? "\r\n" : "\n");
}

/**
 * Splice several entries in one pass, newest content over the oldest file.
 *
 * The Map Builder holds the WHOLE ladder in memory and used to save it with a
 * single `yaml.dump({ levels })`, which meant every save rewrote all 40 entries
 * and deleted all 269 comment lines: the act headers, the per-map design notes,
 * the MAP_DESIGN_GUIDELINES.md cross-references. It cost the file's entire commentary to
 * nudge one wall, and nothing complained because the game loads a comment-free
 * file perfectly well.
 *
 * Splicing only the entries that actually changed keeps the diff to the levels
 * you touched and leaves every comment outside them alone. Returns null if any
 * one of them cannot be located unambiguously, so the caller still has the
 * whole-file dump to fall back on rather than writing something half-spliced.
 */
export function spliceYamlEntries(
  original: string,
  key: string,
  replacements: Array<{ value: string; entry: string }>,
  indent = 2,
): string | null {
  let out = original;
  for (const { value, entry } of replacements) {
    const next = spliceYamlEntry(out, key, value, entry, indent);
    if (next === null) return null;
    out = next;
  }
  return out;
}

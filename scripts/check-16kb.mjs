#!/usr/bin/env node
/**
 * Google Play's 16 KB page-size rule, checked on a built AAB or APK.
 *
 * An app targeting Android 15+ that ships native code must have every shared
 * library's LOAD segments aligned to at least 16 KB, or Play refuses the
 * upload (and the app crashes on a 16 KB-page phone). The Android Gradle
 * Plugin (8.5.1+) takes care of how the libraries sit in the zip; what it
 * cannot fix is a library that was itself linked for 4 KB pages. This reads
 * each .so's ELF program headers and fails on any LOAD segment aligned below
 * 16 KB. An app with no native code passes, and says so.
 *
 *   node scripts/check-16kb.mjs app-release.aab
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGE = 16 * 1024;
const PT_LOAD = 1;

/** Every LOAD segment's alignment in an ELF file, or null if it is not ELF. */
export function loadAlignments(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
  const is64 = buf[4] === 2;
  const le = buf[5] === 1;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = (o) => Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o));
  const phoff = is64 ? u64(0x20) : u32(0x1c);
  const phentsize = u16(is64 ? 0x36 : 0x2a);
  const phnum = u16(is64 ? 0x38 : 0x2c);
  const out = [];
  for (let i = 0; i < phnum; i++) {
    const h = phoff + i * phentsize;
    if (u32(h) !== PT_LOAD) continue;
    out.push(is64 ? u64(h + 0x30) : u32(h + 0x1c));
  }
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const target = process.argv[2];
if (!target) {
  console.error("usage: check-16kb.mjs <app.aab|app.apk>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "16kb-"));
try {
  execFileSync("unzip", ["-q", "-o", target, "*.so", "-d", dir], { stdio: "ignore" });
} catch {
  // unzip exits non-zero when nothing matches: no native code to extract.
}
const libs = walk(dir).filter((p) => p.endsWith(".so"));
if (libs.length === 0) {
  console.log("16 KB pages: no native libraries in the package, nothing to align.");
  process.exit(0);
}
let bad = 0;
for (const lib of libs) {
  const aligns = loadAlignments(readFileSync(lib)) ?? [];
  const worst = Math.min(...aligns);
  const ok = aligns.length > 0 && worst >= PAGE;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${lib.slice(dir.length + 1)} (LOAD alignment ${worst})`);
}
if (bad) {
  console.error(`16 KB pages: ${bad} of ${libs.length} native libraries are aligned below 16 KB.`);
  process.exit(1);
}
console.log(`16 KB pages: all ${libs.length} native libraries are aligned to 16 KB or more.`);

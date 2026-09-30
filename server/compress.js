/**
 * Compressed responses for the static files.
 *
 * `serve -s dist`, which this server replaced, gzipped everything it sent.
 * The replacement did not, and nobody noticed on a desktop connection. On a
 * phone it is the whole wait before the first screen: the main bundle is
 * 1.76 MB raw and the page cannot draw anything until it has arrived. Measured
 * on an emulated 3G link, that was 8.9 s of a 10.4 s wait for "Tap to start".
 * Brotli takes the bundle to about 0.5 MB.
 *
 * Still zero dependencies: node:zlib does both encodings. Each file is
 * compressed once and kept in memory, keyed on its mtime, so the cost is paid
 * on the first request after a deploy (about 0.2 s for the main bundle) and
 * never again. warmCompressedCache pays even that at boot, in the background.
 */
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Text formats worth compressing. Images, audio and woff2 are compressed already. */
const COMPRESSIBLE = new Set([
  ".html", ".js", ".css", ".json", ".yml", ".yaml", ".svg", ".ttf", ".ico", ".md", ".txt",
]);

/** Below this the headers cost more than the saving. */
export const MIN_COMPRESS_BYTES = 1024;

/**
 * The encoding to answer an Accept-Encoding header with: brotli when offered,
 * then gzip, else none. An explicit q=0 is a refusal, not an offer.
 */
export function pickEncoding(acceptEncoding) {
  const offered = new Set();
  for (const part of String(acceptEncoding || "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";").map(s => s.trim());
    if (!name) continue;
    const q = params.find(p => p.startsWith("q="));
    if (q && Number(q.slice(2)) === 0) continue;
    offered.add(name);
  }
  if (offered.has("br")) return "br";
  if (offered.has("gzip")) return "gzip";
  return null;
}

/** Whether a file of this name and size is sent compressed at all. */
export function isCompressible(filePath, size) {
  return size >= MIN_COMPRESS_BYTES && COMPRESSIBLE.has(extname(filePath).toLowerCase());
}

/** filePath|encoding -> { mtimeMs, body }. Promises, so concurrent first requests share one job. */
const cache = new Map();

function encode(body, encoding) {
  return encoding === "br"
    // Quality 9: within 10% of the maximum's size at a twentieth of its time.
    ? brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
    : gz(body, { level: 9 });
}

/**
 * The compressed bytes of a file, from the cache when the file has not changed
 * since. `raw` is the file's content when the caller already has it.
 */
export async function compressedBody(filePath, mtimeMs, encoding, raw) {
  const key = `${filePath}|${encoding}`;
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit.body;
  const body = (async () => encode(raw ?? await readFile(filePath), encoding))();
  cache.set(key, { mtimeMs, body });
  try {
    return await body;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

/**
 * Compress everything compressible under `dir` now, one file at a time, so the
 * first phone to load the page after a deploy does not wait on it. zlib runs
 * off the event loop, so requests are answered meanwhile. Never throws.
 */
export async function warmCompressedCache(dir) {
  let files = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      try {
        const info = await stat(p);
        if (!isCompressible(p, info.size)) continue;
        await compressedBody(p, info.mtimeMs, "br");
        await compressedBody(p, info.mtimeMs, "gzip");
        files++;
      } catch { /* a file that vanished or will not compress is served raw */ }
    }
  };
  await walk(dir);
  return files;
}

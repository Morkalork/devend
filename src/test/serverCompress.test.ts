/**
 * The server compresses what it sends (server/compress.js).
 *
 * Reported from a phone on staging: "a long loading period before the Tap To
 * Start screen shows". The page cannot draw anything until the main bundle has
 * arrived, and the server that replaced `serve -s dist` sent it raw: 1.76 MB,
 * where `serve` had gzipped it. On an emulated 3G link the gate took 10.4 s,
 * 8.9 s of it that one file. Compressed it is about 0.5 MB and the gate shows
 * at 3.9 s.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import {
  pickEncoding, isCompressible, compressedBody, warmCompressedCache, MIN_COMPRESS_BYTES,
} from "../../server/compress.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const dir = mkdtempSync(join(tmpdir(), "devend-compress-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Text that compresses the way a bundle does: long and repetitive. */
const bundleLike = Buffer.from("export function f(){return 'syntax area';}\n".repeat(2000));

describe("choosing an encoding", () => {
  it("prefers brotli, then gzip, as every phone browser offers both", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
  });

  it("sends raw to a client that offers neither", () => {
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding("")).toBeNull();
    expect(pickEncoding("identity")).toBeNull();
  });

  it("reads q=0 as a refusal, not an offer", () => {
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0")).toBeNull();
    expect(pickEncoding("BR;q=0.5")).toBe("br");
  });
});

describe("what gets compressed", () => {
  it("compresses the text the first screen waits on", () => {
    for (const f of ["assets/index-abc.js", "assets/index-abc.css", "index.html", "map.yml", "assets/Michroma-Regular.ttf"]) {
      expect(isCompressible(f, 50_000), f).toBe(true);
    }
  });

  it("leaves formats that are compressed already, and tiny files, alone", () => {
    for (const f of ["assets/music/main.mp3", "icon.png", "photo.webp", "font.woff2"]) {
      expect(isCompressible(f, 50_000), f).toBe(false);
    }
    expect(isCompressible("tiny.js", MIN_COMPRESS_BYTES - 1)).toBe(false);
  });
});

describe("the compressed bytes", () => {
  it("decompress to exactly the file, in both encodings, and are much smaller", async () => {
    const f = join(dir, "bundle.js");
    writeFileSync(f, bundleLike);
    const { mtimeMs } = statSync(f);
    const br = await compressedBody(f, mtimeMs, "br");
    const gz = await compressedBody(f, mtimeMs, "gzip");
    expect(brotliDecompressSync(br).equals(bundleLike)).toBe(true);
    expect(gunzipSync(gz).equals(bundleLike)).toBe(true);
    expect(br.length).toBeLessThan(bundleLike.length / 10);
  });

  it("compresses a file once, and again only when it has changed", async () => {
    const f = join(dir, "cached.js");
    writeFileSync(f, bundleLike);
    const first = await compressedBody(f, statSync(f).mtimeMs, "br");
    expect(await compressedBody(f, statSync(f).mtimeMs, "br")).toBe(first);

    // A redeploy replaces the file; a stale cache would serve the old build.
    const next = Buffer.from("export const changed = true;\n".repeat(500));
    writeFileSync(f, next);
    utimesSync(f, new Date(), new Date(Date.now() + 5000));
    const again = await compressedBody(f, statSync(f).mtimeMs, "br");
    expect(brotliDecompressSync(again).equals(next)).toBe(true);
  });

  it("warms the whole build at boot, skipping what it should not touch", async () => {
    const build = join(dir, "dist");
    mkdirSync(join(build, "assets"), { recursive: true });
    writeFileSync(join(build, "index.html"), bundleLike);
    writeFileSync(join(build, "assets", "index-x.js"), bundleLike);
    writeFileSync(join(build, "assets", "track.mp3"), bundleLike);
    writeFileSync(join(build, "assets", "small.js"), "x");
    expect(await warmCompressedCache(build)).toBe(2);
    expect(await warmCompressedCache(join(dir, "missing"))).toBe(0);
  });
});

describe("the wiring", () => {
  const server = read("server/index.js");

  it("sends every static file through the compressing path", () => {
    expect(server).toMatch(/async function sendFile\(req, res, filePath\)/);
    expect(server).toMatch(/sendFile\(req, res, target\)/);
    expect(server).toMatch(/sendFile\(req, res, join\(DIST, "index\.html"\)\)/);
    expect(server).not.toMatch(/sendFile\(res,/);
  });

  it("labels the encoding and varies on it", () => {
    expect(server).toMatch(/headers\["Content-Encoding"\] = encoding/);
    expect(server).toMatch(/headers\["Vary"\] = "Accept-Encoding"/);
  });

  it("compresses the build at boot, not on the first phone's request", () => {
    expect(server).toMatch(/warmCompressedCache\(DIST\)/);
  });

  it("stays dependency-free", () => {
    // The server's whole point was replacing `serve` without adding Express.
    const src = read("server/compress.js");
    for (const m of src.matchAll(/from "([^"]+)"/g)) expect(m[1]).toMatch(/^node:/);
  });
});

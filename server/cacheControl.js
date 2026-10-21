/**
 * How long a browser may keep a static file.
 *
 * Vite's own output is content-hashed (assets/index-B2XXrCRd.js): a changed
 * file gets a new name, so the old one can be kept for a year without asking.
 * Everything under public/ is copied as is, and the music and fonts sit under
 * /assets/ too, at FIXED names. They used to get the same year-long
 * `immutable`, so replacing a track or a face left every returning player on
 * the old copy for up to a year. They get a day now, and the HTML and the YAML
 * (map.yml has to be re-read after a save) are revalidated every time.
 */

/** A Vite build file: directly in assets/, with a content hash before the extension. */
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** @param {string} filePath */
export function cacheControlFor(filePath) {
  const p = filePath.replace(/\\/g, "/");
  if (HASHED.test(p)) return "public, max-age=31536000, immutable";
  if (p.includes("/assets/")) return "public, max-age=86400";
  return "no-cache";
}

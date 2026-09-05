/**
 * The production server: the built app, plus the one endpoint that saves a map.
 *
 * Heroku ran `serve -s dist`, a static file server, so the map builder's Save
 * button had nothing to talk to - `/api/map` exists only as a Vite dev-server
 * plugin writing to the author's disk. Building a map meant running locally and
 * committing by hand every time, which is the report this answers.
 *
 * Zero dependencies on purpose. `serve` was the only thing this replaced and
 * Node 20 has http, fs and fetch; adding Express to serve a folder and proxy
 * one PUT would be more surface than the whole feature.
 *
 * ── Why it does not just write the file ────────────────────────────────────
 *
 * A dyno's filesystem is ephemeral. Writing dist/map.yml would appear to work
 * and then vanish on the next restart or deploy, which is a worse failure than
 * refusing, because it looks like success. The save commits to GitHub instead;
 * the push runs CI and redeploys, so the map is live in about ninety seconds
 * having been checked on the way.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { commitMapYaml, mapCommitConfig, configProblem, secretMatches } from "./mapCommit.js";

const PORT = process.env.PORT || 8080;
const DIST = resolve(process.cwd(), "dist");
/** A map file bigger than this is not a map file. */
const MAX_BODY = 2 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

/** Read a request body, refusing anything implausibly large. */
function readBody(req) {
  return new Promise((done, fail) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      // Stop READING as well as rejecting: without the destroy a big upload
      // keeps arriving after the answer has gone out.
      if (size > MAX_BODY) { req.destroy(); fail(new Error("body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", fail);
  });
}

async function handleMapSave(req, res) {
  const cfg = mapCommitConfig(process.env);
  const problem = configProblem(cfg);
  if (problem) {
    // Deliberately specific. A deployed build has no console to read, and each
    // of these is a thing the author has to go and set.
    return json(res, 503, { error: `Saving is not configured. ${problem}` });
  }
  if (!secretMatches(req.headers["x-map-secret"] ?? "", cfg.secret)) {
    return json(res, 401, { error: "Wrong or missing editor secret." });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 413, { error: "That map file is too large to be a map file." });
  }
  if (!body.trim()) return json(res, 400, { error: "Refusing to commit an empty map." });
  // A guard against saving something that is not the ladder at all - a failed
  // fetch, an error page, a half-written buffer. Cheap, and the alternative is
  // committing rubbish over the whole game's content.
  if (!body.includes("levels:")) {
    return json(res, 400, { error: "That does not look like map.yml (no `levels:` key)." });
  }

  const who = String(req.headers["x-map-author"] || "the map builder").slice(0, 60);
  const result = await commitMapYaml({
    cfg,
    content: body,
    message: `chore(map): save from ${who}\n\nCommitted by the in-browser map builder.`,
  });
  return json(res, result.ok ? 200 : result.status, result.ok
    ? { ok: true, commit: result.commit, branch: result.branch }
    : { error: result.error });
}

/** Serve a file from dist, or null when there is nothing there. */
async function sendFile(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      // The built assets are content-hashed, so they can be cached hard. The
      // HTML and the YAML are not, and map.yml in particular has to be re-read
      // after a save or the builder loads a stale ladder.
      "Cache-Control": filePath.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/api/map") {
    if (req.method === "PUT") return handleMapSave(req, res);
    res.writeHead(405, { Allow: "PUT" });
    return res.end();
  }

  // Static, with the path resolved and then checked to be INSIDE dist: a
  // request for /../../etc/passwd must not escape, and normalising alone does
  // not stop it once the leading slash is gone.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const target = join(DIST, rel);
  if (target.startsWith(DIST) && await sendFile(res, target)) return;

  // SPA fallback, the `-s` in `serve -s dist`.
  if (await sendFile(res, join(DIST, "index.html"))) return;
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found. Has `npm run build` run?");
});

server.listen(PORT, () => {
  const cfg = mapCommitConfig(process.env);
  const problem = configProblem(cfg);
  console.log(`dev/end listening on ${PORT}`);
  console.log(problem
    ? `map saving DISABLED: ${problem}`
    : `map saving enabled -> ${cfg.repo}@${cfg.branch}:${cfg.path}`);
});

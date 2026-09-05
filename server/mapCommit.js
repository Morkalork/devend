/**
 * Committing map.yml to GitHub, so the ladder stays the file the tests guard.
 *
 * The map builder is reachable on the deployed build but its Save button had
 * nowhere to write: `/api/map` is a Vite DEV-server plugin that writes the file
 * on the author's disk, and production serves static files with no API at all.
 * So building a map meant running it locally and committing by hand every time.
 *
 * ── Why a commit and not a database ────────────────────────────────────────
 *
 * A store would make saves instant, and it would put the ladder in two places:
 * the one the game reads and the one every test reads. That is a bad trade
 * HERE specifically, because so much of this map's correctness lives in CI -
 * the gap rule, the win-spec authoring guard, the mechanic spread, the bot
 * sweep, the act I pins. A map edited down a path that skips those is a map
 * nothing checks. Committing keeps one source of truth and keeps every guard in
 * the path: the push runs CI and redeploys, so a save is live in about ninety
 * seconds and has been checked on the way.
 *
 * Pure but for the `fetch` handed in, so the whole thing is testable without a
 * network or a token.
 */

const API = "https://api.github.com";

/** Everything the commit needs, so nothing here reads process.env itself. */
export function mapCommitConfig(env) {
  return {
    token: env.GITHUB_TOKEN || "",
    repo: env.MAP_COMMIT_REPO || "Morkalork/devend",
    branch: env.MAP_COMMIT_BRANCH || "dev",
    path: env.MAP_COMMIT_PATH || "public/map.yml",
    secret: env.MAP_EDIT_SECRET || "",
  };
}

/**
 * Why this configuration cannot save, or null when it can.
 *
 * Returned as a sentence rather than a boolean: "save failed" on a deployed
 * build with no way to see a log is the least useful thing a button can say,
 * and every one of these is a thing the author has to go and do.
 */
export function configProblem(cfg) {
  if (!cfg.token) return "GITHUB_TOKEN is not set on this app.";
  if (!cfg.secret) return "MAP_EDIT_SECRET is not set on this app.";
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) return `MAP_COMMIT_REPO is not owner/repo: ${cfg.repo}`;
  return null;
}

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "devend-map-builder",
});

/**
 * Commit `content` over the configured path on the configured branch.
 *
 * Reads the file's current sha first, because the Contents API needs it to
 * replace a file. That read is also the conflict check: GitHub rejects a stale
 * sha with a 409, and this reports that rather than retrying with the fresh one.
 * Retrying would be a silent overwrite of whatever landed in between, which on
 * a file that is the whole game's content is the worst possible default.
 */
export async function commitMapYaml({ cfg, content, message, fetchImpl = fetch }) {
  const problem = configProblem(cfg);
  if (problem) return { ok: false, status: 503, error: problem };

  const url = `${API}/repos/${cfg.repo}/contents/${encodeURI(cfg.path)}`;
  const ref = encodeURIComponent(cfg.branch);

  let sha;
  const head = await fetchImpl(`${url}?ref=${ref}`, { headers: headers(cfg.token) });
  if (head.status === 200) {
    sha = (await head.json()).sha;
  } else if (head.status !== 404) {
    // 404 is legitimate - the path may not exist on this branch yet - but
    // anything else (401 a bad token, 403 a token without contents:write, 404
    // on the REPO) has to surface as itself.
    const body = await head.text().catch(() => "");
    return {
      ok: false, status: head.status,
      error: `Could not read ${cfg.path} on ${cfg.branch}: ${head.status} ${body.slice(0, 200)}`,
    };
  }

  const put = await fetchImpl(url, {
    method: "PUT",
    headers: { ...headers(cfg.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      // The API takes base64, and the file is UTF-8 with comments and box
      // drawing in it, so the encode has to go through a Buffer rather than
      // btoa - which would mangle every non-ASCII byte in those 269 comment
      // lines.
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (put.status === 409 || put.status === 422) {
    return {
      ok: false, status: 409,
      error: `${cfg.path} changed on ${cfg.branch} since this editor loaded it.`
        + " Reload the builder so you are editing the current file, then save again.",
    };
  }
  if (!put.ok) {
    const body = await put.text().catch(() => "");
    return { ok: false, status: put.status, error: `GitHub refused the commit: ${put.status} ${body.slice(0, 200)}` };
  }

  const done = await put.json();
  return { ok: true, status: 200, commit: done.commit?.sha ?? null, branch: cfg.branch };
}

/**
 * Constant-time compare, so a wrong secret cannot be found a character at a
 * time by timing the reply. Length is compared first and leaks only the length.
 */
export function secretMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (given.length !== expected.length || expected.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Which build is this?
 *
 * Exists to answer one question from the admin panel: is the deployed staging
 * app actually running my latest push, or has it not redeployed yet? Staging
 * has a stable URL, so there is otherwise nothing on screen that distinguishes
 * a five-minute-old build from a five-day-old one, and a change that "did not
 * work" is indistinguishable from a change that never shipped.
 *
 * The identity is baked in by vite.config.ts (SOURCE_VERSION on Heroku, `git
 * rev-parse` locally). Reads go through the guards below because the injected
 * globals do not exist under vitest, and a missing version label must never
 * throw inside an admin screen.
 */

const read = (value: string | undefined): string =>
  typeof value === "string" && value.length > 0 ? value : "";

/** Full commit sha this bundle was built from, or "" when unknown. */
export const BUILD_SHA = read(typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : undefined);
/** ISO timestamp of the build, or "" when unknown. */
export const BUILD_AT = read(typeof __BUILD_AT__ !== "undefined" ? __BUILD_AT__ : undefined);
/** "owner/name" of the origin remote, for the update check. */
export const BUILD_REPO = read(typeof __BUILD_REPO__ !== "undefined" ? __BUILD_REPO__ : undefined);

/** The 7-character form used everywhere git shows a commit. */
export function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

/**
 * Coarse "how old is this build" label. Deliberately low-resolution: the only
 * decision it supports is "did my push make it out yet", where minutes matter
 * and seconds do not.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  if (!iso) return "unknown";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";

  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Result of comparing this build against the branch head on GitHub. Flat
 * rather than a discriminated union because the project compiles with
 * `strict: false`, where TypeScript will not narrow one (see mapSave.ts).
 */
export interface UpdateCheck {
  /** "current" | "behind" | "unknown" */
  status: "current" | "behind" | "unknown";
  /** How many commits the branch is ahead of this build, when known. */
  behindBy?: number;
  /** Head sha of the branch. */
  latestSha?: string;
  /** Why the check could not be made. */
  problem?: string;
}

const API = "https://api.github.com";

/**
 * Ask GitHub whether `branch` has moved past this build.
 *
 * Unauthenticated, which is fine for a public repo and rate limited to 60/hour
 * per IP; a 403 is reported as unknown rather than as "up to date", because
 * quietly claiming currency is the one answer that would make this feature
 * worse than not having it.
 */
export async function checkForUpdate(
  branch = "dev",
  opts: { sha?: string; repo?: string; fetchImpl?: typeof fetch } = {},
): Promise<UpdateCheck> {
  const sha = opts.sha ?? BUILD_SHA;
  const repo = opts.repo ?? BUILD_REPO;
  const doFetch = opts.fetchImpl ?? fetch;

  if (!sha) return { status: "unknown", problem: "this build has no commit stamp" };
  if (!repo) return { status: "unknown", problem: "no GitHub remote recorded at build time" };

  let head: { sha?: string };
  try {
    const res = await doFetch(`${API}/repos/${repo}/commits/${branch}`);
    if (!res.ok) {
      return {
        status: "unknown",
        problem: res.status === 403 ? "GitHub rate limit reached" : `GitHub returned ${res.status}`,
      };
    }
    head = await res.json();
  } catch {
    return { status: "unknown", problem: "could not reach GitHub" };
  }

  if (!head?.sha) return { status: "unknown", problem: "unexpected response from GitHub" };
  if (head.sha === sha) return { status: "current", latestSha: head.sha };

  // Behind: try to say by how much. The count is a nicety, so a failure here
  // still reports "behind" rather than collapsing to unknown.
  let behindBy: number | undefined;
  try {
    const res = await doFetch(`${API}/repos/${repo}/compare/${sha}...${head.sha}`);
    if (res.ok) {
      const body = await res.json();
      if (typeof body?.ahead_by === "number") behindBy = body.ahead_by;
    }
  } catch {
    /* count unavailable; "behind" is still the right answer */
  }

  return { status: "behind", behindBy, latestSha: head.sha };
}

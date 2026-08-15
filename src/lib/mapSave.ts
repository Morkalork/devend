/**
 * Saving map.yml from the admin Playground.
 *
 * `PUT /api/map` only exists as a Vite dev-server plugin (vite.config.ts). In
 * production the app is served by `serve -s dist`, and the `-s` flag rewrites
 * every unmatched request to index.html, for ANY method. So the PUT comes back
 * as:
 *
 *     HTTP 200, Content-Type: text/html, body: <!doctype html>...
 *
 * A plain `res.ok` check therefore reports a cheerful green "Saved!" on the
 * deployed build while nothing whatsoever was written, which is exactly how
 * this was found: edits made on Heroku silently vanished on reload.
 *
 * The fix is to stop trusting the status code and require positive proof that
 * the dev endpoint answered: JSON, with the `{ ok: true }` it sends. An SPA
 * fallback can fake a 200; it cannot fake that.
 *
 * Note that even a working endpoint would not help on Heroku, where the dyno
 * filesystem is ephemeral and a restart discards the write. Disk saving is a
 * local-development feature, so the UI offers a download instead when the
 * endpoint is absent.
 */

export type MapSaveFailure =
  /** No dev endpoint: a static host answered (or rewrote) the request. */
  | "unavailable"
  /** The endpoint exists and refused, e.g. it could not write the file. */
  | "server"
  /** The request never completed (offline, CORS, connection reset). */
  | "network";

/**
 * Flat rather than a discriminated union on purpose: this project compiles with
 * `strict: false` (tsconfig.app.json), and without strictNullChecks TypeScript
 * will not narrow `{ ok: true } | { ok: false; reason }` on the `ok` check, so
 * a union here fails to compile at every call site.
 */
export interface MapSaveResult {
  ok: boolean;
  /** Present whenever `ok` is false. */
  reason?: MapSaveFailure;
}

export const MAP_API_URL = "/api/map";

/**
 * PUT the YAML to the dev endpoint. Resolves with a verdict rather than
 * throwing, so the caller can render a specific reason.
 */
export async function saveMapYaml(
  yamlContent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MapSaveResult> {
  let res: Response;
  try {
    res = await fetchImpl(MAP_API_URL, {
      method: "PUT",
      body: yamlContent,
      headers: { "Content-Type": "text/yaml" },
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  // A static host may answer the PUT with 405, or with a rewritten 200 index
  // page. Only the first of those is distinguishable by status.
  if (!res.ok) {
    return { ok: false, reason: res.status === 404 || res.status === 405 ? "unavailable" : "server" };
  }

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { ok: false, reason: "unavailable" };

  try {
    const body = await res.json();
    // The endpoint's contract is `{ ok: true }`. Anything else, including a
    // JSON error payload from some intermediary, is not a confirmed write.
    return body && body.ok === true
      ? { ok: true }
      : { ok: false, reason: "server" };
  } catch {
    return { ok: false, reason: "unavailable" }; // 200, JSON header, unparseable body
  }
}

/** What the Save button should say for each outcome. Kept here so the copy and
 *  the verdicts cannot drift apart. */
export function mapSaveMessage(reason: MapSaveFailure): string {
  switch (reason) {
    case "unavailable":
      return "No dev server: saving to disk only works locally";
    case "server":
      return "The dev server could not write map.yml";
    case "network":
      return "Could not reach the dev server";
  }
}

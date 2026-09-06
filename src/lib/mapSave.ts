/**
 * Saving map.yml from the admin screens. ONE path, for both save buttons.
 *
 * There are two editors - the Playground's level panel and the MapBuilder - and
 * they had two copies of this. The copies had drifted: the MapBuilder sent the
 * editor secret and prompted for it, and this one sent no secret at all, so the
 * Playground's Save could only ever reach the Vite dev plugin. Against the
 * production server it got a 401 and reported "The dev server could not write
 * map.yml", which is wrong twice over - it is not a dev server, and the write
 * never failed because it was never attempted.
 *
 * ── Two endpoints wear the same URL ────────────────────────────────────────
 *
 * `PUT /api/map` is answered by whichever server is listening:
 *
 *   `npm run dev`    the Vite plugin writes public/map.yml on the author's disk
 *                    and answers {ok:true}. No secret, no commit.
 *   `npm start`      server/index.js COMMITS the file to GitHub (branch `dev`
 *                    by default) and answers {ok:true, commit}. Needs the
 *                    secret, because the map builder is reachable in production.
 *   a static host    rewrites the PUT to index.html and answers 200 with HTML.
 *
 * The third is why a save is only believed on positive proof: an SPA fallback
 * can fake a 200, but not `{ok:true}` served as application/json. That is how
 * this was found - edits on Heroku reported a cheerful green "Saved!" and
 * silently vanished on reload.
 *
 * ── The secret is never in the bundle ──────────────────────────────────────
 *
 * The client bundle is public and the map builder is reachable in production,
 * so a secret compiled into it would gate nothing. It is asked for once, on the
 * first save that gets a 401, and kept in localStorage.
 */

export type MapSaveFailure =
  /** No dev endpoint: a static host answered (or rewrote) the request. */
  | "unavailable"
  /** The endpoint is there and wants a secret we do not have, or have wrong. */
  | "auth"
  /** The endpoint exists and refused, e.g. it could not write or commit. */
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
  /**
   * The server's own sentence, when it sent one.
   *
   * Preferred over anything written here. server/index.js answers a refusal
   * with the thing the author has to go and do ("GITHUB_TOKEN is not set on
   * this app."), and a deployed build has no console to read it in - so
   * replacing it with a generic message here would throw away the only useful
   * part of the reply.
   */
  detail?: string;
}

export const MAP_API_URL = "/api/map";

/** Where the editor secret lives. Not in the bundle - see the header. */
export const MAP_SECRET_KEY = "devend:mapEditSecret";

/** The stored editor secret, or "" when there is none (or storage is blocked). */
export function mapEditSecret(): string {
  try {
    return localStorage.getItem(MAP_SECRET_KEY) ?? "";
  } catch {
    return ""; // private mode / embedded webview
  }
}

/**
 * Ask for the editor secret and keep it. True when one was given.
 *
 * Shared rather than written at each save button, because the two copies of
 * this had already drifted into one asking and one not.
 */
export function promptForMapSecret(
  ask: (message: string, dflt: string) => string | null =
    (m, d) => window.prompt(m, d),
): boolean {
  const given = ask("Editor secret for saving to the repo (MAP_EDIT_SECRET):", "");
  if (!given) return false;
  try {
    localStorage.setItem(MAP_SECRET_KEY, given);
  } catch {
    /* private mode: the save below will simply ask again */
  }
  return true;
}

/**
 * PUT the YAML. Resolves with a verdict rather than throwing, so the caller can
 * render a specific reason and decide whether to ask for the secret.
 */
export async function saveMapYaml(
  yamlContent: string,
  fetchImpl: typeof fetch = fetch,
  secret: string = mapEditSecret(),
): Promise<MapSaveResult> {
  let res: Response;
  try {
    res = await fetchImpl(MAP_API_URL, {
      method: "PUT",
      body: yamlContent,
      headers: {
        "Content-Type": "text/yaml",
        // Omitted rather than sent empty: the dev plugin ignores it either way,
        // and an empty header is a claim to have a secret.
        ...(secret ? { "X-Map-Secret": secret } : {}),
      },
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  // 401 means the endpoint IS there and configured and did not like the secret.
  // Distinguished from every other refusal because it is the only one the
  // player can fix from here, by being asked.
  if (res.status === 401) {
    return { ok: false, reason: "auth", detail: await errorText(res) };
  }

  // A static host may answer the PUT with 405, or with a rewritten 200 index
  // page. Only the first of those is distinguishable by status.
  if (!res.ok) {
    return {
      ok: false,
      reason: res.status === 404 || res.status === 405 ? "unavailable" : "server",
      detail: await errorText(res),
    };
  }

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { ok: false, reason: "unavailable" };

  try {
    const body = await res.json();
    // The endpoint's contract is `{ ok: true }`. Anything else, including a
    // JSON error payload from some intermediary, is not a confirmed write.
    return body && body.ok === true
      ? { ok: true }
      : { ok: false, reason: "server", detail: body?.error };
  } catch {
    return { ok: false, reason: "unavailable" }; // 200, JSON header, unparseable body
  }
}

/** The server's `{ error }` sentence, or undefined when there is not one. */
async function errorText(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a Save button should say for an outcome.
 *
 * `detail` wins whenever the server sent one: it names the config var to set or
 * the conflict to resolve, and a deployed build has no console to read it in.
 * The fallbacks below are for the cases where nobody answered at all.
 */
export function mapSaveMessage(reason: MapSaveFailure, detail?: string): string {
  if (detail) return detail;
  switch (reason) {
    case "unavailable":
      return "No save endpoint: run `npm run dev` to write to disk";
    case "auth":
      return "That editor secret was not accepted";
    case "server":
      return "The server refused the save";
    case "network":
      return "Could not reach the server";
  }
}

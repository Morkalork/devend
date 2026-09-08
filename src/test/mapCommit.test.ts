/**
 * Saving a map from the browser commits it to the repo.
 *
 * The map builder is reachable on the deployed build but its Save had nowhere
 * to write: `/api/map` is a Vite DEV-server plugin writing to the author's
 * disk, and production served static files with no API. So building a map
 * meant running it locally and committing by hand every time.
 *
 * It commits rather than writing a file because a dyno's filesystem is
 * ephemeral - a write would appear to work and vanish on the next restart,
 * which is worse than refusing - and rather than using a database because
 * map.yml is the file every map test reads. The gap rule, the win-spec guard,
 * the mechanic spread and the bot sweep all guard the ladder in CI, and a map
 * edited down a path that skips them is a map nothing checks.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  commitMapYaml, mapCommitConfig, configProblem, secretMatches,
} from "../../server/mapCommit.js";

const cfg = (over: Record<string, string> = {}) =>
  mapCommitConfig({ GITHUB_TOKEN: "t", MAP_EDIT_SECRET: "s", ...over });

/** A fetch that answers the read with `head` and records the write. */
function fakeFetch(head: { status: number; body?: unknown }, put: { status: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = init?.method === "PUT" ? put : head;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? ""),
    } as unknown as Response;
  });
  return { impl, calls };
}

describe("what stops a save before it starts", () => {
  it("names the missing config rather than just failing", () => {
    // A deployed build has no console to read. Each of these is a thing the
    // author has to go and set, so each says which.
    expect(configProblem(mapCommitConfig({}))).toMatch(/GITHUB_TOKEN/);
    expect(configProblem(mapCommitConfig({ GITHUB_TOKEN: "t" }))).toMatch(/MAP_EDIT_SECRET/);
    expect(configProblem(cfg())).toBeNull();
  });

  it("refuses a repo that is not owner/repo", () => {
    expect(configProblem(cfg({ MAP_COMMIT_REPO: "devend" }))).toMatch(/owner\/repo/);
  });

  it("defaults to dev, which is where map work lands", () => {
    expect(cfg().branch).toBe("dev");
    expect(cfg({ MAP_COMMIT_BRANCH: "main" }).branch).toBe("main");
  });

  it("does not call GitHub at all when it cannot", async () => {
    const { impl } = fakeFetch({ status: 200 }, { status: 200 });
    const r = await commitMapYaml({
      cfg: mapCommitConfig({}), content: "levels: []", message: "m", fetchImpl: impl,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(impl, "reached for the network with no token").not.toHaveBeenCalled();
  });
});

describe("the commit itself", () => {
  it("reads the current sha before replacing the file", async () => {
    // The Contents API needs it to replace a file, and the read doubles as the
    // conflict check.
    const { impl, calls } = fakeFetch(
      { status: 200, body: { sha: "abc123" } },
      { status: 200, body: { commit: { sha: "def456" } } },
    );
    const r = await commitMapYaml({ cfg: cfg(), content: "levels: []", message: "m", fetchImpl: impl });

    expect(r).toMatchObject({ ok: true, commit: "def456", branch: "dev" });
    expect(calls[0].url, "did not read the file first").toContain("?ref=dev");
    expect(JSON.parse(String(calls[1].init?.body)).sha).toBe("abc123");
  });

  it("sends the file base64 through a Buffer, not btoa", async () => {
    // map.yml is UTF-8 and carries box drawing and accents in its 269 comment
    // lines. btoa mangles every non-ASCII byte of that.
    const { impl, calls } = fakeFetch(
      { status: 404 }, { status: 201, body: { commit: { sha: "s" } } });
    const content = "levels: []\n# ── a comment with – dashes and ü\n";
    await commitMapYaml({ cfg: cfg(), content, message: "m", fetchImpl: impl });

    const sent = JSON.parse(String(calls[1].init?.body)).content;
    expect(Buffer.from(sent, "base64").toString("utf-8")).toBe(content);
  });

  it("omits the sha when the file is not on that branch yet", async () => {
    const { impl, calls } = fakeFetch({ status: 404 }, { status: 201, body: { commit: { sha: "s" } } });
    await commitMapYaml({ cfg: cfg(), content: "levels: []", message: "m", fetchImpl: impl });
    expect(JSON.parse(String(calls[1].init?.body))).not.toHaveProperty("sha");
  });

  it("reports a stale file instead of overwriting it", async () => {
    // THE guard. GitHub rejects a stale sha, and retrying with the fresh one
    // would silently overwrite whatever landed in between - on the file that is
    // the whole game's content.
    const { impl } = fakeFetch({ status: 200, body: { sha: "old" } }, { status: 409 });
    const r = await commitMapYaml({ cfg: cfg(), content: "levels: []", message: "m", fetchImpl: impl });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error, "did not say what to do about it").toMatch(/Reload the builder/);
  });

  it("surfaces a bad or under-scoped token as itself", async () => {
    // 401 is a bad token, 403 a token without contents:write. Both are things
    // to go and fix, and neither is "the file is missing".
    for (const status of [401, 403]) {
      const { impl } = fakeFetch({ status }, { status: 200 });
      const r = await commitMapYaml({ cfg: cfg(), content: "levels: []", message: "m", fetchImpl: impl });
      expect(r.ok, `${status} read as success`).toBe(false);
      expect(r.error).toContain(String(status));
    }
  });
});

describe("the editor secret", () => {
  it("matches only the exact secret", () => {
    expect(secretMatches("hunter2", "hunter2")).toBe(true);
    expect(secretMatches("hunter3", "hunter2")).toBe(false);
    expect(secretMatches("hunter", "hunter2")).toBe(false);
  });

  it("never matches an empty or missing one", () => {
    // Otherwise an app with the var unset would accept a request that sent no
    // header at all, which is the worst possible default for a write endpoint
    // on a builder any player can open.
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches(undefined as unknown as string, "s")).toBe(false);
  });

  it("compares every character, so timing does not leak the secret", () => {
    // A `===` or an early return would let it be found a character at a time.
    const src = readFileSync(resolve(process.cwd(), "server/mapCommit.js"), "utf8");
    const fn = src.slice(src.indexOf("export function secretMatches"));
    expect(fn, "the compare returns early on the first wrong character")
      .not.toMatch(/return false;\s*\n\s*}\s*\n\s*return diff/);
    expect(fn).toContain("diff |=");
  });
});

/**
 * The stale-editor overwrite, and why the old conflict check could not fire.
 *
 * Found the day the ladder went from 35 maps to 10: a builder tab opened before
 * that change still held all 35, and its Save would have committed them back
 * over the top. Nothing in the flow said no.
 *
 * The check was documented as one and was not. `commitMapYaml` read the file's
 * current sha and immediately PUT with it, and a sha read moments before the
 * write is fresh by construction - GitHub had nothing to reject. So every save
 * was last-writer-wins on the file that is the whole game's content.
 *
 * The editor's own sha closes it: the version it LOADED is the version it is
 * allowed to replace.
 */
describe("a save names the version it is replacing", () => {
  const ok = { status: 200, body: { content: { sha: "put" }, commit: { sha: "c0ffee" } } };

  it("sends the EDITOR's sha, not the one it just read", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { sha: "same" } }, ok);
    const r = await commitMapYaml({
      cfg: cfg(), content: "levels: []", message: "m", baseSha: "same", fetchImpl: impl,
    });
    expect(r.ok).toBe(true);
    const put = calls.find(c => c.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init!.body)).sha).toBe("same");
  });

  it("refuses when the file moved under the editor", async () => {
    // The 25 deleted maps coming back, stopped. `baseSha` is what the tab
    // loaded; `head` is what is on the branch now.
    const { impl, calls } = fakeFetch({ status: 200, body: { sha: "head" } }, ok);
    const r = await commitMapYaml({
      cfg: cfg(), content: "levels: []", message: "m", baseSha: "loaded", fetchImpl: impl,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error, "the refusal has to say what to do about it").toMatch(/Reload the builder/);
    expect(calls.some(c => c.init?.method === "PUT"), "it wrote anyway").toBe(false);
  });

  it("still saves for an editor that sends no base, rather than locking it out", async () => {
    // An older client, or one with no Web Crypto (an insecure origin, some
    // embedded webviews). Refusing every one of those would be a worse failure
    // than the one this prevents, so the old behaviour stands: read, then write.
    const { impl, calls } = fakeFetch({ status: 200, body: { sha: "head" } }, ok);
    const r = await commitMapYaml({
      cfg: cfg(), content: "levels: []", message: "m", fetchImpl: impl,
    });
    expect(r.ok).toBe(true);
    const put = calls.find(c => c.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init!.body)).sha).toBe("head");
  });

  it("creates the file when there is none, base or no base", async () => {
    // A 404 on the path is legitimate, and there is no version to conflict
    // with, so a baseSha cannot make it a conflict.
    const { impl, calls } = fakeFetch({ status: 404 }, ok);
    const r = await commitMapYaml({
      cfg: cfg(), content: "levels: []", message: "m", baseSha: "loaded", fetchImpl: impl,
    });
    expect(r.ok).toBe(true);
    expect(calls.some(c => c.init?.method === "PUT")).toBe(true);
  });
});

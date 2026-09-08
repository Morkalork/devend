/**
 * Saving map.yml from the Playground.
 *
 * Reported from the Heroku build: "when I save map changes in the admin, they
 * are not persisted... but it doesn't show." Both halves were true, and the
 * second is the bug worth testing.
 *
 * `PUT /api/map` exists only as a Vite dev-server plugin. Production runs
 * `serve -s dist`, and `-s` rewrites every unmatched request to index.html for
 * ANY method, so the PUT comes back 200 with an HTML body. Reproduced against
 * the real binary:
 *
 *     $ curl -X PUT --data-binary "levels: []" http://localhost:5599/api/map
 *     status=200  content-type=text/html; charset=utf-8
 *
 * The old code checked `res.ok`, so it reported a green "Saved!" while nothing
 * had been written, and updated the in-memory levels so the edit looked applied
 * until the next reload. A save is now only believed on positive proof that the
 * dev endpoint answered: an SPA fallback can fake a 200, but not `{ok:true}`
 * served as application/json.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  saveMapYaml, mapSaveMessage, promptForMapSecret, mapEditSecret,
  MAP_API_URL, MAP_SECRET_KEY,
  gitBlobSha,
} from "@/lib/mapSave";

const respond = (
  body: string,
  init: { status?: number; type?: string } = {},
): typeof fetch =>
  vi.fn(async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { "Content-Type": init.type ?? "application/json" },
    }),
  ) as unknown as typeof fetch;

const YAML = "levels: []\n";

describe("a save is only believed with proof", () => {
  it("accepts the dev endpoint's {ok:true}", async () => {
    const result = await saveMapYaml(YAML, respond('{"ok":true}'));
    expect(result.ok).toBe(true);
  });

  /**
   * THE regression. Exactly what `serve -s dist` returns, verified against the
   * real binary. A status check alone calls this a success.
   */
  it("rejects a 200 that is really the SPA index page", async () => {
    const result = await saveMapYaml(
      YAML,
      respond("<!doctype html><html><body>app</body></html>", { type: "text/html; charset=utf-8" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unavailable");
  });

  it("rejects a 200 whose JSON does not confirm the write", async () => {
    const result = await saveMapYaml(YAML, respond('{"ok":false}'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("server");
  });

  it("rejects a 200 with a JSON header but an unparseable body", async () => {
    const result = await saveMapYaml(YAML, respond("not json at all"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unavailable");
  });
});

describe("failures are told apart, so the button can explain itself", () => {
  it("calls a 404 or 405 a missing endpoint, not a server error", async () => {
    for (const status of [404, 405]) {
      const result = await saveMapYaml(YAML, respond("", { status, type: "text/plain" }));
      expect(result.reason).toBe("unavailable");
    }
  });

  it("calls a 500 a server error, because the endpoint did answer", async () => {
    const result = await saveMapYaml(YAML, respond("boom", { status: 500, type: "text/plain" }));
    expect(result.reason).toBe("server");
  });

  it("calls a thrown fetch a network failure", async () => {
    const failing = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const result = await saveMapYaml(YAML, failing);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network");
  });

  it("calls a 401 an auth failure, which is the one the author can fix", async () => {
    // Distinguished from every other refusal because it is the only one that
    // can be answered from here, by being asked for the secret. It used to fall
    // into "server" and report "the dev server could not write map.yml" - wrong
    // twice over, since the write was never attempted and it is not a dev server.
    const result = await saveMapYaml(
      YAML, respond('{"error":"Wrong or missing editor secret."}', { status: 401 }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("auth");
  });

  it("has a distinct message for every failure, and none of them lie", async () => {
    const kinds = ["unavailable", "auth", "server", "network"] as const;
    const messages = kinds.map(k => mapSaveMessage(k));
    expect(new Set(messages).size).toBe(kinds.length);
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(0);
      expect(m.toLowerCase()).not.toContain("saved");
    }
  });

  it("prefers the server's own sentence to anything written here", async () => {
    // server/index.js answers a refusal with the thing the author has to go and
    // do. A deployed build has no console to read it in, so replacing it with a
    // generic message would throw away the only useful part of the reply.
    const why = "Saving is not configured. GITHUB_TOKEN is not set on this app.";
    const result = await saveMapYaml(YAML, respond(JSON.stringify({ error: why }), { status: 503 }));
    expect(result.detail).toBe(why);
    expect(mapSaveMessage(result.reason ?? "server", result.detail)).toBe(why);
  });
});

describe("the editor secret", () => {
  it("is sent when there is one, and omitted when there is not", async () => {
    // Omitted rather than sent empty: an empty header is a claim to have a
    // secret, and the Playground's copy of this sent NO header at all - which
    // is why its Save could only ever reach the Vite dev plugin.
    const spy = vi.fn(async () =>
      new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } }));
    await saveMapYaml(YAML, spy as unknown as typeof fetch, "hunter2");
    let init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["X-Map-Secret"]).toBe("hunter2");

    await saveMapYaml(YAML, spy as unknown as typeof fetch, "");
    init = (spy.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["X-Map-Secret"]).toBeUndefined();
  });

  it("is read from storage by default, so both save buttons send the same one", () => {
    localStorage.setItem(MAP_SECRET_KEY, "from-storage");
    expect(mapEditSecret()).toBe("from-storage");
    localStorage.removeItem(MAP_SECRET_KEY);
    expect(mapEditSecret()).toBe("");
  });

  it("is kept when the prompt is answered, and not when it is dismissed", () => {
    localStorage.removeItem(MAP_SECRET_KEY);
    expect(promptForMapSecret(() => null)).toBe(false);
    expect(mapEditSecret()).toBe("");
    expect(promptForMapSecret(() => "typed-in")).toBe(true);
    expect(mapEditSecret()).toBe("typed-in");
    localStorage.removeItem(MAP_SECRET_KEY);
  });
});

describe("the request itself", () => {
  it("PUTs the yaml to the dev endpoint", async () => {
    const spy = vi.fn(async () =>
      new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } }),
    );
    await saveMapYaml(YAML, spy as unknown as typeof fetch);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MAP_API_URL);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(YAML);
  });
});

describe("both editors save through the same path", () => {
  // They did not, and the copies had drifted: the MapBuilder sent the editor
  // secret and prompted for it, the Playground sent no header at all. One of
  // the two buttons could therefore never reach the committing server, and
  // said so in words that described neither the server nor the failure.
  const read = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8");

  for (const file of [
    "src/components/admin/MapBuilder.tsx",
    "src/components/admin/PlaygroundScreen.tsx",
  ]) {
    it(`${file.split("/").pop()} goes through saveMapYaml`, () => {
      const src = read(file);
      expect(src, "it PUTs /api/map by hand again").not.toMatch(/fetch\('\/api\/map'/);
      expect(src).toMatch(/saveMapYaml\(/);
      // And answers a 401 by asking, rather than reporting it as a write that
      // failed - which is the failure this file exists for.
      expect(src).toMatch(/reason === 'auth' && promptForMapSecret\(\)/);
    });
  }
});

/**
 * Naming the version being replaced, from the client side.
 *
 * `gitBlobSha` is the same hash GitHub reports for a file - sha1 over
 * `blob <length>\0<bytes>` - so an editor can say which version it loaded
 * without asking GitHub anything, and the server can hand that straight to the
 * Contents API as a compare-and-swap.
 */
describe("the base sha a save carries", () => {
  it("matches git's own object id for a blob", async () => {
    // `printf 'hello' | git hash-object --stdin` -> this exact value. Pinned
    // against the real algorithm rather than against our own output, which
    // would agree with any bug in it.
    expect(await gitBlobSha("hello")).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
    expect(await gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("counts BYTES, not characters", async () => {
    // The header is the byte length, and map.yml's comment blocks are full of
    // box drawing and dashes. A length in UTF-16 code units would hash every
    // one of those files wrongly and turn every save into a false conflict.
    const sha = await gitBlobSha("é");
    expect(sha).toBe("4b04fff51468d8ab5201ab02b725dc477bc7cb45");
  });

  it("sends it as a header, and only when there is one", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      seen.push(init!);
      return {
        status: 200, ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true }),
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await saveMapYaml("levels: []", fetchImpl, "s", "abc123");
    expect((seen[0].headers as Record<string, string>)["X-Map-Base-Sha"]).toBe("abc123");

    // An empty header is a claim to have checked something, so it is omitted.
    await saveMapYaml("levels: []", fetchImpl, "s", "");
    expect((seen[1].headers as Record<string, string>)["X-Map-Base-Sha"]).toBeUndefined();
  });
});

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
import { saveMapYaml, mapSaveMessage, MAP_API_URL } from "@/lib/mapSave";

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

  it("has a distinct message for every failure, and none of them lie", async () => {
    const messages = (["unavailable", "server", "network"] as const).map(mapSaveMessage);
    expect(new Set(messages).size).toBe(3);
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(0);
      expect(m.toLowerCase()).not.toContain("saved");
    }
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

/** The runtime YAML is fetched once per page load (lib/configFetch.ts). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchConfig, invalidateConfig } from "@/lib/configFetch";
import { saveMapYaml } from "@/lib/mapSave";

afterEach(() => vi.unstubAllGlobals());

function stub(body = "a: 1", ok = true) {
  const f = vi.fn(async () => ({ ok, status: ok ? 200 : 503, text: async () => body }) as Response);
  vi.stubGlobal("fetch", f);
  return f;
}

describe("the config fetch", () => {
  it("fetches a file once, however many readers ask", async () => {
    const f = stub("levels: []");
    const [a, b] = await Promise.all([fetchConfig("/map.yml"), fetchConfig("/map.yml")]);
    const c = await fetchConfig("/map.yml");
    expect(f).toHaveBeenCalledTimes(1);
    expect(await a.text()).toBe("levels: []");
    expect(await b.text()).toBe("levels: []");
    expect(await c.text()).toBe("levels: []");
  });

  it("does not remember a failure", async () => {
    stub("", false);
    const bad = await fetchConfig("/bugs.yml");
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(503);
    const f = stub("bugs: []");
    expect((await fetchConfig("/bugs.yml")).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reads map.yml afresh after a save", async () => {
    let f = stub("old");
    await fetchConfig("/map.yml");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }), text: async () => "" }) as unknown as Response));
    await saveMapYaml("levels: []", fetch, "", "");
    f = stub("new");
    expect(await (await fetchConfig("/map.yml")).text()).toBe("new");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("can be cleared", async () => {
    const f = stub();
    await fetchConfig("/x.yml");
    invalidateConfig();
    await fetchConfig("/x.yml");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

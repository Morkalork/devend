/**
 * Build identity, shown in the Admin panel.
 *
 * Staging has a stable URL, so nothing on screen distinguishes a build from
 * five minutes ago from one from five days ago. That makes "my fix didn't
 * work" and "my fix never deployed" look identical, which is what this exists
 * to settle.
 *
 * The one behaviour worth guarding is that it never lies in the reassuring
 * direction: any failure to check must report "unknown", never "current". A
 * false "up to date" is worse than no check at all, because it actively sends
 * you looking for a bug in code that isn't running.
 */
import { describe, it, expect, vi } from "vitest";
import { checkForUpdate, relativeTime, shortSha } from "@/lib/buildInfo";

const SHA = "356f7703e7f83ed1b34b6da0a1b4fc1babf23b8d";
const NEWER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Serves the commits endpoint, then the compare endpoint. */
const githubStub = (head: string, aheadBy?: number) =>
  vi.fn(async (url: string) =>
    String(url).includes("/compare/")
      ? json(aheadBy === undefined ? {} : { ahead_by: aheadBy })
      : json({ sha: head }),
  ) as unknown as typeof fetch;

const opts = (fetchImpl: typeof fetch) => ({ sha: SHA, repo: "Morkalork/devend", fetchImpl });

describe("shortSha", () => {
  it("gives the familiar 7 characters", () => {
    expect(shortSha(SHA)).toBe("356f770");
  });

  it("says so when there is no stamp, rather than showing an empty box", () => {
    expect(shortSha("")).toBe("unknown");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-15T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads at the resolution the decision needs", () => {
    expect(relativeTime(ago(5_000), now)).toBe("just now");
    expect(relativeTime(ago(90_000), now)).toBe("2m ago");
    expect(relativeTime(ago(3 * 3600_000), now)).toBe("3h ago");
    expect(relativeTime(ago(50 * 3600_000), now)).toBe("2d ago");
  });

  it("never shows a build from the future as a negative age", () => {
    expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });

  it("handles a missing or unparseable stamp", () => {
    expect(relativeTime("", now)).toBe("unknown");
    expect(relativeTime("not a date", now)).toBe("unknown");
  });
});

describe("checking against the branch head", () => {
  it("reports current when the head matches this build", async () => {
    const result = await checkForUpdate("dev", opts(githubStub(SHA)));
    expect(result.status).toBe("current");
  });

  it("reports behind, with a count, when the branch has moved on", async () => {
    const result = await checkForUpdate("dev", opts(githubStub(NEWER, 3)));
    expect(result.status).toBe("behind");
    expect(result.behindBy).toBe(3);
    expect(result.latestSha).toBe(NEWER);
  });

  it("still reports behind when the count is unavailable", async () => {
    // The count is a nicety; losing it must not downgrade the verdict to
    // "unknown", which reads as "probably fine".
    const result = await checkForUpdate("dev", opts(githubStub(NEWER, undefined)));
    expect(result.status).toBe("behind");
    expect(result.behindBy).toBeUndefined();
  });
});

/**
 * Every one of these must land on "unknown". A check that fails closed into
 * "current" would send you hunting for a bug in code that never shipped.
 */
describe("a failed check never claims to be up to date", () => {
  it("on a rate limit", async () => {
    const limited = vi.fn(async () => json({}, 403)) as unknown as typeof fetch;
    const result = await checkForUpdate("dev", opts(limited));
    expect(result.status).toBe("unknown");
    expect(result.problem).toMatch(/rate limit/i);
  });

  it("on any other GitHub error", async () => {
    const broken = vi.fn(async () => json({}, 500)) as unknown as typeof fetch;
    expect((await checkForUpdate("dev", opts(broken))).status).toBe("unknown");
  });

  it("when the network is unreachable", async () => {
    const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const result = await checkForUpdate("dev", opts(offline));
    expect(result.status).toBe("unknown");
    expect(result.problem).toMatch(/reach/i);
  });

  it("when the response has no sha", async () => {
    const odd = vi.fn(async () => json({ nope: true })) as unknown as typeof fetch;
    expect((await checkForUpdate("dev", opts(odd))).status).toBe("unknown");
  });

  it("when this bundle carries no commit stamp at all", async () => {
    const never = vi.fn() as unknown as typeof fetch;
    const result = await checkForUpdate("dev", { sha: "", repo: "x/y", fetchImpl: never });
    expect(result.status).toBe("unknown");
    expect(never).not.toHaveBeenCalled(); // no point asking
  });

  it("when no remote was recorded at build time", async () => {
    const never = vi.fn() as unknown as typeof fetch;
    const result = await checkForUpdate("dev", { sha: SHA, repo: "", fetchImpl: never });
    expect(result.status).toBe("unknown");
    expect(never).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  it("asks for the branch head, not the default branch", async () => {
    const seen: string[] = [];
    const spy = (async (url: string) => { seen.push(String(url)); return json({ sha: SHA }); }) as unknown as typeof fetch;
    await checkForUpdate("main", { sha: SHA, repo: "Morkalork/devend", fetchImpl: spy });
    expect(seen[0]).toContain("/commits/main");
  });
});

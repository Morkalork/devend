/**
 * Guessing whether the server was asleep.
 *
 * An eco dyno naps after half an hour with nobody playing, and the first
 * request after that waits several seconds for a boot. The 2-Player screen
 * reads that from two clues (a slow answer, a young process) and says so in
 * words, instead of showing a spinner that looks like the mode is broken.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyNap, pendingNap, probeServerNap, WAKING_AFTER_MS, JUST_WOKE_UPTIME_S, type NapState,
} from "@/lib/net/serverNap";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";

afterEach(() => vi.useRealTimers());

describe("reading the clues", () => {
  it("calls a quick answer from an old process awake", () => {
    expect(classifyNap({ ok: true, elapsedMs: 120, uptimeSeconds: 3600 })).toBe("awake");
  });

  it("calls a slow answer a nap, however old the process claims to be", () => {
    expect(classifyNap({ ok: true, elapsedMs: WAKING_AFTER_MS + 1, uptimeSeconds: 3600 })).toBe("justWoke");
  });

  it("calls a quick answer from a brand new process a nap too", () => {
    // Somebody else's request woke it a moment ago; it was still asleep then.
    expect(classifyNap({ ok: true, elapsedMs: 80, uptimeSeconds: JUST_WOKE_UPTIME_S - 1 })).toBe("justWoke");
  });

  it("calls no answer, or an answer that is not the health report, unreachable", () => {
    expect(classifyNap({ ok: false, elapsedMs: 80, uptimeSeconds: 3600 })).toBe("unreachable");
    expect(classifyNap({ ok: true, elapsedMs: 80, uptimeSeconds: null })).toBe("unreachable");
  });

  it("treats a wait as a boot only after it has gone on a while", () => {
    expect(pendingNap(200)).toBe("checking");
    expect(pendingNap(WAKING_AFTER_MS)).toBe("waking");
  });
});

describe("the probe", () => {
  it("says waking while the answer is slow, then that it just woke", async () => {
    vi.useFakeTimers();
    let clock = 0;
    let answer: (r: Response) => void = () => {};
    const fetchImpl = (() => new Promise<Response>(r => { answer = r; })) as typeof fetch;
    const seen: NapState[] = [];
    probeServerNap(s => seen.push(s), { fetchImpl, now: () => clock });
    expect(seen).toEqual(["checking"]);
    clock = WAKING_AFTER_MS + 10;
    vi.advanceTimersByTime(WAKING_AFTER_MS + 10);
    expect(seen).toEqual(["checking", "waking"]);
    clock = 9000;
    answer(new Response(JSON.stringify({ ok: true, uptimeSeconds: 2 }), { status: 200 }));
    await vi.waitFor(() => expect(seen.at(-1)).toBe("justWoke"));
  });

  it("says unreachable when the request fails, and nothing after a cancel", async () => {
    const failing = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    const seen: NapState[] = [];
    probeServerNap(s => seen.push(s), { fetchImpl: failing });
    await vi.waitFor(() => expect(seen.at(-1)).toBe("unreachable"));

    const quiet: NapState[] = [];
    const stop = probeServerNap(s => quiet.push(s), { fetchImpl: failing });
    stop();
    await new Promise(r => setTimeout(r, 10));
    expect(quiet).toEqual(["checking"]);
  });
});

describe("the explainer copy", () => {
  const states: NapState[] = ["checking", "waking", "awake", "justWoke", "unreachable"];
  for (const [lang, locale] of Object.entries({ en, es, sv })) {
    it(`${lang} has a line and a tip for every state, and no em-dash`, () => {
      const nap = (locale as { pair: { nap: Record<string, unknown> & { tip: Record<string, string> } } }).pair.nap;
      for (const s of states) {
        expect(nap[s], `${lang} pair.nap.${s}`).toBeTruthy();
        expect(nap.tip[s], `${lang} pair.nap.tip.${s}`).toBeTruthy();
      }
      expect(JSON.stringify(nap)).not.toContain("—");
    });
  }
});

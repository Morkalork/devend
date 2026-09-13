/**
 * The menu track never stops.
 *
 * Reported as "the main menu music isn't on a loop, it just stops". The
 * crossfade-loop was working - driven through a faithful clock it hands the
 * track from one deck element to the other, twice over, exactly as designed.
 * What it did not have was a FLOOR. It hung on a single `timeupdate` listener
 * firing inside a ~1.4s window before the end of the track, and if that window
 * was ever missed the track ran to its end and there was silence for the rest
 * of the session: no `ended` handler, no native loop, nothing else that could
 * ever start it again.
 *
 * A hidden tab or a backgrounded phone is enough to miss it - throttling
 * `timeupdate` is the first thing browsers do to a background media element,
 * and a Capacitor game gets backgrounded constantly.
 *
 * So these tests are mostly about the floor, not the crossfade: the deck loops
 * natively, and the crossfade is a nicety layered over something that cannot
 * fail. The last test is the one that would have caught the report.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

/** Elements created by the module under test, in creation order. */
let made: FakeAudio[] = [];

class FakeAudio {
  volume = 0; muted = false; preload = ""; loop = false; paused = true;
  duration = 100; currentTime = 0;
  dataset: Record<string, string> = {};
  onerror: unknown = null;
  private _src = "";
  private listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  constructor() { made.push(this); }
  get src() { return this._src; }
  set src(v: string) { if (this._src !== v) this.currentTime = 0; this._src = v; }
  addEventListener(k: string, f: (...a: unknown[]) => void) { (this.listeners[k] ??= []).push(f); }
  removeEventListener(k: string, f: (...a: unknown[]) => void) {
    this.listeners[k] = (this.listeners[k] ?? []).filter(x => x !== f);
  }
  fire(k: string) { for (const f of [...(this.listeners[k] ?? [])]) f(); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  /** Play on to `t`, firing timeupdate every 250ms the way a browser does. */
  advanceTo(t: number) {
    for (let x = this.currentTime + 0.25; x <= t; x += 0.25) {
      this.currentTime = Math.min(x, this.duration);
      this.fire("timeupdate");
    }
    this.currentTime = t;
  }
  isMain() { return this._src.includes("main.mp3"); }
}

async function loadMusic() {
  made = [];
  vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
  // Run fades to completion immediately; this suite is about what plays, not
  // about the ramp.
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(performance.now() + 10_000); return 1;
  });
  vi.resetModules();
  const music = await import("@/lib/gameMusic");
  music.startMenuMusic();
  await Promise.resolve(); await Promise.resolve();
  return music;
}

const audible = () => made.filter(a => !a.paused && a.isMain());

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the deck loops natively, whatever else happens", () => {
  it("gives every deck element loop = true", async () => {
    await loadMusic();
    const playing = audible();
    expect(playing).toHaveLength(1);
    expect(playing[0].loop, "the playing element does not loop").toBe(true);
  });

  it("re-arms loop on an element the priming step borrowed", async () => {
    // primeElement clears loop to stop a 25ms silent clip repeating; the next
    // real switch onto that element has to put it back, or the SECOND track of
    // a session is the one that stops.
    const music = await loadMusic();
    music.playMusicForLevel(3);
    const band = made.find(a => a.src.includes("maps_1-5"));
    expect(band?.loop).toBe(true);
  });
});

describe("the crossfade-loop still does its job when it fires", () => {
  it("hands the track to the other element before the end", async () => {
    await loadMusic();
    const first = audible()[0];
    first.advanceTo(99);
    const now = audible();
    expect(now).toHaveLength(1);
    expect(now[0], "the crossfade did not hand over").not.toBe(first);
    expect(now[0].currentTime).toBeLessThan(2);
  });

  it("leaves the handed-off element paused, not looping underneath", async () => {
    vi.useFakeTimers();
    await loadMusic();
    const first = audible()[0];
    first.advanceTo(99);
    vi.advanceTimersByTime(5000);
    expect(first.paused, "the old element is still playing under the new one").toBe(true);
    expect(audible()).toHaveLength(1);
  });
});

describe("and when the crossfade window is missed, it still does not stop", () => {
  it("keeps playing when timeupdate is throttled past the handover window", async () => {
    // THE REPORTED BUG. A hidden tab or a backgrounded phone throttles
    // timeupdate to a crawl, so the ~1.4s window before the end goes by without
    // a single event and the handover never fires. Before the native loop this
    // left silence for the rest of the session.
    await loadMusic();
    const first = audible()[0];

    // One event well before the window, then nothing until the track is over:
    // the handover had no chance to fire.
    first.currentTime = 90;
    first.fire("timeupdate");
    expect(audible()[0], "the handover fired early; the test proves nothing").toBe(first);

    first.currentTime = first.duration;
    // The browser loops it rather than ending it, because loop is set.
    expect(first.loop).toBe(true);
    expect(first.paused).toBe(false);
    expect(audible()).toHaveLength(1);
  });

  it("recovers the crossfade on the next pass rather than staying degraded", async () => {
    // The listener is still attached after a missed window, so once the element
    // wraps around and plays back into the window, the seamless handover
    // resumes. A missed window costs one crossfade, not the feature.
    await loadMusic();
    const first = audible()[0];
    first.currentTime = 90;
    first.fire("timeupdate");
    expect(audible()[0]).toBe(first);

    // It wraps because the element loops natively - stated rather than assumed,
    // since without that this test would be checking a wrap the test itself
    // performed.
    expect(first.loop).toBe(true);
    first.currentTime = 0;
    first.advanceTo(99);
    expect(audible()[0], "the crossfade never came back").not.toBe(first);
  });
});

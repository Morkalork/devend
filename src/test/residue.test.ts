/**
 * A residue burst fires once, and no cache eviction can bring it back.
 *
 * Reported from play on level 7: "when I locked the ball in the bottom right
 * corner something happened and the lock highlight color flashes constantly.
 * Race condition?"
 *
 * Not a race. The game state after a lock is stable - measured over 240 frames
 * in the harness, nothing about it moves. What moved was a CACHE. The mote
 * layer sprays coloured residue when something happens, reading the events off
 * `objectDebris` and `assimilations`, and neither of those lists is ever
 * pruned: a lock stands in `assimilations` for the rest of the map. The only
 * thing stopping it spraying on every frame was a `seen` set of keys - which
 * grew with every event, so it was emptied wholesale past 200 entries. The
 * frame after that, every lock and every break still standing in those lists
 * read as brand new and sprayed again, in the lock's own colour, at the locked
 * pocket, for ever.
 */
import { describe, it, expect } from "vitest";
import { claimResidue, pruneResidueSeen, RESIDUE_FRESH_MS } from "@/lib/rendering/sleek/residue";

describe("an event gets exactly one burst", () => {
  it("fires on the frame it happens", () => {
    const seen = new Map<string, number>();
    expect(claimResidue(seen, "a:ball-1", 1000, 1000)).toBe(true);
  });

  it("does not fire again on the frames after it", () => {
    const seen = new Map<string, number>();
    claimResidue(seen, "a:ball-1", 1000, 1000);
    for (let t = 1000; t < 1000 + RESIDUE_FRESH_MS; t += 16) {
      expect(claimResidue(seen, "a:ball-1", 1000, t), `at +${t - 1000}ms`).toBe(false);
    }
  });

  it("tolerates a dropped frame or two", () => {
    // The burst is worth having a little late; missing it entirely because the
    // renderer skipped a frame is not.
    const seen = new Map<string, number>();
    expect(claimResidue(seen, "a:ball-1", 1000, 1000 + 100)).toBe(true);
  });

  it("refuses an event that has already played", () => {
    const seen = new Map<string, number>();
    expect(claimResidue(seen, "a:ball-1", 1000, 1000 + RESIDUE_FRESH_MS + 1)).toBe(false);
  });
});

describe("the cache cannot resurrect what has already played", () => {
  it("still refuses a stale event after the cache is emptied", () => {
    // THE BUG. The old cache was the only thing that remembered an event had
    // played, and it was emptied by size - so a lock from two minutes ago
    // sprayed again, and again, every time the cap tripped.
    const seen = new Map<string, number>();
    claimResidue(seen, "a:ball-1", 1000, 1000);
    seen.clear();
    expect(claimResidue(seen, "a:ball-1", 1000, 1000 + 60_000)).toBe(false);
  });

  it("holds for a whole map's worth of standing events", () => {
    // The shape of level 7: a lock and eleven brittle partitions, all still
    // present in the lists they are read from, frame after frame after frame.
    const seen = new Map<string, number>();
    const events = [
      { key: "a:ball-1", startTime: 5_000 },
      ...Array.from({ length: 11 }, (_, i) => ({ key: `d${i}`, startTime: 5_100 + i * 40 })),
    ];
    let bursts = 0;
    for (let now = 5_000; now < 5_000 + 120_000; now += 16) {
      for (const e of events) if (claimResidue(seen, e.key, e.startTime, now)) bursts++;
      pruneResidueSeen(seen, now);
    }
    expect(bursts, "each event sprayed more than once").toBe(events.length);
  });

  it("stays the size of the freshness window, not of the run", () => {
    const seen = new Map<string, number>();
    for (let now = 0; now < 60_000; now += 16) {
      claimResidue(seen, `d${now}`, now, now);   // a new event every frame
      pruneResidueSeen(seen, now);
      // Bounded by what can still be claimed, which is one window's worth.
      expect(seen.size).toBeLessThanOrEqual(Math.ceil(RESIDUE_FRESH_MS / 16) + 1);
    }
  });
});

describe("the layer reads it that way", () => {
  it("prunes by age and never by size", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("src/lib/rendering/sleek/moteLayer.ts", "utf8"));
    expect(src).toContain("claimResidue(this.seen");
    expect(src).toContain("pruneResidueSeen(this.seen, now)");
    // The line that turned a one-shot into a loop.
    expect(src, "the residue cache is being emptied by size again")
      .not.toContain("this.seen.clear()");
  });
});

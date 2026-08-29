/**
 * Sound effects do not pile up on the master bus.
 *
 * Reported as the game getting slower after a few rounds. Every sound spun up
 * around six oscillator/filter/gain nodes, connected them to the module
 * singleton `masterGain`, called stop() and never disconnected. Stopped nodes
 * are supposed to auto-release, but mobile WebViews do it unreliably - and
 * `masterGain` and the AudioContext both outlive the per-round GameScreen
 * remount, so the dead nodes accumulated for the whole session rather than the
 * round.
 *
 * These tests measure the leak itself - how many things are still hanging off
 * the master bus - rather than checking that some particular cleanup call was
 * made. That matters here because the previous attempt at this fix, on
 * perf/audio-node-cleanup, disconnected each chain by hand at each call site.
 * It was correct when written, for the five sounds that existed then. There are
 * twelve now. A test that asserted "disconnect was called" would have gone on
 * passing while the seven newer sounds leaked; counting what is still attached
 * is what notices.
 *
 * jsdom has no Web Audio, so the context below is a recording stub. It is not
 * pretending to make sound: it is a graph, and the graph is the thing under
 * test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** A node in the fake graph, which remembers what is plugged into it. */
interface FakeNode {
  kind: string;
  outputs: Set<FakeNode>;
  inputs: Set<FakeNode>;
  connect(to: FakeNode): void;
  disconnect(to?: FakeNode): void;
}

let created: FakeNode[] = [];

function node(kind: string): FakeNode {
  const n: Partial<FakeNode> & Record<string, unknown> = {
    kind,
    outputs: new Set<FakeNode>(),
    inputs: new Set<FakeNode>(),
  };
  n.connect = (to: FakeNode) => {
    (n.outputs as Set<FakeNode>).add(to);
    to.inputs.add(n as FakeNode);
  };
  n.disconnect = (to?: FakeNode) => {
    const outs = n.outputs as Set<FakeNode>;
    for (const o of to ? [to] : [...outs]) {
      outs.delete(o);
      o.inputs.delete(n as FakeNode);
    }
  };
  // Everything a sound might touch. An AudioParam is just a recorder.
  const param = () => ({
    value: 0,
    setValueAtTime: () => {}, linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  Object.assign(n, {
    gain: param(), frequency: param(), Q: param(), detune: param(),
    playbackRate: param(), type: "sine", buffer: null, loop: false,
    start: () => {}, stop: () => {},
  });
  created.push(n as FakeNode);
  return n as FakeNode;
}

function fakeContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: node("destination"),
    resume: () => {},
    createGain: () => node("gain"),
    createOscillator: () => node("oscillator"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("bufferSource"),
    createBuffer: (_c: number, len: number) => ({
      getChannelData: () => new Float32Array(len),
    }),
  };
  return ctx;
}

/** Load gameAudio fresh, so its module-level context singleton is rebuilt. */
async function loadAudio() {
  vi.resetModules();
  created = [];
  (window as unknown as Record<string, unknown>).AudioContext =
    function () { return fakeContext(); } as unknown as typeof AudioContext;
  const mod = await import("@/lib/gameAudio");
  mod.setAudioMuted(false);
  return mod;
}

/** The master bus is the gain that feeds the low-pass feeding the destination. */
function masterBus(): FakeNode {
  const dest = created.find(n => n.kind === "destination")!;
  const softener = [...dest.inputs][0];
  expect(softener, "nothing reached the destination").toBeTruthy();
  const master = [...softener.inputs][0];

  expect(master, "nothing reached the master low-pass").toBeTruthy();
  return master;
}

/** Every sound the game can make. */
const SOUNDS = [
  "playWallHitSound", "playBallCollideSound", "playFenceBreakSound",
  "playDeathSound", "playBallLockSound", "playCutClaimedSound",
  "playPickupClaimedSound", "playBossJumpSound", "playHeartbeatSound",
  "playBossChargeSound", "playBossLandSound", "playLevelCompleteSound",
] as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the master bus after a long session", () => {
  it("is left empty once every sound has been played and released", async () => {
    // THE regression, stated as the symptom rather than as a call: play
    // everything, wait, and nothing may still be attached.
    const audio = await loadAudio() as unknown as Record<string, () => void>;
    for (const s of SOUNDS) audio[s]();
    const master = masterBus();
    expect(master.inputs.size, "nothing connected at all - the stub is wrong")
      .toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect([...master.inputs].map(n => n.kind), "left hanging off the master bus")
      .toEqual([]);
  });

  it("does not grow round over round", async () => {
    // The actual complaint was "slower after a few rounds". masterGain and the
    // AudioContext outlive the GameScreen remount, so what matters is not that
    // one sound cleans up but that a hundred of them leave the graph the size
    // it started.
    const audio = await loadAudio() as unknown as Record<string, () => void>;
    audio.initAudio(); // the context is built lazily; this test reads the graph first
    const master = masterBus();
    for (let round = 0; round < 10; round++) {
      for (const s of SOUNDS) audio[s]();
      await vi.advanceTimersByTimeAsync(5000);
      expect(master.inputs.size, `graph grew by round ${round + 1}`).toBe(0);
    }
  });

  it("keeps every sound attached while it is still playing", async () => {
    // The release must not be so eager that it cuts the sound off. The longest
    // sound in the file ends 1.33s in (ball lock: st = now + 0.98, stopped at
    // st + 0.35), so nothing may be released before then.
    const audio = await loadAudio() as unknown as Record<string, () => void>;
    for (const s of SOUNDS) audio[s]();
    const master = masterBus();
    await vi.advanceTimersByTimeAsync(1400);
    expect(master.inputs.size, "a sound was cut off before it finished")
      .toBe(SOUNDS.length);
  });

  it("gives every sound its own bus rather than sharing one", async () => {
    // A shared bus would be released while a later sound was still feeding it,
    // which is the same defect the other way round.
    const audio = await loadAudio() as unknown as Record<string, () => void>;
    audio.playWallHitSound();
    audio.playWallHitSound();
    expect(masterBus().inputs.size).toBe(2);
  });
});

describe("what the sounds hang off", () => {
  it("routes nothing directly onto the master bus any more", async () => {
    // Each sound attaches by exactly ONE node, its own bus. That is what makes
    // the cleanup complete by construction: releasing that one node frees the
    // whole subtree however many nodes someone adds to the chain later.
    const audio = await loadAudio() as unknown as Record<string, () => void>;
    audio.playFenceBreakSound();
    const master = masterBus();
    expect(master.inputs.size, "a sound attached by more than one node").toBe(1);
    const bus = [...master.inputs][0];
    expect(bus.kind).toBe("gain");
    expect(bus.inputs.size, "the bus has nothing feeding it").toBeGreaterThan(0);
  });

  it("stays silent, and allocates nothing, while muted", async () => {
    // Muted play used to be an early return before any node was made. It still
    // must be, or a muted session leaks exactly as fast as a loud one.
    const audio = await loadAudio() as unknown as Record<string, (m?: boolean) => void>;
    audio.initAudio(); // ditto: nothing is allocated while muted, so nothing would build it
    const master = masterBus();
    audio.setAudioMuted(true);
    for (const s of SOUNDS) audio[s]();
    expect(master.inputs.size, "muted sounds still built a graph").toBe(0);
  });
});

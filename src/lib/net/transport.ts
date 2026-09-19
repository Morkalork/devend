/**
 * transport — the pipe two devices talk over, and nothing more.
 *
 * Everything above this line (the lockstep, the commands, the game) is written
 * against this interface, so the same lockstep runs over an in-memory pipe in a
 * test, a WebRTC data channel between two phones on the same Wi-Fi, and a
 * Nearby Connections link with no network at all (TWO_PLAYER_PLAN.md steps 4,
 * 5 and 9). None of them tells the lockstep which it is.
 *
 * Deliberately NOT in this interface: ordering and delivery guarantees. The
 * lockstep numbers its own messages by tick and tolerates a duplicate, so a
 * transport only has to promise that a message that arrives, arrives whole.
 */

/** The messages a pair exchange. Small, and none of them is game state. */
export type NetMessage =
  /** The first thing either side sends: who this is, and what it is running. */
  | {
      t: "hello";
      /** Bumped when the wire format changes; a mismatch is a refusal, not a desync. */
      protocol: number;
      /** This device's stable id (step 6b), for the pair identity. */
      deviceId: string;
      /** What the player is called on the other phone's screen. */
      name: string;
      /** The build, so "update the app" beats a desync ten seconds into a map. */
      build: string;
      /** The pair save this device holds, if any (step 6b). */
      save?: { runId: string; levelIndex: number; savedAt: number };
    }
  /** One tick's worth of one player's commands. Sent EVERY tick, empty or not:
   *  silence has to mean "still connected and did nothing", not "not yet". */
  | { t: "tick"; tick: number; cmds: import("./commands").GameCommand[] }
  /** A periodic agreement check (see stateHash.ts). */
  | { t: "hash"; tick: number; motion: string; topology: string }
  /** The host's board, when the hashes disagreed. */
  | { t: "resync"; tick: number; snapshot: unknown }
  /** Run-level state the host owns (step 6). */
  | { t: "runState"; payload: unknown }
  /**
   * The modifier set this device is about to play a map under (step 6).
   *
   * Sent at every map start and compared before anyone cuts. The other hashes
   * notice a divergence a second after it happens; this one notices the class
   * of divergence that is already baked in before the first tick, when two
   * players hold different certificates or achievements.
   */
  | { t: "modifiers"; level: number; hash: string }
  /** A between-maps decision only the host makes (step 6). */
  | { t: "hostChoice"; choice: string; payload?: unknown }
  /** The partner's finger, for the preview (step 7). Not simulation state:
   *  dropping one costs a frame of someone else's cursor and nothing else. */
  | { t: "pointer"; player: number; x: number; y: number; down: boolean }
  /**
   * The heartbeat, and the only way the round trip gets measured.
   *
   * A transport answers a ping with a pong carrying the same timestamp and
   * hands neither to the session: this is about the link, not the game, and a
   * message the lockstep did not expect is one it would have to have an
   * opinion about.
   */
  | { t: "ping"; at: number }
  | { t: "pong"; at: number };

export interface Transport {
  send(msg: NetMessage): void;
  /** Register the one handler. Replaces any previous one. */
  onMessage(handler: (msg: NetMessage) => void): void;
  /** Called when the link drops for good; the session pauses the map on it. */
  onClose(handler: (reason: string) => void): void;
  close(): void;
  /** Round trip in milliseconds, or null before the first measurement. Drives
   *  the adaptive input delay. */
  readonly rttMs: number | null;
  readonly isOpen: boolean;
}

/** How a MemoryTransport should misbehave, so a test can ask for a bad day. */
export interface LinkConditions {
  /** One-way delay, milliseconds. */
  latencyMs: number;
  /** Random extra delay on top, 0..jitterMs. */
  jitterMs: number;
  /** Fraction of messages dropped outright, 0..1. */
  loss: number;
}

export const PERFECT_LINK: LinkConditions = { latencyMs: 0, jitterMs: 0, loss: 0 };

/**
 * Two transports wired to each other in one process.
 *
 * This is what makes two-player testable with no phones, no network and no
 * WebRTC: the Playground runs two boards side by side through a pair of these,
 * and the tests run the lockstep through them with the latency and loss dialled
 * up. A bug that only shows at 200ms is a bug you can write a test for.
 *
 * Delivery is scheduled rather than immediate even on a perfect link, because a
 * transport that delivered synchronously would let the two sims re-enter each
 * other and hide every ordering bug this is meant to find.
 */
export class MemoryTransport implements Transport {
  private peer: MemoryTransport | null = null;
  private handler: ((msg: NetMessage) => void) | null = null;
  private closeHandler: ((reason: string) => void) | null = null;
  private open = true;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private rand: () => number;

  /** Queue used when the pair is driven by hand instead of by timers. */
  private inbox: { at: number; msg: NetMessage }[] = [];
  private clockMs = 0;

  constructor(
    public conditions: LinkConditions = PERFECT_LINK,
    /**
     * Manual mode: nothing is delivered until deliverUntil() is called. Tests
     * use it so a run is reproducible; the Playground leaves it off and lets
     * real timers do the work.
     */
    public manual = false,
    rand: () => number = Math.random,
  ) {
    this.rand = rand;
  }

  /** Wire two fresh transports together. Returns them as [a, b]. */
  static pair(
    conditions: LinkConditions = PERFECT_LINK,
    manual = false,
    rand: () => number = Math.random,
  ): [MemoryTransport, MemoryTransport] {
    const a = new MemoryTransport(conditions, manual, rand);
    const b = new MemoryTransport(conditions, manual, rand);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  get isOpen(): boolean { return this.open; }

  get rttMs(): number | null {
    return this.open ? this.conditions.latencyMs * 2 : null;
  }

  send(msg: NetMessage): void {
    const peer = this.peer;
    if (!this.open || !peer || !peer.open) return;
    if (this.conditions.loss > 0 && this.rand() < this.conditions.loss) return;
    const delay = this.conditions.latencyMs + this.rand() * this.conditions.jitterMs;
    // Structured-clone the message so a test cannot accidentally share a
    // mutable object between the two sims and pass for the wrong reason.
    const copy = JSON.parse(JSON.stringify(msg)) as NetMessage;
    if (this.manual) {
      peer.inbox.push({ at: peer.clockMs + delay, msg: copy });
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      peer.deliver(copy);
    }, delay);
    this.timers.add(timer);
  }

  /** Manual mode: advance this side's clock and hand over everything due. */
  deliverUntil(ms: number): void {
    this.clockMs = ms;
    const due = this.inbox.filter(e => e.at <= ms);
    this.inbox = this.inbox.filter(e => e.at > ms);
    due.sort((a, b) => a.at - b.at);
    for (const e of due) this.deliver(e.msg);
  }

  private deliver(msg: NetMessage): void {
    if (!this.open) return;
    this.handler?.(msg);
  }

  onMessage(handler: (msg: NetMessage) => void): void { this.handler = handler; }
  onClose(handler: (reason: string) => void): void { this.closeHandler = handler; }

  close(reason = "closed"): void {
    if (!this.open) return;
    this.open = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.inbox = [];
    this.closeHandler?.(reason);
    const peer = this.peer;
    this.peer = null;
    if (peer && peer.open) peer.close("peer closed");
  }
}

/**
 * relay — the transport for when two phones cannot see each other.
 *
 * The direct link (webrtc.ts) needs the two phones to reach each other on the
 * local network, and almost every public Wi-Fi forbids exactly that: client
 * isolation lets each device out to the internet and no device across to
 * another. Both phones can still reach the server the game came from, so each
 * holds a WebSocket to it and the server passes the messages across
 * (server/relay.js). Slower than the direct link by one trip to the server and
 * back, which the adaptive input delay absorbs, and it works on any network
 * that can load the game at all.
 *
 * This is a fallback, not the default. The pairing tries the direct link
 * first and only settles here when it has not opened in a few seconds
 * (pickRoute below), because a direct link on a home Wi-Fi is quicker and does
 * not depend on the server staying up for the length of a run.
 */
import type { NetMessage, Transport } from "./transport";
import type { WebRtcTransport } from "./webrtc";
import { CONNECT_TIMEOUT_MS } from "./webrtc";

/** Same heartbeat as the direct link, so the delay adapts the same way. */
const PING_EVERY_MS = 2000;

/**
 * How long the direct link gets to open before the pair settles on the relay.
 *
 * On a home network the channel opens in well under a second once the answer
 * is in, so four seconds is generous for the case that works; on an isolated
 * network it never opens at all, and every second past this is a second both
 * players stare at a spinner for nothing.
 */
export const DIRECT_GRACE_MS = 4000;

export type RelayRole = "host" | "guest";

/** The relay's address on the server the page came from. */
export function relayUrl(room: string, role: RelayRole, loc: Pick<Location, "protocol" | "host"> = window.location): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/api/relay/${encodeURIComponent(room)}?role=${role}`;
}

/** What the server says about the room, as opposed to what the partner says. */
interface RelayNotice { t: "relay"; state: "waiting" | "paired" }

export class RelayTransport implements Transport {
  private ws: WebSocket;
  private handler: ((msg: NetMessage) => void) | null = null;
  private closeHandler: ((reason: string) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private rtt: number | null = null;
  private paired = false;
  private dead: string | null = null;
  private pairedWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", e => this.receive(e.data));
    // The heartbeat starts with the socket, not with the pairing. Heroku's
    // router closes a connection that is silent for 55 seconds, and the host
    // can sit in the room that long while the partner finds their camera;
    // the server drops a ping with nobody to pass it to, which is fine, since
    // the traffic is all it was for.
    ws.addEventListener("open", () => this.startPing());
    // A refused upgrade (a full server, a taken seat, an old server with no
    // relay at all) arrives as an error then a close, with no reason the page
    // is allowed to read. Either way the relay is not available.
    ws.addEventListener("error", () => this.fail("relay error"));
    ws.addEventListener("close", e => this.fail(e.reason || `relay closed (${e.code})`));
  }

  /**
   * Take a seat in the room. Returns at once; the socket connects in the
   * background, so this can be started the moment the room exists and be
   * ready by the time it is needed. Null where there is no WebSocket at all.
   */
  static connect(room: string, role: RelayRole, url = relayUrl(room, role)): RelayTransport | null {
    if (typeof WebSocket === "undefined") return null;
    try {
      return new RelayTransport(new WebSocket(url));
    } catch {
      return null;
    }
  }

  /** Wrap a socket someone else opened. For the tests. */
  static wrap(ws: WebSocket): RelayTransport { return new RelayTransport(ws); }

  get isOpen(): boolean { return this.paired && this.dead === null; }
  get rttMs(): number | null { return this.rtt; }

  /** Resolves when both phones are in the room; rejects on timeout or failure. */
  waitPaired(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    if (this.dead !== null) return Promise.reject(new Error(this.dead));
    if (this.paired) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      const timer = setTimeout(() => {
        this.pairedWaiters = this.pairedWaiters.filter(w => w !== waiter);
        reject(new Error("partner never reached the relay"));
      }, Math.max(0, timeoutMs));
      this.pairedWaiters.push(waiter);
    });
  }

  private receive(data: unknown): void {
    let parsed: unknown;
    try { parsed = JSON.parse(typeof data === "string" ? data : ""); }
    catch { return; }
    const msg = parsed as NetMessage | RelayNotice;
    if (msg.t === "relay") {
      if (msg.state === "paired" && !this.paired) {
        this.paired = true;
        // Measure straight away, so the input delay is set from a real round
        // trip rather than the floor for the first two seconds.
        this.startPing();
        for (const w of this.pairedWaiters) w.resolve();
        this.pairedWaiters = [];
      }
      return;
    }
    // The heartbeat stays in here, exactly as on the direct link.
    if (msg.t === "ping") { this.rawSend({ t: "pong", at: msg.at }); return; }
    if (msg.t === "pong") { this.rtt = Math.max(0, Date.now() - msg.at); return; }
    this.handler?.(msg);
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.rawSend({ t: "ping", at: Date.now() });
    this.pingTimer = setInterval(ping, PING_EVERY_MS);
    ping();
  }

  private stopPing(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private rawSend(msg: NetMessage): void {
    if (this.ws.readyState !== 1 /* OPEN */) return;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* the close handler deals with it */ }
  }

  send(msg: NetMessage): void { this.rawSend(msg); }
  onMessage(handler: (msg: NetMessage) => void): void { this.handler = handler; }
  onClose(handler: (reason: string) => void): void { this.closeHandler = handler; }

  private fail(reason: string): void {
    if (this.dead !== null) return;
    const wasOpen = this.isOpen;
    this.dead = reason;
    this.stopPing();
    for (const w of this.pairedWaiters) w.reject(new Error(reason));
    this.pairedWaiters = [];
    if (wasOpen) this.closeHandler?.(reason);
  }

  close(): void {
    this.stopPing();
    // Marked dead before the socket closes, so walking away is not reported
    // to the session as the link dropping.
    if (this.dead === null) this.dead = "closed";
    for (const w of this.pairedWaiters) w.reject(new Error("closed"));
    this.pairedWaiters = [];
    try { this.ws.close(1000, "done"); } catch { /* already gone */ }
  }
}

// ── Which link a pair ends up on ────────────────────────────────────────────

export type PairRoute = "direct" | "relay";

/**
 * Host side: decide between the direct link and the relay.
 *
 * The HOST decides, and only the host, so the two phones can never settle on
 * different links: it says hello on the one it picked, and the guest answers
 * on whichever link the hello arrived by (awaitHostHello).
 *
 * The direct link gets the first few seconds, since where it works it is the
 * better link. A relay that never connected (an older server, no WebSocket)
 * leaves the direct link its full timeout, which is exactly the behaviour
 * before the relay existed.
 */
export async function pickRoute(
  direct: Pick<WebRtcTransport, "waitOpen">,
  relay: Pick<RelayTransport, "waitPaired"> | null,
  opts: { forceRelay?: boolean; graceMs?: number; timeoutMs?: number; now?: () => number } = {},
): Promise<PairRoute> {
  const grace = opts.graceMs ?? DIRECT_GRACE_MS;
  const timeout = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const started = now();
  if (opts.forceRelay && relay) {
    await relay.waitPaired(timeout);
    return "relay";
  }
  try {
    await direct.waitOpen(relay ? grace : timeout);
    return "direct";
  } catch (err) {
    if (!relay) throw err;
  }
  // Past the grace period, whichever link is up first. The direct link keeps
  // its chance: a relay that failed outright (a server without one) must not
  // cut the direct link's wait short of what it had before the relay existed.
  // The rest of the budget, but never less than a grace period, so a link one
  // moment from ready does not lose to arithmetic.
  const remaining = Math.max(grace, timeout - (now() - started));
  return firstReady([
    direct.waitOpen(remaining).then(() => "direct" as const),
    relay.waitPaired(remaining).then(() => "relay" as const),
  ]);
}

/** The first to resolve; rejects with the last error only when all reject. */
function firstReady<T>(attempts: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let failed = 0;
    for (const attempt of attempts) {
      attempt.then(resolve, err => {
        if (++failed === attempts.length) reject(err);
      });
    }
  });
}

type Hello = Extract<NetMessage, { t: "hello" }>;

/**
 * Guest side: listen on every link and follow the host's hello.
 *
 * Resolves with the link the hello came in on and the hello itself, so the
 * handshake can answer it without waiting for a second one. The other links
 * are the caller's to close.
 */
export function awaitHostHello(
  links: Transport[],
  timeoutMs = CONNECT_TIMEOUT_MS + DIRECT_GRACE_MS,
): Promise<{ transport: Transport; hello: Hello }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("timeout"));
    }, timeoutMs);
    for (const link of links) {
      link.onMessage(msg => {
        if (done || msg.t !== "hello") return;
        done = true;
        clearTimeout(timer);
        resolve({ transport: link, hello: msg });
      });
    }
  });
}

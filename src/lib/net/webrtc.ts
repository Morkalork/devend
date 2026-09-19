/**
 * webrtc — the transport two phones on the same Wi-Fi actually use
 * (TWO_PLAYER_PLAN.md step 5).
 *
 * Deliberately narrow. No STUN, no TURN, no trickle, no renegotiation: two
 * devices in the same room are on the same network, so the only candidates
 * worth gathering are the host ones, and waiting for gathering to finish once
 * is simpler than streaming candidates through a channel that does not exist
 * yet. `iceServers: []` is not an oversight, it is the design: nothing in this
 * connection is allowed to reach outside the room.
 *
 * The shape of a pairing:
 *
 *   host                                   guest
 *   ----                                   -----
 *   createOffer, gather, pack  ->  QR  ->  scan with the camera app, open link
 *                                          unpack, createAnswer, gather, pack
 *                              <- mailbox  PUT /api/room/<id>
 *   GET /api/room/<id>, unpack
 *   both sides' ICE agents find each other on the LAN, channel opens
 *
 * The data channel is ordered and reliable. The lockstep does not need order
 * (its messages carry their own tick) but it does need every tick message to
 * arrive, and an unreliable channel that dropped one would stall the pair
 * until the next one covered it, which is a stutter for nothing.
 */
import type { NetMessage, Transport } from "./transport";
import { packSdp, unpackSdp, type PackedSdp } from "./sdp";

/** How long to wait for ICE gathering before giving up on the extra candidates. */
const GATHER_TIMEOUT_MS = 2500;

/** How long a pairing may take before the player is told what to try instead. */
export const CONNECT_TIMEOUT_MS = 10_000;

/** Heartbeat interval; also how often the round trip is re-measured. */
const PING_EVERY_MS = 2000;

function newConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    // Host candidates only. See the header: there is no server in this path,
    // and a srflx candidate would mean there was.
    iceServers: [],
    // Nothing is negotiated per-candidate, so one pool entry is plenty.
    iceCandidatePoolSize: 0,
  });
}

/** Resolve once the browser has finished gathering, or the timeout fires. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    // A timeout rather than a hang: on some networks a candidate type never
    // arrives and gathering never completes, and the host candidates we
    // actually need are the first ones in.
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export class WebRtcTransport implements Transport {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private handler: ((msg: NetMessage) => void) | null = null;
  private closeHandler: ((reason: string) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingAt = 0;
  private rtt: number | null = null;
  private open = false;

  private constructor(pc: RTCPeerConnection) {
    this.pc = pc;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.fail(`connection ${pc.connectionState}`);
      }
    });
  }

  get isOpen(): boolean { return this.open; }
  get rttMs(): number | null { return this.rtt; }

  /**
   * Host side: build the offer that goes in the QR.
   *
   * Returns the transport (not connected yet) and the packed offer. Call
   * acceptAnswer once the guest's answer comes back from the mailbox.
   */
  static async host(): Promise<{ transport: WebRtcTransport; offer: PackedSdp }> {
    const pc = newConnection();
    const transport = new WebRtcTransport(pc);
    // The host creates the channel; the guest picks it up from ondatachannel.
    const channel = pc.createDataChannel("devend", { ordered: true });
    transport.attach(channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gathered(pc);
    return { transport, offer: packSdp(pc.localDescription?.sdp ?? "", "o") };
  }

  /** Host side: finish the handshake with the answer the guest left. */
  async acceptAnswer(answer: PackedSdp): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp: unpackSdp(answer) });
  }

  /**
   * Guest side: take the offer out of the link and answer it.
   *
   * Returns the transport and the packed answer to PUT to the mailbox.
   */
  static async guest(offer: PackedSdp): Promise<{ transport: WebRtcTransport; answer: PackedSdp }> {
    const pc = newConnection();
    const transport = new WebRtcTransport(pc);
    pc.addEventListener("datachannel", e => transport.attach(e.channel));
    await pc.setRemoteDescription({ type: "offer", sdp: unpackSdp(offer) });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await gathered(pc);
    return { transport, answer: packSdp(pc.localDescription?.sdp ?? "", "a") };
  }

  /** Resolves when the channel opens, rejects on timeout or failure. */
  waitOpen(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    if (this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timeout"));
      }, timeoutMs);
      this.onOpenOnce = () => { clearTimeout(timer); resolve(); };
      this.onFailOnce = (r) => { clearTimeout(timer); reject(new Error(r)); };
    });
  }

  private onOpenOnce: (() => void) | null = null;
  private onFailOnce: ((reason: string) => void) | null = null;

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => {
      this.open = true;
      this.startPing();
      this.onOpenOnce?.();
      this.onOpenOnce = null;
    });
    channel.addEventListener("close", () => this.fail("channel closed"));
    channel.addEventListener("error", () => this.fail("channel error"));
    channel.addEventListener("message", e => {
      let parsed: unknown;
      try { parsed = JSON.parse(typeof e.data === "string" ? e.data : ""); }
      catch { return; }
      const msg = parsed as NetMessage;
      // The heartbeat never reaches the lockstep: it exists to measure the
      // link, and a message the session did not expect is a message it has to
      // have an opinion about.
      if (msg.t === "ping") {
        this.rawSend({ t: "pong", at: msg.at });
        return;
      }
      if (msg.t === "pong") {
        this.rtt = Math.max(0, Date.now() - msg.at);
        return;
      }
      this.handler?.(msg);
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.lastPingAt = Date.now();
      this.rawSend({ t: "ping", at: this.lastPingAt });
    }, PING_EVERY_MS);
    // One straight away, so the input delay is set from a real measurement
    // rather than the floor for the first two seconds.
    this.lastPingAt = Date.now();
    this.rawSend({ t: "ping", at: this.lastPingAt });
  }

  private stopPing(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private rawSend(msg: NetMessage): void {
    if (this.channel?.readyState !== "open") return;
    try { this.channel.send(JSON.stringify(msg)); } catch { /* the close handler deals with it */ }
  }

  send(msg: NetMessage): void { this.rawSend(msg); }
  onMessage(handler: (msg: NetMessage) => void): void { this.handler = handler; }
  onClose(handler: (reason: string) => void): void { this.closeHandler = handler; }

  private fail(reason: string): void {
    if (!this.open && !this.onFailOnce && !this.closeHandler) return;
    const wasOpen = this.open;
    this.open = false;
    this.stopPing();
    this.onFailOnce?.(reason);
    this.onFailOnce = null;
    if (wasOpen) this.closeHandler?.(reason);
  }

  close(): void {
    this.stopPing();
    this.open = false;
    try { this.channel?.close(); } catch { /* already gone */ }
    try { this.pc.close(); } catch { /* already gone */ }
  }
}

// ── The mailbox, from the app's side ────────────────────────────────────────

/** Leave the answer for the host. */
export async function postAnswer(room: string, answer: PackedSdp): Promise<void> {
  const res = await fetch(`/api/room/${encodeURIComponent(room)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: JSON.stringify(answer) }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(res.status === 409 ? "someone already joined" : `mailbox said ${res.status}`);
  }
}

/**
 * Poll until the guest's answer turns up, the caller gives up, or the deadline
 * passes. Polling rather than a socket because the whole exchange is one
 * message and a socket would be more machinery than the thing it carries.
 */
export async function awaitAnswer(
  room: string,
  signal: AbortSignal,
  timeoutMs = CONNECT_TIMEOUT_MS * 6,
): Promise<PackedSdp> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    const res = await fetch(`/api/room/${encodeURIComponent(room)}`, { cache: "no-store" });
    if (res.status === 200) {
      const body = await res.json() as { answer: string };
      return JSON.parse(body.answer) as PackedSdp;
    }
    await new Promise(r => setTimeout(r, 700));
  }
  throw new Error(signal.aborted ? "cancelled" : "nobody joined");
}

/** The host gave up: drop the room rather than leave it for the sweeper. */
export function cancelRoom(room: string): void {
  void fetch(`/api/room/${encodeURIComponent(room)}`, { method: "DELETE" }).catch(() => {});
}

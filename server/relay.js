/**
 * The relay: two phones that cannot reach each other, talking through here.
 *
 * Pair Programming was built to go phone to phone (TWO_PLAYER_PLAN.md step 5):
 * both on one Wi-Fi, a WebRTC data channel between them, and this server only
 * ever carrying the one-line answer in the mailbox (pairRooms.js). That holds
 * at home. It does not hold on a cafe, hotel or office network, which almost
 * all run CLIENT ISOLATION: every device on the Wi-Fi can reach the internet
 * and none of them can reach each other. The two phones find each other's
 * addresses, knock, and nothing answers.
 *
 * Both phones CAN reach this server, because they loaded the game from it. So
 * when the direct link does not open, each phone holds a WebSocket to here and
 * this passes every message across, unread and unchanged. A WebSocket rather
 * than a TURN server because Heroku routes HTTP (and its upgrade) and nothing
 * else: no UDP, no raw ports, so TURN cannot run on a dyno, and a hosted TURN
 * service is billed by the gigabyte.
 *
 * Zero dependencies, like the rest of the server. Node still has no WebSocket
 * SERVER built in (it has had a client since 22), and the `ws` package would
 * be the first dependency the production server ever took, for a protocol
 * whose useful subset is one handshake line and a frame header. That subset is
 * below: RFC 6455 text/binary frames, fragmentation, ping/pong and close.
 *
 * What it will not do, on purpose:
 * - read the traffic. It forwards frame payloads byte for byte; it never
 *   parses a game message, so there is nothing here to get out of step with
 *   the lockstep's wire format;
 * - buffer for an absent partner. A message sent before the other phone has
 *   joined is dropped, and the phones do not send before they are told
 *   "paired", so nothing real is lost;
 * - survive a restart. Rooms are in memory; a dyno restart or a deploy drops
 *   every live relay, which the pair save/resume flow already covers, exactly
 *   as it covers a phone walking out of Wi-Fi range.
 *
 * Heroku closes a connection that is silent for 55 seconds. The phones ping
 * each other every two seconds through here (the transport's heartbeat), so a
 * live relay is never silent; a dead one is closed by the idle sweep below.
 */
import { createHash } from "node:crypto";

/** The GUID every WebSocket server hashes the client's key with (RFC 6455 1.3). */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Same shape as the mailbox's room ids: the room is the one the QR named. */
const ROOM_ID = /^[a-z0-9]{4,32}$/;

/** How long a phone may wait in a room for its partner before it is sent away. */
export const RELAY_WAIT_MS = 2 * 60 * 1000;

/** A paired socket that has said nothing for this long is gone. The phones
 *  ping every two seconds, so this is thirty missed heartbeats. */
export const RELAY_IDLE_MS = 60 * 1000;

/**
 * Largest message passed on. The biggest thing the lockstep sends is a resync
 * snapshot, and the WebRTC path already caps a message at 256 KB
 * (max-message-size in sdp.ts), so the relay carries whatever the direct link
 * would have.
 */
export const RELAY_MAX_MESSAGE = 256 * 1024;

/** A partner that stops reading while this much piles up for it is dropped,
 *  rather than letting one stalled phone grow the dyno's memory. */
const MAX_BACKLOG = 1024 * 1024;

/** Plenty for any real table count; a flood past it is refused, not queued. */
export const MAX_RELAY_ROOMS = 500;

const SWEEP_EVERY_MS = 15 * 1000;

/** roomId -> { host?: Conn, guest?: Conn, at } */
const rooms = new Map();

let sweeper = null;

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => sweepRelays(Date.now()), SWEEP_EVERY_MS);
  // The server has other reasons to stay up; this timer is not one of them.
  sweeper.unref?.();
}

/** Close whatever has waited or idled too long. Exported for the tests. */
export function sweepRelays(now) {
  for (const [id, room] of rooms) {
    const paired = room.host && room.guest;
    if (!paired && now - room.at > RELAY_WAIT_MS) {
      room.host?.close(4408, "partner never came");
      room.guest?.close(4408, "partner never came");
      rooms.delete(id);
      continue;
    }
    for (const conn of [room.host, room.guest]) {
      if (conn && now - conn.lastSeen > RELAY_IDLE_MS) conn.close(4408, "idle");
    }
  }
  if (rooms.size === 0 && sweeper) { clearInterval(sweeper); sweeper = null; }
}

/** One frame, server to client: never masked (RFC 6455 5.1). */
function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

/** The close frame's body: a two-byte code, then a short UTF-8 reason. */
function closePayload(code, reason) {
  const text = Buffer.from(String(reason).slice(0, 100), "utf-8");
  const body = Buffer.alloc(2 + text.length);
  body.writeUInt16BE(code, 0);
  text.copy(body, 2);
  return body;
}

/**
 * One phone's end of the relay.
 *
 * Parses what the phone sends, answers pings, and hands each complete data
 * message to `onMessage` as the opcode and the raw payload, so it can be
 * written straight back out to the partner without a decode and re-encode.
 */
class Conn {
  constructor(socket, head, onMessage, onClose) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = null; // { opcode, parts: Buffer[], size }
    this.closed = false;
    this.lastSeen = Date.now();

    // A tick is a few dozen bytes and there are 120 of them a second; Nagle
    // holding each one back to batch it would add its delay to every tick.
    socket.setNoDelay?.(true);
    socket.on("data", (chunk) => {
      this.lastSeen = Date.now();
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.drain();
    });
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
    socket.on("end", () => this.finish());
  }

  /** Parse anything that arrived with the upgrade itself. Called once the
   *  caller holds the reference, since parsing can already close it. */
  start() {
    if (this.buf.length) this.drain();
  }

  /** Parse every complete frame in the buffer. */
  drain() {
    while (!this.closed) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(RELAY_MAX_MESSAGE)) return this.close(1009, "message too big");
        len = Number(big);
        at = 10;
      }
      // Every frame from a browser is masked; one that is not did not come
      // from a browser, and the RFC says to drop the connection.
      if (!masked) return this.close(1002, "unmasked frame");
      if (len > RELAY_MAX_MESSAGE) return this.close(1009, "message too big");
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4);
      const payload = Buffer.from(b.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(at + 4 + len);
      this.handle(fin, opcode, payload);
    }
  }

  handle(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: { // continuation
        if (!this.fragments) return this.close(1002, "stray continuation");
        this.fragments.parts.push(payload);
        this.fragments.size += payload.length;
        if (this.fragments.size > RELAY_MAX_MESSAGE) return this.close(1009, "message too big");
        if (fin) {
          const { opcode: first, parts } = this.fragments;
          this.fragments = null;
          this.onMessage(first, Buffer.concat(parts));
        }
        return;
      }
      case 0x1: // text
      case 0x2: // binary
        if (this.fragments) return this.close(1002, "interleaved message");
        if (fin) this.onMessage(opcode, payload);
        else this.fragments = { opcode, parts: [payload], size: payload.length };
        return;
      case 0x8: // close: answer it, then hang up
        return this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000, "bye");
      case 0x9: // ping
        return this.write(frame(0xa, payload));
      case 0xa: // pong
        return;
      default:
        return this.close(1002, "unknown opcode");
    }
  }

  write(bytes) {
    if (this.closed || this.socket.destroyed) return;
    if (this.socket.writableLength > MAX_BACKLOG) return this.close(1008, "not reading");
    this.socket.write(bytes);
  }

  /** Pass a partner's message on, byte for byte. */
  forward(opcode, payload) { this.write(frame(opcode, payload)); }

  /** A server-side notice (never game traffic): `{"t":"relay",...}`. */
  notice(obj) { this.write(frame(0x1, Buffer.from(JSON.stringify(obj), "utf-8"))); }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    // 1005/1006 are "no code" markers and may not be sent on the wire.
    const sendable = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
    try { this.socket.write(frame(0x8, closePayload(sendable, reason))); } catch { /* gone */ }
    this.socket.end();
    // Do not wait on a phone that never finishes the close handshake.
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}

/** Refuse an upgrade with a plain HTTP answer, which the browser reports as an error. */
function refuse(socket, status, text) {
  try {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* already gone */ }
}

/**
 * The `upgrade` handler: `GET /api/relay/<room>?role=host|guest`.
 *
 * Returns true when the request was for the relay (answered or refused), false
 * when it was somebody else's upgrade, so a dev server's own WebSocket (Vite's
 * hot reload) can share the listener.
 *
 * Who may join a room: the first host and the first guest. The room id travels
 * only in the QR fragment and the mailbox path, never in a page anyone else
 * loads, so knowing it is the ticket, exactly as it is for the mailbox; a
 * second claim on a taken seat is refused rather than allowed to replace it.
 */
export function handleRelayUpgrade(req, socket, head) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/relay/")) return false;

  const room = url.pathname.slice("/api/relay/".length);
  const role = url.searchParams.get("role");
  if (!ROOM_ID.test(room)) { refuse(socket, 400, "Bad Room"); return true; }
  if (role !== "host" && role !== "guest") { refuse(socket, 400, "Bad Role"); return true; }
  const key = req.headers["sec-websocket-key"];
  if (String(req.headers.upgrade || "").toLowerCase() !== "websocket" || typeof key !== "string") {
    refuse(socket, 426, "Upgrade Required");
    return true;
  }

  sweepRelays(Date.now());
  let entry = rooms.get(room);
  if (!entry) {
    if (rooms.size >= MAX_RELAY_ROOMS) { refuse(socket, 503, "Busy"); return true; }
    entry = { at: Date.now() };
    rooms.set(room, entry);
  }
  if (entry[role]) { refuse(socket, 409, "Seat Taken"); return true; }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const other = role === "host" ? "guest" : "host";
  const conn = new Conn(
    socket,
    head,
    (opcode, payload) => entry[other]?.forward(opcode, payload),
    () => {
      // Either phone leaving ends the relay for both: a half-open pair is a
      // session the lockstep would sit and stall on, and the partner's own
      // close handler is what pauses the map and offers the resume.
      if (entry[role] === conn) delete entry[role];
      entry[other]?.close(1000, "partner left");
      if (!entry.host && !entry.guest && rooms.get(room) === entry) rooms.delete(room);
    },
  );
  entry[role] = conn;
  ensureSweeper();
  conn.start();
  if (conn.closed) return true;

  if (entry.host && entry.guest) {
    entry.host.notice({ t: "relay", state: "paired" });
    entry.guest.notice({ t: "relay", state: "paired" });
  } else {
    conn.notice({ t: "relay", state: "waiting" });
  }
  return true;
}

/** How many rooms are open, for /api/health and the tests. */
export function relayRoomCount() { return rooms.size; }

/** For tests: close everything and forget it. */
export function _closeAllRelays() {
  for (const room of rooms.values()) {
    room.host?.close(1001, "shutting down");
    room.guest?.close(1001, "shutting down");
  }
  rooms.clear();
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
}

// @vitest-environment node
/**
 * The relay: two phones that cannot see each other, talking through the server.
 *
 * Public Wi-Fi isolates its clients, so the direct link the pairing was built
 * on never opens there, and Pair Programming simply did not work in a cafe.
 * These run the REAL server module (server/relay.js) on a real port, and the
 * REAL client transport against it through Node's own WebSocket, so the
 * handshake, the framing and the pairing are exercised end to end with no
 * phones and no mocks in the path.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import {
  handleRelayUpgrade, relayRoomCount, sweepRelays, _closeAllRelays,
  RELAY_WAIT_MS, RELAY_IDLE_MS, RELAY_MAX_MESSAGE,
} from "../../server/relay.js";
import { healthReport } from "../../server/health.js";
import { RelayTransport, pickRoute, awaitHostHello } from "@/lib/net/relay";
import { MemoryTransport, type NetMessage } from "@/lib/net/transport";

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  server.on("upgrade", (req, socket, head) => {
    if (!handleRelayUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterEach(() => _closeAllRelays());
afterAll(() => new Promise<void>(r => server.close(() => r())));

const url = (room: string, role: string) => `ws://127.0.0.1:${port}/api/relay/${room}?role=${role}`;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A plain socket that opens and records, for the checks below the transport. */
function rawWs(room: string, role: string): Promise<WebSocket & { got: string[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(room, role)) as WebSocket & { got: string[] };
    ws.got = [];
    ws.onmessage = e => ws.got.push(String(e.data));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`refused: ${role}`));
  });
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition never held");
    await wait(10);
  }
}

describe("the server relay", () => {
  it("passes messages both ways once both seats are taken", async () => {
    const host = await rawWs("room0001", "host");
    const guest = await rawWs("room0001", "guest");
    await until(() => host.got.some(m => m.includes("paired")) && guest.got.some(m => m.includes("paired")));
    host.send('{"t":"tick","tick":1,"cmds":[]}');
    guest.send('{"t":"tick","tick":1,"cmds":[{"k":"x"}]}');
    await until(() => host.got.length >= 3 && guest.got.length >= 2);
    expect(guest.got).toContain('{"t":"tick","tick":1,"cmds":[]}');
    expect(host.got).toContain('{"t":"tick","tick":1,"cmds":[{"k":"x"}]}');
  });

  it("carries a message of every frame-length class byte for byte", async () => {
    // Under 126, 16-bit and 64-bit lengths are three different headers; a
    // resync snapshot is the one that lands in the last.
    const host = await rawWs("room0002", "host");
    const guest = await rawWs("room0002", "guest");
    await until(() => guest.got.some(m => m.includes("paired")));
    // Characters, and "é" is two bytes: the last is 240 KB, just under the cap.
    const sizes = [5, 300, 70_000, 120_000];
    for (const n of sizes) host.send("é".repeat(n));
    await until(() => guest.got.length >= 1 + sizes.length, 5000);
    expect(guest.got.slice(1).map(m => m.length)).toEqual(sizes);
    expect(guest.got[3]).toBe("é".repeat(70_000));
  });

  it("hangs up on a message bigger than the direct link would carry", async () => {
    const host = await rawWs("room0009", "host");
    await rawWs("room0009", "guest");
    const closed = new Promise<number>(r => { host.onclose = e => r(e.code); });
    host.send("x".repeat(RELAY_MAX_MESSAGE + 1));
    expect(await closed).toBe(1009);
  });

  it("refuses a second phone in a taken seat, rather than letting it replace the first", async () => {
    await rawWs("room0003", "host");
    await expect(rawWs("room0003", "host")).rejects.toThrow("refused");
  });

  it("refuses a malformed room or role", async () => {
    await expect(rawWs("NOT_A_ROOM", "host")).rejects.toThrow();
    await expect(rawWs("room0004", "spectator")).rejects.toThrow();
  });

  it("ends the relay for both when either phone leaves", async () => {
    const host = await rawWs("room0005", "host");
    const guest = await rawWs("room0005", "guest");
    await until(() => guest.got.some(m => m.includes("paired")));
    const closed = new Promise<string>(r => { guest.onclose = e => r(e.reason); });
    host.close();
    expect(await closed).toBe("partner left");
    await until(() => relayRoomCount() === 0);
  });

  it("sends away a phone whose partner never came, and one that went silent", async () => {
    const host = await rawWs("room0006", "host");
    const closed = new Promise<number>(r => { host.onclose = e => r(e.code); });
    sweepRelays(Date.now() + RELAY_WAIT_MS + 1);
    expect(await closed).toBe(4408);

    const a = await rawWs("room0007", "host");
    await rawWs("room0007", "guest");
    const idle = new Promise<string>(r => { a.onclose = e => r(e.reason); });
    sweepRelays(Date.now() + RELAY_IDLE_MS + 1);
    expect(["idle", "partner left"]).toContain(await idle);
  });

  it("reassembles a fragmented message and hangs up on an unmasked frame", async () => {
    // Browsers are allowed to fragment, and a relay that forwarded the pieces
    // as separate messages would hand the partner half a JSON document.
    const guest = await rawWs("room0008", "guest");
    const sock = await rawUpgrade("room0008", "host");
    await until(() => guest.got.some(m => m.includes("paired")));
    sock.write(maskedFrame(0x1, "{\"t\":\"ho", false));
    sock.write(maskedFrame(0x0, "st\"}", true));
    await until(() => guest.got.includes('{"t":"host"}'));

    const closed = new Promise<void>(r => sock.on("close", () => r()));
    const unmasked = Buffer.from([0x81, 0x02, 0x68, 0x69]);
    sock.write(unmasked);
    await closed;
  });
});

/** Upgrade by hand, so the test can write frames a browser never would. */
function rawUpgrade(room: string, role: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = tcpConnect(port, "127.0.0.1", () => {
      sock.write(
        `GET /api/relay/${room}?role=${role} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.once("data", d => (String(d).startsWith("HTTP/1.1 101") ? resolve(sock) : reject(new Error(String(d)))));
    sock.on("error", reject);
  });
}

function maskedFrame(opcode: number, text: string, fin: boolean): Buffer {
  const payload = Buffer.from(text, "utf-8");
  const mask = randomBytes(4);
  const head = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length]);
  const body = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([head, mask, body]);
}

describe("the relay transport", () => {
  it("pairs two phones through the real server and measures the round trip", async () => {
    const host = RelayTransport.connect("room0101", "host", url("room0101", "host"))!;
    const guest = RelayTransport.connect("room0101", "guest", url("room0101", "guest"))!;
    await Promise.all([host.waitPaired(3000), guest.waitPaired(3000)]);
    expect(host.isOpen && guest.isOpen).toBe(true);

    const got: NetMessage[] = [];
    guest.onMessage(m => got.push(m));
    host.send({ t: "hash", tick: 7, motion: "a", topology: "b" });
    await until(() => got.length === 1);
    // The heartbeat never reaches the session; the game message does.
    expect(got[0]).toEqual({ t: "hash", tick: 7, motion: "a", topology: "b" });
    await until(() => host.rttMs !== null);

    const dropped = new Promise<string>(r => guest.onClose(r));
    host.close();
    expect(await dropped).toBe("partner left");
    expect(guest.isOpen).toBe(false);
  });

  it("says so when there is no relay to reach", async () => {
    const t = RelayTransport.connect("room0102", "host", "ws://127.0.0.1:1/api/relay/room0102?role=host")!;
    await expect(t.waitPaired(3000)).rejects.toThrow();
  });
});

describe("which link a pair settles on", () => {
  const wait0 = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  const late = (ms: number): Promise<void> => wait0(ms).then(() => { throw new Error("timeout"); });
  const opens = (ms: number) => ({ waitOpen: (limit: number) => ms <= limit ? wait0(ms) : late(limit) });
  const never = { waitOpen: (limit: number) => late(limit) };
  const pairs = (ms: number) => ({ waitPaired: (limit: number) => ms <= limit ? wait0(ms) : Promise.reject(new Error("timeout")) });

  it("takes the direct link where it opens", async () => {
    expect(await pickRoute(opens(5), pairs(1), { graceMs: 50, timeoutMs: 200 })).toBe("direct");
  });

  it("falls back to the relay when the network keeps the phones apart", async () => {
    expect(await pickRoute(never, pairs(1), { graceMs: 20, timeoutMs: 200 })).toBe("relay");
  });

  it("gives the direct link its whole timeout when there is no relay, as before", async () => {
    expect(await pickRoute(opens(80), null, { graceMs: 20, timeoutMs: 200 })).toBe("direct");
    await expect(pickRoute(never, null, { graceMs: 20, timeoutMs: 50 })).rejects.toThrow("timeout");
  });

  it("still waits out the direct link when the relay failed outright", async () => {
    // An older server with no relay refuses the upgrade at once. The direct
    // link must keep the full wait it had before the relay existed.
    const dead = { waitPaired: () => Promise.reject(new Error("relay error")) };
    expect(await pickRoute(opens(80), dead, { graceMs: 20, timeoutMs: 200 })).toBe("direct");
  });

  it("goes straight to the relay when admin forces it", async () => {
    expect(await pickRoute(opens(0), pairs(1), { forceRelay: true, graceMs: 50, timeoutMs: 200 })).toBe("relay");
  });

  it("has the guest answer on whichever link the host said hello on", async () => {
    const [directHost, directGuest] = MemoryTransport.pair();
    const [relayHost, relayGuest] = MemoryTransport.pair();
    const waiting = awaitHostHello([directGuest, relayGuest], 1000);
    relayHost.send({ t: "hello", protocol: 1, deviceId: "h", name: "Host", build: "x" });
    const { transport, hello } = await waiting;
    expect(transport).toBe(relayGuest);
    expect(hello.deviceId).toBe("h");
    directHost.close();
  });
});

describe("the health report", () => {
  it("says how long the process has been up, and nothing private", () => {
    const report = healthReport();
    expect(report.ok).toBe(true);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Object.keys(report).sort()).toEqual(["ok", "relay", "uptimeSeconds"]);
  });
});

/**
 * sdp — squeezing a WebRTC offer into a link a phone camera can read.
 *
 * A browser's SDP offer is about 1.5 KB of boilerplate: codec lists, RTP
 * profiles, extensions, most of it about audio and video this connection will
 * never carry. A QR code holding 1.5 KB is dense enough that scanning it off a
 * phone screen at arm's length is a coin toss, which for a feature whose whole
 * pitch is "point your camera at this" is fatal.
 *
 * So only the parts the other side cannot invent travel: the ICE credentials,
 * the DTLS fingerprint, the setup role and the host candidates. Everything else
 * is rebuilt from a template, because both ends are this same app and agree
 * about what the template says. Around 200 bytes before base64, which is a QR
 * that scans first time.
 *
 * The one rule that keeps this honest: the template below must stay in step
 * with what the browsers actually negotiate for a data channel. It is pinned by
 * a test that builds a real offer, packs it, unpacks it, and requires the
 * result to be something the same browser accepts.
 */

export interface PackedSdp {
  /** "o" for offer, "a" for answer. */
  kind: "o" | "a";
  /** ice-ufrag. */
  u: string;
  /** ice-pwd. */
  p: string;
  /**
   * DTLS fingerprint, sha-256, as base64url.
   *
   * Hex would be the obvious choice and costs 64 characters where this costs
   * 43. On a payload this size that is the difference between a QR that scans
   * off a phone screen at arm's length and one that needs two tries, which is
   * the entire feature.
   */
  f: string;
  /**
   * UDP host candidates, each as "ip:port".
   *
   * Priority and foundation are NOT carried: they order and group candidates,
   * and with a handful of addresses on one LAN any consistent ordering works,
   * so both ends synthesise them the same way instead of spending QR on them.
   * TCP candidates are dropped outright: Chrome only ever offers them in
   * active mode, which needs a passive candidate on the other side to connect
   * to, and neither end of this has one.
   */
  c: string[];
}

/** 32 bytes of sha-256, base64url, unpadded. */
const FP_B64 = /^[A-Za-z0-9\-_]{43}$/;

/** Hex pairs to base64url, and back. */
function hexToB64(hex: string): string {
  const bytes = hex.match(/.{2}/g) ?? [];
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(parseInt(b, 16));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToHex(b64: string): string {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - b64.length % 4) % 4));
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

/** Pull the few lines that matter out of a browser's SDP. */
export function packSdp(sdp: string, kind: "o" | "a"): PackedSdp {
  const line = (re: RegExp): string => {
    const m = sdp.match(re);
    return m ? m[1].trim() : "";
  };
  const fingerprint = line(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/)
    .replace(/:/g, "").toLowerCase();

  const candidates: string[] = [];
  for (const m of sdp.matchAll(/a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\S+)/g)) {
    const [, , , proto, , ip, port, type] = m;
    // Host candidates only. There is no STUN in this design, so a srflx or
    // relay candidate cannot appear; if one ever does it is pointing at a
    // server, and this mode does not use one.
    if (type !== "host") continue;
    // UDP only: see the note on PackedSdp.c.
    if (proto.toLowerCase() !== "udp") continue;
    // Skip IPv6 link-local: it needs a scope id that does not survive the trip.
    if (ip.includes("%")) continue;
    const entry = `${ip}:${port}`;
    if (!candidates.includes(entry)) candidates.push(entry);
  }

  return {
    kind,
    u: line(/a=ice-ufrag:(\S+)/),
    p: line(/a=ice-pwd:(\S+)/),
    f: hexToB64(fingerprint),
    c: candidates,
  };
}

/**
 * Rebuild an SDP the browser will accept from the packed form.
 *
 * Everything the packed form dropped is put back from a template both ends
 * agree on, because both ends are this same app. The media id is always "0"
 * and the setup role follows from which side this is, so neither has to travel.
 */
export function unpackSdp(p: PackedSdp): string {
  const fp = ((b64ToHex(p.f).match(/.{2}/g)) ?? []).join(":").toUpperCase();
  const mid = "0";
  const setup = p.kind === "o" ? "actpass" : "active";
  const lines = [
    "v=0",
    // The session id and version are arbitrary; nothing downstream reads them
    // for a data-channel-only connection.
    "o=- 1 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${mid}`,
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${p.u}`,
    `a=ice-pwd:${p.p}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    `a=mid:${mid}`,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  // Priority and foundation are synthesised, identically on both ends: with a
  // handful of addresses on one LAN the ordering only has to be consistent,
  // and 2113937151 is what Chrome itself gives a first UDP host candidate.
  p.c.forEach((c, i) => {
    const sep = c.lastIndexOf(":");
    const ip = c.slice(0, sep);
    const port = c.slice(sep + 1);
    lines.push(
      `a=candidate:${1000000 + i} 1 udp ${2113937151 - i} ${ip} ${port} typ host`,
    );
  });
  lines.push("a=end-of-candidates");
  return lines.join("\r\n") + "\r\n";
}

// ── The link a QR carries ───────────────────────────────────────────────────

/** Bumped when the packed shape changes, so an old app says so instead of
 *  failing to connect for no stated reason. */
export const PAIR_LINK_VERSION = 1;

/** base64url, so the payload survives a URL fragment untouched. */
function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface PairLink {
  version: number;
  room: string;
  offer: PackedSdp;
}

/**
 * The whole invitation, as a URL.
 *
 * The payload sits in the FRAGMENT, which browsers do not send to servers. The
 * host's connection details therefore reach the other phone without passing
 * through anything, even though the link points at a web address.
 */
export function buildPairUrl(origin: string, room: string, offer: PackedSdp): string {
  const payload = toB64Url(JSON.stringify({ v: PAIR_LINK_VERSION, r: room, o: offer }));
  return `${origin.replace(/\/+$/, "")}/#pair=${payload}`;
}

/** Read an invitation out of a URL (or out of location.hash). Null if absent. */
export function parsePairUrl(href: string): PairLink | null {
  const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : href;
  const m = hash.match(/(?:^|&)pair=([A-Za-z0-9\-_]+)/);
  if (!m) return null;
  try {
    const data = JSON.parse(fromB64Url(m[1])) as { v: number; r: string; o: PackedSdp };
    if (!data || typeof data.r !== "string" || !data.o) return null;
    if (!FP_B64.test(data.o.f ?? "")) return null;
    return { version: data.v, room: data.r, offer: data.o };
  } catch {
    return null;
  }
}

/** A room id: short enough for a small QR, long enough that two pairs in one
 *  room cannot collide by accident. */
export function newRoomId(rand: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

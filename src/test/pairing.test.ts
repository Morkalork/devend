/**
 * Pairing: the link, the mailbox, and the pair save (TWO_PLAYER_PLAN.md steps
 * 5 and 6b).
 *
 * The one thing none of this can test here is two real phones finding each
 * other over ICE, which is what the step-5 spike is for. Everything either
 * side of that is ordinary code with ordinary failure modes, and those are
 * pinned: a QR payload that survives the round trip and stays small enough to
 * scan, a mailbox that hands an answer over exactly once, and a save that two
 * phones resolve the same way without asking each other.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  packSdp, unpackSdp, buildPairUrl, parsePairUrl, newRoomId, PAIR_LINK_VERSION,
} from "@/lib/net/sdp";
import { chooseSave, type PairSaveOffer } from "@/hooks/usePairRunSave";
import { pairIdFor } from "@/lib/net/deviceId";
import { putAnswer, takeAnswer, dropRoom, _clearRooms, _roomCount, ROOM_TTL_MS } from "../../server/pairRooms.js";

/** A realistic Chrome data-channel offer, boilerplate and all. */
const REAL_OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1234567890 1 udp 2113937151 192.168.1.42 54321 typ host generation 0",
  "a=candidate:1987654321 1 tcp 1518214911 192.168.1.42 9 typ host tcptype active",
  "a=candidate:9999999999 1 udp 1677729535 203.0.113.9 41234 typ srflx raddr 192.168.1.42 rport 54321",
  "a=ice-ufrag:2Hhd",
  "a=ice-pwd:C0SQJm1lMEDvfHtnfWlS8lF7",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
].join("\r\n") + "\r\n";

describe("the offer that rides in the QR", () => {
  it("keeps everything the other side cannot invent", () => {
    const packed = packSdp(REAL_OFFER, "o");
    expect(packed.u).toBe("2Hhd");
    expect(packed.p).toBe("C0SQJm1lMEDvfHtnfWlS8lF7");
    // The fingerprint travels as base64url, which is 43 characters where the
    // hex is 64, and the QR is the reason.
    expect(packed.f).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(unpackSdp(packed)).toContain("AB:CD:EF:01:23:45:67:89");
  });

  it("carries the host candidates and drops the one that points at a server", () => {
    const packed = packSdp(REAL_OFFER, "o");
    // One entry, not two: the TCP candidate is active-mode on port 9, which
    // needs a passive candidate on the other side to connect to, and neither
    // end of this has one.
    expect(packed.c).toEqual(["192.168.1.42:54321"]);
    // 203.0.113.9 is the srflx candidate, which can only exist if a STUN
    // server was involved. This design has none, and carrying one would be
    // carrying the thing the design says it does not use.
    expect(packed.c.join("|")).not.toContain("203.0.113.9");
  });

  it("rebuilds an SDP with the same credentials and candidates", () => {
    const rebuilt = unpackSdp(packSdp(REAL_OFFER, "o"));
    expect(rebuilt).toContain("a=ice-ufrag:2Hhd");
    expect(rebuilt).toContain("a=ice-pwd:C0SQJm1lMEDvfHtnfWlS8lF7");
    expect(rebuilt).toContain("a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89");
    expect(rebuilt).toContain("192.168.1.42 54321 typ host");
    expect(rebuilt).toContain("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(rebuilt).toContain("a=sctp-port:5000");
  });

  it("is small enough that the code scans first time", () => {
    const url = buildPairUrl("https://dev-end-staging.example.com", newRoomId(), packSdp(REAL_OFFER, "o"));
    // A QR past roughly 400 characters needs so many modules that scanning it
    // off a phone screen at arm's length stops being reliable, which for a
    // feature whose whole pitch is "point your camera at this" is fatal.
    expect(url.length, `the pairing link grew to ${url.length} characters`).toBeLessThan(400);
    expect(REAL_OFFER.length, "the raw offer is the thing being avoided").toBeGreaterThan(700);
  });

  it("puts the payload in the fragment, so no server ever sees it", () => {
    const url = buildPairUrl("https://example.com", "abcdefgh", packSdp(REAL_OFFER, "o"));
    const [beforeHash] = url.split("#");
    expect(beforeHash).toBe("https://example.com/");
    expect(url).toContain("#pair=");
  });

  it("reads its own link back", () => {
    const offer = packSdp(REAL_OFFER, "o");
    const url = buildPairUrl("https://example.com", "abcdefgh", offer);
    const parsed = parsePairUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(PAIR_LINK_VERSION);
    expect(parsed!.room).toBe("abcdefgh");
    expect(parsed!.offer).toEqual(offer);
  });

  it("refuses a link that is not one", () => {
    expect(parsePairUrl("https://example.com/")).toBeNull();
    expect(parsePairUrl("#pair=not-base64-json")).toBeNull();
    // A well-formed payload whose fingerprint is junk: the connection would
    // fail later and confusingly, so it fails here instead.
    const bad = btoa(JSON.stringify({ v: 1, r: "abcdefgh", o: { f: "nope" } }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parsePairUrl(`#pair=${bad}`)).toBeNull();
  });

  it("deals room ids without the characters people misread", () => {
    const ids = Array.from({ length: 200 }, () => newRoomId());
    expect(ids.every(id => /^[a-z0-9]{8}$/.test(id))).toBe(true);
    expect(ids.join("")).not.toMatch(/[lo01]/);
    expect(new Set(ids).size, "the ids barely vary").toBeGreaterThan(190);
  });
});

describe("the mailbox", () => {
  beforeEach(() => _clearRooms());

  it("hands the answer over exactly once", () => {
    expect(putAnswer("abcdefgh", "the-answer").status).toBe(204);
    const first = takeAnswer("abcdefgh");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ answer: "the-answer" });
    expect(takeAnswer("abcdefgh").status, "the room outlived its one message").toBe(404);
  });

  it("says it is waiting rather than failing, when nobody has answered", () => {
    const out = takeAnswer("abcdefgh");
    expect(out.status).toBe(404);
    expect(out.body).toEqual({ waiting: true });
  });

  it("refuses a second answer, so a stranger cannot replace the guest's", () => {
    putAnswer("abcdefgh", "first");
    expect(putAnswer("abcdefgh", "second").status).toBe(409);
    expect(takeAnswer("abcdefgh").body).toEqual({ answer: "first" });
  });

  it("refuses a room id that is not one, and an answer that is too big", () => {
    expect(putAnswer("../etc/passwd", "x").status).toBe(400);
    expect(putAnswer("ab", "x").status).toBe(400);
    expect(putAnswer("abcdefgh", "x".repeat(8192)).status).toBe(413);
  });

  it("forgets a room nobody collected", () => {
    const t0 = 1_000_000;
    putAnswer("abcdefgh", "stale", t0);
    expect(_roomCount()).toBe(1);
    expect(takeAnswer("abcdefgh", t0 + ROOM_TTL_MS + 1).status).toBe(404);
    expect(_roomCount(), "the sweeper left it behind").toBe(0);
  });

  it("lets the host cancel", () => {
    putAnswer("abcdefgh", "x");
    dropRoom("abcdefgh");
    expect(takeAnswer("abcdefgh").status).toBe(404);
  });
});

describe("the pair identity", () => {
  it("is the same from either phone", () => {
    expect(pairIdFor("alice", "bob")).toBe(pairIdFor("bob", "alice"));
  });

  it("tells different pairs apart", () => {
    expect(pairIdFor("alice", "bob")).not.toBe(pairIdFor("alice", "carol"));
  });
});

describe("which save a returning pair continues from", () => {
  const offer = (runId: string, levelIndex: number, savedAt: number): PairSaveOffer =>
    ({ runId, levelIndex, savedAt });

  it("takes the further-along copy of the same run", () => {
    // The ordinary way the two differ: one phone was closed before its write
    // landed.
    expect(chooseSave(offer("r", 6, 100), offer("r", 7, 90))).toBe("theirs");
    expect(chooseSave(offer("r", 7, 90), offer("r", 6, 100))).toBe("mine");
  });

  it("takes the only copy there is", () => {
    expect(chooseSave(offer("r", 3, 1), null)).toBe("mine");
    expect(chooseSave(null, offer("r", 3, 1))).toBe("theirs");
    expect(chooseSave(null, null)).toBe("none");
  });

  it("takes the more recent one when the two are different runs", () => {
    expect(chooseSave(offer("old", 9, 100), offer("new", 1, 200))).toBe("theirs");
  });

  it("reaches the same answer from both sides, which is the whole point", () => {
    const a = offer("r", 6, 100);
    const b = offer("r", 7, 90);
    // Device A asks with (mine=a, theirs=b); device B asks with (mine=b,
    // theirs=a). They must land on the same physical save without conferring.
    const fromA = chooseSave(a, b);
    const fromB = chooseSave(b, a);
    expect(fromA).toBe("theirs");
    expect(fromB).toBe("mine");
  });
});

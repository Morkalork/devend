/**
 * The guest's QR link has to survive startup.
 *
 * Reported from two real phones: the host's QR opened the game on the second
 * phone, and nothing else happened. The link carried the whole invitation in
 * its fragment, and the app opened on the welcome screen, which does not read
 * the fragment, so the host waited on its QR for an answer that was never
 * going to come. The back guard also rewrites the URL on mount, so the
 * invitation is captured before it can.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { buildPairUrl, packSdp } from "@/lib/net/sdp";
import { capturePairInvite, hasPairInvite, takePairInvite } from "@/lib/net/pairInvite";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";

const OFFER = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2113937151 192.168.1.42 54321 typ host generation 0",
  "a=ice-ufrag:2Hhd",
  "a=ice-pwd:C0SQJm1lMEDvfHtnfWlS8lF7",
  "a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
].join("\r\n") + "\r\n";

function openOnPairLink(): void {
  const url = buildPairUrl(window.location.origin, "abcdefgh", packSdp(OFFER, "o"));
  window.history.replaceState(null, "", url.slice(window.location.origin.length));
}

beforeEach(() => {
  takePairInvite();
  window.history.replaceState(null, "", "/");
});

describe("a guest arriving on the host's QR link", () => {
  it("is captured before anything can rewrite the URL, and cleared from it", () => {
    openOnPairLink();
    const link = capturePairInvite();
    expect(link?.room).toBe("abcdefgh");
    expect(window.location.hash, "a refresh would answer a spent offer").toBe("");
    // The back guard can now do what it likes to the URL.
    window.history.pushState({ devendBackGuard: true }, "");
    expect(hasPairInvite()).toBe(true);
  });

  it("opens the game on the 2-Player screen, not the menu", () => {
    openOnPairLink();
    capturePairInvite();
    const { result } = renderHook(() => useScreenNavigation());
    expect(result.current.currentScreen).toBe("pairLobby");
  });

  it("is handed to the lobby exactly once", () => {
    openOnPairLink();
    capturePairInvite();
    expect(takePairInvite()?.room).toBe("abcdefgh");
    expect(takePairInvite(), "a second mount would answer the same offer twice").toBeNull();
    expect(hasPairInvite()).toBe(false);
  });

  it("leaves an ordinary launch on the menu", () => {
    expect(capturePairInvite()).toBeNull();
    const { result } = renderHook(() => useScreenNavigation());
    expect(result.current.currentScreen).toBe("welcome");
  });
});

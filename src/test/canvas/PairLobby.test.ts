/**
 * The 2-Player screen (canvas port of components/game/PairLobby): what
 * src/test/pairLobbyNap.test.tsx, pairInviteLink.test.tsx and the PairLobby
 * parts of pairHardening.test.ts pinned, against the port's model and source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import {
  NAP_ICON, QR_MARGIN, SIMULATED, copyOutcome, napTextKey, napTipKey, napWorthShowing, permissionKey,
  qrGeometry, qrMatrix, qrRuns, routeKey,
} from "@/ui/screens/pairLobbyModel";
import { buildPairUrl } from "@/lib/net/sdp";

const OFFER = { kind: "o" as const, u: "ufrg", p: "pwdpwdpwdpwdpwdpwdpwdpwd", f: "A".repeat(43), c: ["192.168.1.5:5000"] };

describe("the server nap readout", () => {
  it("a simulated nap shows as waking, and says the server is napping", () => {
    expect(SIMULATED.asleep).toBe("waking");
    expect(i18n.t(napTextKey(SIMULATED.asleep))).toMatch(/napping/i);
    // The hold's explainer.
    expect(i18n.t("pair.nap.whyTitle")).toMatch(/Why would a server sleep/);
    expect(i18n.t(napTipKey("waking"))).toBeTruthy();
    expect(i18n.t("pair.nap.whyNap")).toMatch(/find its slippers/);
  });

  it("says plainly when the server cannot be reached", () => {
    expect(SIMULATED.unreachable).toBe("unreachable");
    expect(NAP_ICON.unreachable).toBeTruthy();
  });

  it("speaks up while a code is up only when it has news", () => {
    expect(napWorthShowing(null)).toBe(false);
    expect(napWorthShowing("awake")).toBe(false);
    expect(napWorthShowing("checking")).toBe(false);
    expect(napWorthShowing("waking")).toBe(true);
    expect(napWorthShowing("unreachable")).toBe(true);
  });

  it("picks the route and permission lines", () => {
    expect(routeKey("relay")).toBe("pair.viaRelay");
    expect(routeKey("direct")).toBe("pair.viaDirect");
    expect(permissionKey("location")).toBe("pair.needLocation");
    expect(permissionKey("nearby")).toBe("pair.needPermission");
  });
});

describe("the QR on the canvas", () => {
  const url = buildPairUrl("https://example.test", "abcd1234", OFFER);
  const m = qrMatrix(url);

  it("is a square code of a valid version with its finder patterns", () => {
    const n = m.length;
    expect(m.every(row => row.length === n)).toBe(true);
    expect((n - 17) % 4).toBe(0);
    // Top-left finder: dark ring, light gap, dark core.
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[1][1]).toBe(false);
    expect(m[3][3]).toBe(true);
    expect(m[0][n - 1]).toBe(true);
    expect(m[n - 1][0]).toBe(true);
  });

  it("draws each row as runs covering exactly its dark modules", () => {
    for (const row of m) {
      const covered = new Array(row.length).fill(false);
      for (const [s, len] of qrRuns(row)) for (let c = s; c < s + len; c++) covered[c] = true;
      expect(covered).toEqual(row);
    }
  });

  it("uses whole-pixel modules inside the quiet zone", () => {
    const { cell, offset } = qrGeometry(m.length, 288);
    expect(Number.isInteger(cell)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(QR_MARGIN * cell);
    expect(offset * 2 + (m.length) * cell).toBeLessThanOrEqual(288 + 1);
  });
});

describe("the invitation as a link", () => {
  it("copied fades back; a failed copy stays to show the link", () => {
    expect(copyOutcome(true)).toEqual({ state: "copied", resets: true });
    expect(copyOutcome(false)).toEqual({ state: "failed", resets: false });
    // ...and the failed state prints the link in full, to copy by hand.
    const src = readFileSync("src/ui/screens/PairLobby.tsx", "utf8");
    const failed = src.slice(src.indexOf('{copied === "failed" && ('));
    expect(failed.slice(0, 600)).toContain("<Label text={url}");
  });

  it("the QR, the copy and the share all carry the one pair URL", () => {
    const src = readFileSync("src/ui/screens/PairLobby.tsx", "utf8");
    expect(src).toMatch(/<PairQr text=\{pairUrl\}/);
    expect(src).toMatch(/<InviteLinkActions url=\{pairUrl\}/);
    expect(src).toMatch(/copyText\(url\)/);
    expect(src).toMatch(/shareLink\(\{ url,/);
    // Share only where the phone has a share sheet.
    expect(src).toMatch(/\{canShare\(\) && \(/);
  });
});

describe("pair hardening, carried to the port", () => {
  const src = readFileSync("src/ui/screens/PairLobby.tsx", "utf8");

  it("decides the host after the hello, not before it", () => {
    const handshake = src.slice(src.indexOf("const completeHandshake"), src.indexOf("const startNearby"));
    const helloArrives = handshake.search(/const theirs = (received \?\? )?await/);
    const elect = handshake.indexOf("electPlayer(");
    expect(helloArrives, "the handshake never waits for the partner's hello").toBeGreaterThan(-1);
    expect(elect, "the election is not in the handshake").toBeGreaterThan(-1);
    expect(elect, "the election runs before the id it needs has arrived").toBeGreaterThan(helloArrives);
  });

  it("keeps the first Nearby offer and guards the accept", () => {
    expect(src, "a second offer replaces the first").toMatch(/setToken\(prev => prev \?\? e\)/);
    expect(src, "the accept can be tapped twice").toMatch(/disabled=\{accepting\}/);
  });
});

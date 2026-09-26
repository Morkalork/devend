/**
 * The 2-Player invitation as a link, beside the QR.
 *
 * A QR needs the two phones side by side and a camera that reads it. The same
 * invitation is a plain link, so it can go through a message instead: Copy
 * puts it on the clipboard, Share opens the phone's share sheet. These drive
 * the real lobby up to the code, with the peer connection faked (jsdom has no
 * WebRTC) and nobody ever answering.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@/i18n";
import { parsePairUrl } from "@/lib/net/sdp";
import { copyText, shareLink } from "@/lib/shareLink";

const OFFER = { kind: "o" as const, u: "ufrg", p: "pwdpwdpwdpwdpwdpwdpwdpwd", f: "A".repeat(43), c: ["192.168.1.5:5000"] };

vi.mock("@/lib/net/webrtc", async (orig) => {
  const real = await orig<typeof import("@/lib/net/webrtc")>();
  return {
    ...real,
    WebRtcTransport: {
      host: async () => ({ transport: { close() {}, acceptAnswer: async () => {}, waitOpen: async () => {} }, offer: OFFER }),
    },
    // Nobody scans: the host sits on its code, which is the state under test.
    awaitAnswer: () => new Promise(() => {}),
    cancelRoom: () => {},
  };
});
vi.mock("@/lib/net/relay", async (orig) => {
  const real = await orig<typeof import("@/lib/net/relay")>();
  return { ...real, RelayTransport: { ...real.RelayTransport, connect: () => null } };
});

const { PairLobby } = await import("@/components/game/PairLobby");

let clipboard: string | null = null;

beforeEach(() => {
  clipboard = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (s: string) => { clipboard = s; } },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
});

async function showCode() {
  render(<PairLobby onBack={() => {}} onPaired={() => {}} />);
  fireEvent.click(screen.getByText("Show the code"));
  return await screen.findByTestId("copy-invite");
}

describe("the invitation as a link", () => {
  it("copies the very link the QR carries", async () => {
    const button = await showCode();
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toMatch(/Link copied/));
    // Parse it back: the partner's phone reads this link exactly as it reads
    // the QR, so it must carry the same offer and a room.
    const link = parsePairUrl(clipboard ?? "");
    expect(link?.offer).toEqual(OFFER);
    expect(link?.room).toMatch(/^[a-z0-9]{8}$/);
  });

  it("shows the link to copy by hand when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    // jsdom has no execCommand copy either, so both ways fail.
    const button = await showCode();
    fireEvent.click(button);
    const field = await screen.findByLabelText("Copy link") as HTMLInputElement;
    expect(parsePairUrl(field.value)?.offer).toEqual(OFFER);
  });

  it("offers Share only where the phone has a share sheet", async () => {
    await showCode();
    expect(screen.queryByTestId("share-invite")).toBeNull();
    cleanup();

    const shared: ShareData[] = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: ShareData) => { shared.push(d); } });
    await showCode();
    fireEvent.click(screen.getByTestId("share-invite"));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(parsePairUrl(shared[0].url ?? "")?.offer).toEqual(OFFER);
  });
});

describe("the helpers", () => {
  it("falls back to select-and-copy where there is no Clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    Object.defineProperty(document, "execCommand", { configurable: true, value: undefined });
  });

  it("reads a closed share sheet as cancelled, not as a failure", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { throw Object.assign(new Error("closed"), { name: "AbortError" }); },
    });
    expect(await shareLink({ url: "https://x/#pair=y" })).toBe("cancelled");
  });
});

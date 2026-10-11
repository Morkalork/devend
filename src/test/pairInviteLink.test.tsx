/**
 * The 2-Player invitation as a link, beside the QR.
 *
 * A QR needs the two phones side by side and a camera that reads it. The same
 * invitation is a plain link, so it can go through a message instead: Copy
 * puts it on the clipboard, Share opens the phone's share sheet.
 *
 * The lobby's side (one URL behind the QR, Copy and Share; Share only where
 * there is a share sheet; a failed copy shows the link) is checked against the
 * canvas screen in canvas/PairLobby.test.ts. These are the shared helpers it
 * calls.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { copyText, shareLink } from "@/lib/shareLink";

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
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

/**
 * Handing a link to somebody else: copy it, or pass it to the phone's own
 * share sheet.
 *
 * The 2-Player invitation is a link (sdp.ts), and a QR is only one way to get
 * it onto the other phone. Holding a screen up to a camera needs the two
 * phones side by side; a copied link goes through whatever the players already
 * talk on.
 */

/**
 * Put text on the clipboard. True when it got there.
 *
 * The Clipboard API needs a secure context, and the desk rig serves the game
 * over plain http on a LAN address, where it does not exist. There the old
 * select-and-copy trick still works, so it is the fallback rather than a
 * failure.
 */
export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused or not focused: try the old way below.
  }
  try {
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off screen, and not display:none, which some browsers refuse to select.
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.left = "-9999px";
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand?.("copy") ?? false;
    doc.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Whether this browser has a native share sheet (phones, mostly). */
export function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export type ShareOutcome = "shared" | "cancelled" | "failed";

/**
 * Open the share sheet. "cancelled" is the player closing it, which is not an
 * error and must not read as one.
 */
export async function shareLink(data: { url: string; title?: string; text?: string }): Promise<ShareOutcome> {
  if (!canShare()) return "failed";
  try {
    await navigator.share(data);
    return "shared";
  } catch (err) {
    return err instanceof Error && err.name === "AbortError" ? "cancelled" : "failed";
  }
}

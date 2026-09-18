/**
 * deviceId — a stable name for this phone, so a pair can recognise each other
 * next time (TWO_PLAYER_PLAN.md step 6b).
 *
 * "Bound to the hardware" is what the feature wants and not quite what any of
 * this can give. A web page cannot see an IMEI, a MAC address or a serial
 * number; nothing it can reach survives a data clear. So the binding is an id
 * the app mints once and then keeps, which is enough for what it is for:
 * recognising the phone across the table, not proving anything about it.
 *
 * Two sources, best first:
 *
 *   - In the Android app, Capacitor's Device.getId(), which is Android's own
 *     per-app identifier. It survives a reinstall of the same signed app,
 *     which is exactly the case where losing a run would annoy someone.
 *   - On the web, a random UUID in localStorage, with persistent storage
 *     requested so the browser is less inclined to evict it.
 *
 * This is IDENTITY, not security. A forged device id lets someone claim to be
 * the other half of a couch co-op pair, which is not a thing worth defending
 * against and not a thing the design would notice if it happened.
 */
import { Capacitor } from "@capacitor/core";

const STORAGE_KEY = "jezzball_device_id_v1";

let cached: string | null = null;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // A browser old enough to lack randomUUID still needs an id; this one is
  // only ever compared for equality.
  return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function fromStorage(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const minted = randomId();
    localStorage.setItem(STORAGE_KEY, minted);
    // Best effort, and deliberately not awaited: whether the browser grants
    // persistence changes how long the id lasts, never whether there is one.
    void navigator.storage?.persist?.().catch(() => {});
    return minted;
  } catch {
    // Private mode with storage blocked. The id lasts as long as the tab,
    // which means this device will not be recognised next time; the pair save
    // on the OTHER phone covers that (step 6b keeps a copy on both).
    return randomId();
  }
}

/** This device's id. Cached: it is asked for on every hello. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import("@capacitor/device");
      const { identifier } = await Device.getId();
      if (identifier) { cached = identifier; return cached; }
    } catch {
      // The plugin is missing or refused; fall through to storage.
    }
  }
  cached = fromStorage();
  return cached;
}

/**
 * The name for a PAIR of devices, the same from either side.
 *
 * Sorted before hashing, so whichever phone hosts next time computes the same
 * name and finds the same saved run.
 */
export function pairIdFor(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  let h = 0x811c9dc5;
  for (const ch of `${x}::${y}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** For tests. */
export function _resetDeviceIdCache(): void { cached = null; }

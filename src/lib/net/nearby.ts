/**
 * nearby — the two-player link on Android, with nothing in the middle at all
 * (TWO_PLAYER_PLAN.md step 9).
 *
 * The end state the author chose. Both players open 2-Player; the phones find
 * each other over Bluetooth, show the same four digits for a moment so each
 * player can see it is the phone across the table, and the link upgrades itself
 * to Wi-Fi Direct for bandwidth. No QR, no camera, no Wi-Fi network, no server.
 *
 * Everything above this file is unchanged: NearbyTransport is the third
 * implementation of the same Transport interface the in-memory pipe and the
 * WebRTC channel implement, and the lockstep cannot tell which it is on. That
 * was the point of writing the interface first.
 *
 * On the web this reports unavailable, which is how the web build and the desk
 * rig keep the WebRTC path.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { NetMessage, Transport } from "./transport";

export interface NearbyEndpoint {
  endpointId: string;
  name: string;
}

export interface NearbyPermissions {
  bluetooth: string;
  wifi: string;
  location: string;
}

interface NearbyPluginApi {
  permissionState(): Promise<NearbyPermissions>;
  requestNearbyPermissions(): Promise<NearbyPermissions>;
  startAdvertising(opts: { name: string }): Promise<void>;
  startDiscovery(): Promise<void>;
  stop(): Promise<void>;
  connect(opts: { endpointId: string }): Promise<void>;
  accept(opts: { endpointId: string }): Promise<void>;
  reject(opts: { endpointId: string }): Promise<void>;
  disconnect(): Promise<void>;
  send(opts: { data: string }): Promise<void>;
  addListener(event: "endpointFound", cb: (e: NearbyEndpoint) => void): Promise<PluginListenerHandle>;
  addListener(event: "endpointLost", cb: (e: { endpointId: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "connectionInitiated", cb: (e: NearbyEndpoint & { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "connected", cb: (e: { endpointId: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "disconnected", cb: (e: { endpointId: string; reason?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "payload", cb: (e: { data: string }) => void): Promise<PluginListenerHandle>;
}

export const NearbyPlugin = registerPlugin<NearbyPluginApi>("Nearby");

/** True only where the native plugin exists. Everywhere else, use WebRTC. */
export function isNearbyAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Nearby");
}

/** Whichever permission is still missing, or null when none is. */
export async function missingNearbyPermission(): Promise<keyof NearbyPermissions | null> {
  if (!isNearbyAvailable()) return null;
  const state = await NearbyPlugin.permissionState();
  for (const key of ["bluetooth", "wifi", "location"] as const) {
    if (state[key] !== "granted") return key;
  }
  return null;
}

const PING_EVERY_MS = 2000;

/**
 * A Transport over the native link.
 *
 * Payloads are reliable byte messages, up to 32 KB, which is far above
 * anything the lockstep sends; a tick message is a hundred bytes and the
 * largest thing that ever crosses is a resync snapshot at a few kilobytes.
 * Delivery order is not promised and does not need to be: every lockstep
 * message carries the tick it belongs to.
 */
export class NearbyTransport implements Transport {
  private handler: ((msg: NetMessage) => void) | null = null;
  private closeHandler: ((reason: string) => void) | null = null;
  private listeners: PluginListenerHandle[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private rtt: number | null = null;
  private open = true;

  private constructor() { /* built through connectNearby */ }

  get isOpen(): boolean { return this.open; }
  get rttMs(): number | null { return this.rtt; }

  /**
   * Attach to a connection the caller has already accepted.
   *
   * Pairing itself (advertise, discover, compare the digits, accept) is the
   * lobby's job, because it is a conversation with two people and this class
   * is a pipe.
   */
  static async attach(): Promise<NearbyTransport> {
    const transport = new NearbyTransport();
    transport.listeners.push(
      await NearbyPlugin.addListener("payload", (e) => transport.receive(e.data)),
      await NearbyPlugin.addListener("disconnected", (e) =>
        transport.fail(e.reason ?? "peer disconnected")),
    );
    transport.startPing();
    return transport;
  }

  private receive(raw: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const msg = parsed as NetMessage;
    // The heartbeat never reaches the session: it measures the link, and the
    // Bluetooth phase before the Wi-Fi upgrade is exactly when that matters.
    if (msg.t === "ping") { this.send({ t: "pong", at: msg.at }); return; }
    if (msg.t === "pong") { this.rtt = Math.max(0, Date.now() - msg.at); return; }
    this.handler?.(msg);
  }

  private startPing(): void {
    const beat = () => { void NearbyPlugin.send({ data: JSON.stringify({ t: "ping", at: Date.now() }) }); };
    beat();
    this.pingTimer = setInterval(beat, PING_EVERY_MS);
  }

  send(msg: NetMessage): void {
    if (!this.open) return;
    void NearbyPlugin.send({ data: JSON.stringify(msg) }).catch(() => {
      // A send that fails on a link the OS has already torn down; the
      // disconnected event is what actually ends the session.
    });
  }

  onMessage(handler: (msg: NetMessage) => void): void { this.handler = handler; }
  onClose(handler: (reason: string) => void): void { this.closeHandler = handler; }

  private fail(reason: string): void {
    if (!this.open) return;
    this.open = false;
    this.stopPing();
    this.closeHandler?.(reason);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  close(): void {
    this.open = false;
    this.stopPing();
    for (const l of this.listeners) void l.remove();
    this.listeners = [];
    void NearbyPlugin.disconnect().catch(() => {});
  }
}

// ── Pairing, as a small state machine the lobby drives ──────────────────────

export interface NearbyPairingCallbacks {
  /** Someone appeared. The lobby lists them. */
  onFound: (endpoint: NearbyEndpoint) => void;
  onLost: (endpointId: string) => void;
  /** Both phones now show these digits. Accept when the players agree. */
  onToken: (endpoint: NearbyEndpoint & { token: string }) => void;
  onConnected: () => void;
  onFailed: (reason: string) => void;
}

/**
 * Advertise AND discover at once, under one service id.
 *
 * Both at once so there is no host/guest question to put in front of the
 * players: they both press the same button and the phones sort it out. Who
 * ends up player 0 is decided above this, by whose device id sorts lower, so
 * it is the same answer on both phones without either asking.
 */
export async function startNearbyPairing(
  name: string, cb: NearbyPairingCallbacks,
): Promise<() => void> {
  const handles: PluginListenerHandle[] = [
    await NearbyPlugin.addListener("endpointFound", cb.onFound),
    await NearbyPlugin.addListener("endpointLost", (e) => cb.onLost(e.endpointId)),
    await NearbyPlugin.addListener("connectionInitiated", cb.onToken),
    await NearbyPlugin.addListener("connected", () => cb.onConnected()),
    await NearbyPlugin.addListener("disconnected", (e) => cb.onFailed(e.reason ?? "disconnected")),
  ];
  await NearbyPlugin.startAdvertising({ name });
  await NearbyPlugin.startDiscovery();
  return () => {
    for (const h of handles) void h.remove();
    void NearbyPlugin.stop().catch(() => {});
  };
}

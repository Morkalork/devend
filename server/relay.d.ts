/**
 * Types for the relay, so the tests and vite.config.ts can import the same
 * module the production server runs.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export declare const RELAY_WAIT_MS: number;
export declare const RELAY_IDLE_MS: number;
export declare const RELAY_MAX_MESSAGE: number;
export declare const MAX_RELAY_ROOMS: number;

export declare function handleRelayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
export declare function sweepRelays(now: number): void;
export declare function relayRoomCount(): number;
export declare function _closeAllRelays(): void;

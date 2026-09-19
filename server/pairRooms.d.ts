/**
 * Types for the pairing mailbox, so vite.config.ts can import the same module
 * the production server runs rather than keeping a second copy of the rules.
 */
export declare const ROOM_TTL_MS: number;
export declare const MAX_ANSWER_BYTES: number;

export interface RoomResult {
  status: number;
  body: { error?: string; waiting?: boolean; answer?: string } | null;
}

export declare function putAnswer(roomId: string, answer: unknown, now?: number): RoomResult;
export declare function takeAnswer(roomId: string, now?: number): RoomResult;
export declare function dropRoom(roomId: string): RoomResult;
export declare function _roomCount(): number;
export declare function _clearRooms(): void;

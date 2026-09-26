/**
 * The answer to "were you asleep?", for the 2-Player screen.
 *
 * An eco dyno goes to sleep after half an hour with no web traffic, and the
 * first request after that waits for a fresh process to boot: several seconds
 * in which the QR is not showing and nothing says why. The client cannot see
 * the dyno, but it can see two things that give the nap away: the answer took
 * a long time, or the process answering it is only a few seconds old. So this
 * reports how long the process has been up, and the client does the guessing
 * (src/lib/net/serverNap.ts).
 *
 * Nothing else. No room counts, no versions: it is a public URL.
 */
import { relayRoomCount, MAX_RELAY_ROOMS } from "./relay.js";

const STARTED_AT = Date.now();

export function healthReport(now = Date.now()) {
  return {
    ok: true,
    uptimeSeconds: Math.round((now - STARTED_AT) / 1000),
    // Whether the relay is taking guests. It always is today; the field is
    // here so a full dyno can say so before a pair tries to join it.
    relay: relayRoomCount() < MAX_RELAY_ROOMS,
  };
}

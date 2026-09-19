/**
 * The pairing mailbox: one message, one way, and then nothing.
 *
 * Two phones on the same Wi-Fi can talk to each other directly, but they
 * cannot MEET without swapping one offer and one answer first. The offer
 * travels in the QR code the host puts on screen, so the guest is about to
 * read it. The answer has to get back to the host, and the host is not going
 * to read anything unless it points a camera at the guest's screen, which is
 * the second scan this design exists to avoid.
 *
 * So the answer is left here. The host polls for it, takes it, and the room is
 * gone. What passes through this file is one short blob of ICE credentials and
 * a DTLS fingerprint, useless to anyone who is not already holding the
 * matching offer, and nothing about the game ever does: once the two phones are
 * connected, every fence, every ball and every tick goes phone to phone and
 * never touches this process again. (TWO_PLAYER_PLAN.md step 5.)
 *
 * In memory on purpose. A room that outlives a restart is a room nobody is
 * waiting on, and a pairing that takes longer than the TTL below has already
 * failed for the two people at the table.
 */

/** How long an unclaimed answer is worth keeping. */
export const ROOM_TTL_MS = 2 * 60 * 1000;

/** An answer bigger than this is not an answer. */
export const MAX_ANSWER_BYTES = 4 * 1024;

/** Enough rooms for any plausible load; past this the oldest are dropped. */
const MAX_ROOMS = 5000;

/** roomId -> { answer, at } */
const rooms = new Map();

const ROOM_ID = /^[a-z0-9]{4,32}$/;

function sweep(now) {
  for (const [id, entry] of rooms) {
    if (now - entry.at > ROOM_TTL_MS) rooms.delete(id);
  }
  // A flood of rooms nobody collects must not grow without bound.
  while (rooms.size > MAX_ROOMS) {
    const oldest = rooms.keys().next();
    if (oldest.done) break;
    rooms.delete(oldest.value);
  }
}

/** Leave the guest's answer for the host. Returns a status and a body. */
export function putAnswer(roomId, answer, now = Date.now()) {
  sweep(now);
  if (!ROOM_ID.test(roomId)) return { status: 400, body: { error: "bad room id" } };
  if (typeof answer !== "string" || answer.length === 0) {
    return { status: 400, body: { error: "no answer" } };
  }
  if (answer.length > MAX_ANSWER_BYTES) {
    return { status: 413, body: { error: "answer too large" } };
  }
  // First answer wins. A second one is either a retry or someone else's, and
  // in both cases the host has already been told about the first.
  if (rooms.has(roomId)) return { status: 409, body: { error: "already answered" } };
  rooms.set(roomId, { answer, at: now });
  return { status: 204, body: null };
}

/** Collect the answer, if it has arrived. Collecting it deletes the room. */
export function takeAnswer(roomId, now = Date.now()) {
  sweep(now);
  if (!ROOM_ID.test(roomId)) return { status: 400, body: { error: "bad room id" } };
  const entry = rooms.get(roomId);
  if (!entry) return { status: 404, body: { waiting: true } };
  rooms.delete(roomId);
  return { status: 200, body: { answer: entry.answer } };
}

/** Give up on a room (the host pressed Cancel). Always succeeds. */
export function dropRoom(roomId) {
  rooms.delete(roomId);
  return { status: 204, body: null };
}

/** For tests. */
export function _roomCount() { return rooms.size; }
export function _clearRooms() { rooms.clear(); }

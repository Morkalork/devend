/**
 * serverNap — is the server awake, asleep, or somewhere in between?
 *
 * The server the pairing goes through runs on a Heroku dyno, and a cheap dyno
 * goes to sleep after half an hour with no visitors. The first request after
 * that wakes it, and waking takes a few seconds, sometimes ten or more. On the
 * 2-Player screen that is a QR that never becomes useful and a spinner with
 * no explanation, which reads as "broken" when it is only "yawning".
 *
 * Nobody can ask a dyno whether it was asleep, but two things give the nap
 * away. A health check that takes seconds rather than milliseconds was waiting
 * on a boot. And a health check answered by a process a few seconds old is
 * talking to one that has just booted, whichever request woke it. So this
 * pings `/api/health` (server/health.js), watches the clock while it waits,
 * and reads the answer's uptime.
 *
 * The probe also IS the alarm clock: it is sent the moment the screen opens,
 * so by the time a player has read the explainer the server is up.
 */

/** What the readout shows. */
export type NapState =
  /** The question is out and it has not been long. */
  | "checking"
  /** It has been long enough that this is a boot, not a network hiccup. */
  | "waking"
  /** Answered quickly by a process that has been up a while. */
  | "awake"
  /** Answered, but slowly or by a brand new process: it was asleep until now. */
  | "justWoke"
  /** No answer at all. Offline, or the server is down. */
  | "unreachable";

/**
 * Past this, a pending check is read as a server waking up.
 *
 * An awake dyno answers a health check in well under half a second from
 * anywhere with signal; a boot takes several seconds. A second and a half sits
 * clear of both, so a slow phone network is not mistaken for a nap.
 */
export const WAKING_AFTER_MS = 1500;

/** A process younger than this was asleep a moment ago. */
export const JUST_WOKE_UPTIME_S = 60;

/** Heroku gives a booting dyno about a minute before it gives up on it. */
export const GIVE_UP_AFTER_MS = 45_000;

/** Classify a finished check. Pure, so every threshold is testable. */
export function classifyNap(result: { elapsedMs: number; uptimeSeconds: number | null; ok: boolean }): NapState {
  if (!result.ok || result.uptimeSeconds === null) return "unreachable";
  if (result.elapsedMs >= WAKING_AFTER_MS || result.uptimeSeconds < JUST_WOKE_UPTIME_S) return "justWoke";
  return "awake";
}

/** Classify a check that has not come back yet. */
export function pendingNap(elapsedMs: number): NapState {
  return elapsedMs >= WAKING_AFTER_MS ? "waking" : "checking";
}

export interface NapProbeOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  url?: string;
  timeoutMs?: number;
}

/**
 * Ask once. Calls `onState` as the picture changes: "checking", then
 * "waking" if the answer is slow, then the verdict. Returns a function that
 * stops listening (the request itself is aborted, so it is not left running
 * behind a screen nobody is looking at).
 */
export function probeServerNap(onState: (s: NapState) => void, opts: NapProbeOptions = {}): () => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => performance.now());
  const abort = new AbortController();
  let settled = false;
  const started = now();

  onState("checking");
  const wakingTimer = setTimeout(() => { if (!settled) onState("waking"); }, WAKING_AFTER_MS);
  const giveUp = setTimeout(() => abort.abort(), opts.timeoutMs ?? GIVE_UP_AFTER_MS);

  const finish = (state: NapState) => {
    if (settled) return;
    settled = true;
    clearTimeout(wakingTimer);
    clearTimeout(giveUp);
    onState(state);
  };

  void (async () => {
    try {
      const res = await fetchImpl(opts.url ?? "/api/health", { cache: "no-store", signal: abort.signal });
      // A page that is not the health report (an old server, a webview serving
      // its own files) is not an answer from this server.
      const body = res.ok ? await res.json() as { ok?: unknown; uptimeSeconds?: unknown } : null;
      const uptime = body && body.ok === true && typeof body.uptimeSeconds === "number" ? body.uptimeSeconds : null;
      finish(classifyNap({ elapsedMs: now() - started, uptimeSeconds: uptime, ok: res.ok }));
    } catch {
      // A network error, a timeout, or a body that was not JSON. After a
      // cancel `settled` is already set and this says nothing.
      finish("unreachable");
    }
  })();

  return () => {
    settled = true;
    clearTimeout(wakingTimer);
    clearTimeout(giveUp);
    abort.abort();
  };
}

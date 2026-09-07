/**
 * Where the admin surface is on by default.
 *
 * Admin is the map builder, the Playground, the upgrade Atlas and the live map
 * tuner. It has always been on for the local Vite dev server and reachable
 * anywhere else by a secret gesture (ten taps on the welcome-screen ball). The
 * gesture is fine as a back door and poor as a daily tool: the staging site is
 * where maps actually get looked at, and asking for ten taps before every
 * inspection is a toll on the thing this project does most.
 *
 * ── Why the host, and not just "is this a production build" ────────────────
 *
 * Staging IS a production build. `npm run build` produces the bundle Heroku
 * serves and the bundle Capacitor packages, so `import.meta.env.DEV` cannot
 * tell them apart, and nothing else in the bundle knows which branch built it.
 * The host is the only signal already present at runtime.
 *
 * ── The trap this function exists to avoid ─────────────────────────────────
 *
 * "Enable it on localhost" is the obvious rule and it is exactly wrong.
 * Capacitor serves the packaged Android app from `http://localhost` (see
 * capacitor.config.ts), so that rule would ship the map builder to every Play
 * Store install. The check therefore names the staging host POSITIVELY and
 * treats everything it does not recognise as a real player's device.
 */

/** The env fields this reads. Passed in so a test can drive it. */
export interface AdminEnv {
  /** Vite's dev-server flag: true only under `npm run dev`. */
  DEV?: boolean;
  /** Explicit override: "1" forces admin on, "0" forces it off. */
  VITE_ADMIN?: string;
}

/** Hosts that are the staging deployment rather than someone's game. */
export function isStagingHost(hostname: string): boolean {
  return /(^|\.)herokuapp\.com$/i.test(hostname.trim());
}

/**
 * Should the admin surface be unlocked without the secret gesture?
 *
 * The override wins over everything, so a production dyno on herokuapp.com can
 * be shut off with one config var without a code change, and a hostile-looking
 * host can be opened for debugging the same way.
 */
export function adminOnByDefault(env: AdminEnv, hostname: string): boolean {
  if (env.VITE_ADMIN === "1") return true;
  if (env.VITE_ADMIN === "0") return false;
  if (env.DEV) return true;
  return isStagingHost(hostname);
}

/** The same question, asked of the real environment. */
export function adminOnHere(): boolean {
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  return adminOnByDefault(import.meta.env as AdminEnv, host);
}

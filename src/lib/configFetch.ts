/**
 * The runtime YAML (public/*.yml), fetched once per page load.
 *
 * Every catalogue was fetched again, uncached, at every run start, and some
 * twice over: map.yml by both the level and the upgrade managers,
 * game-config.yml by every component that mounted useGameConfig, and the
 * seven catalogues that are also bundled were fetched at boot and again per
 * run. In production these files change only with a deploy, which reloads the
 * page anyway. The one thing that changes them under a live page is a map
 * save from Admin, which drops the cached copy (mapSave.ts), so the next run
 * reads what was just written, as before.
 *
 * Only the TEXT is shared. Each reader still parses its own copy, so one
 * reader adjusting what it parsed can never reach another.
 */

/** The parts of a Response the readers use. */
export interface ConfigResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

const texts = new Map<string, Promise<string>>();

export function fetchConfig(url: string): Promise<ConfigResponse> {
  // A dev server serves public/ live, and editing a .yml there has always
  // reached the next run without a reload; that stays true.
  if (import.meta.env.DEV && !import.meta.env.VITEST) texts.delete(url);
  let text = texts.get(url);
  if (!text) {
    text = fetch(url, { cache: "no-store" }).then(res => {
      if (!res.ok) throw Object.assign(new Error(`Failed to load ${url}: ${res.status}`), { status: res.status });
      return res.text();
    });
    texts.set(url, text);
    // A failure is not remembered: the next ask tries again.
    text.catch(() => { if (texts.get(url) === text) texts.delete(url); });
  }
  return text.then(
    t => ({ ok: true, status: 200, text: () => Promise.resolve(t) }),
    (e: { status?: number }) => ({ ok: false, status: e?.status ?? 0, text: () => Promise.resolve("") }),
  );
}

/** Forget one file (a save just changed it), or every file. */
export function invalidateConfig(url?: string): void {
  if (url) texts.delete(url);
  else texts.clear();
}

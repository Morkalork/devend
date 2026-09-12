/**
 * The music catalogue: what plays, who wrote it, and where it came from.
 *
 * Loaded from public/music.yml so the credits and the Jukebox playlist are one
 * list rather than two that drift. The screen is the only consumer; playback
 * during the game still goes through gameMusic.ts, which selects by level and
 * knows nothing about this.
 *
 * A broken or missing file leaves the catalogue empty and the menu button
 * hidden, on the same principle as every other catalogue here: content that
 * fails to load costs you a screen, never a game.
 */
import { fetchYamlCatalogue } from "@/lib/yamlCatalogue";
import type { MusicCatalogue, MusicTrack } from "@/types/music";

const MUSIC_DIR = "/assets/music";
const DEFAULT_LICENSE = {
  name: "Pixabay Content License",
  url: "https://pixabay.com/service/license-summary/",
};

let catalogue: MusicCatalogue | null = null;

function parseTrack(raw: unknown): MusicTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.file !== "string" || !r.file) return null;
  if (typeof r.title !== "string" || !r.title) return null;

  const usedFor =
    r.usedFor === "menu" || r.usedFor === "band" || r.usedFor === "credits"
      ? r.usedFor
      : "band";

  const band = (key: "bandFrom" | "bandTo"): number | undefined => {
    const n = Number(r[key]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  };

  return {
    file: r.file,
    src: `${MUSIC_DIR}/${r.file}`,
    title: r.title,
    artist: typeof r.artist === "string" && r.artist ? r.artist : undefined,
    source: typeof r.source === "string" && r.source ? r.source : undefined,
    url: typeof r.url === "string" && r.url ? r.url : undefined,
    usedFor,
    bandFrom: band("bandFrom"),
    bandTo: band("bandTo"),
  };
}

/** Parse an already-fetched document. Exported for the catalogue test. */
export function parseMusicDoc(doc: Record<string, unknown>): MusicCatalogue {
  const list = Array.isArray(doc.tracks) ? doc.tracks : [];
  const tracks = list.map(parseTrack).filter((t): t is MusicTrack => t !== null);
  const lic = (doc.license ?? {}) as Record<string, unknown>;
  return {
    tracks,
    license: {
      name: typeof lic.name === "string" && lic.name ? lic.name : DEFAULT_LICENSE.name,
      url: typeof lic.url === "string" && lic.url ? lic.url : DEFAULT_LICENSE.url,
    },
  };
}

/**
 * Load public/music.yml. Returns true on success; a failure leaves the
 * catalogue null, which hides the Jukebox rather than showing an empty one.
 */
export async function loadMusicCatalogue(): Promise<boolean> {
  try {
    const { doc } = await fetchYamlCatalogue("/music.yml", "tracks", parseTrack);
    catalogue = parseMusicDoc(doc);
    return catalogue.tracks.length > 0;
  } catch (err) {
    console.warn("[music] Catalogue unavailable, hiding the Jukebox:", err);
    return false;
  }
}

/** The loaded catalogue, or null before a successful load. */
export function getMusicCatalogue(): MusicCatalogue | null {
  return catalogue;
}

/** Reset for tests. */
export function resetMusicCatalogue(): void {
  catalogue = null;
}

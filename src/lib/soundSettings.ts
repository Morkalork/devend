// Sound settings — loads the default music/effects volumes (and crossfade) from
// public/game-config.yml (`sound:` section), applies any per-device overrides the
// player saved in Options, and pushes the result to the audio subsystems. Music
// (gameMusic) and SFX (gameAudio) are independent levels.

import yaml from "js-yaml";
import { setMusicVolume, setCrossfadeMs } from "@/lib/gameMusic";
import { setSfxVolume } from "@/lib/gameAudio";

const LS_MUSIC = "devend:musicVolume";
const LS_SFX = "devend:sfxVolume";
const LS_MUTED = "devend:soundMuted";

// Hard fallbacks used ONLY if game-config.yml can't be loaded. The real defaults
// live in public/game-config.yml under `sound:`.
const FALLBACK_MUSIC = 0.2;
const FALLBACK_SFX = 1.0;
const FALLBACK_CROSSFADE_MS = 900;

interface SoundConfig {
  music_volume?: number;
  sfx_volume?: number;
  crossfade_ms?: number;
}

let musicVolume = FALLBACK_MUSIC;
let sfxVolume = FALLBACK_SFX;
let defaultMusicVolume = FALLBACK_MUSIC;
let defaultSfxVolume = FALLBACK_SFX;
let muted = false;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? clamp01(n) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode / storage disabled: settings just won't persist */
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function storeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode / storage disabled: settings just won't persist */
  }
}

/**
 * Load default volumes from game-config.yml, apply any localStorage overrides,
 * and push the result to the audio subsystems. Call once at startup; async
 * because it fetches the config (audio doesn't play until the first gesture, well
 * after this resolves, so the config-driven defaults are in place in time).
 */
export async function loadSoundSettings(): Promise<void> {
  try {
    const res = await fetch("/game-config.yml");
    const cfg = yaml.load(await res.text()) as { sound?: SoundConfig } | undefined;
    const s = cfg?.sound ?? {};
    defaultMusicVolume = clamp01(num(s.music_volume, FALLBACK_MUSIC));
    defaultSfxVolume = clamp01(num(s.sfx_volume, FALLBACK_SFX));
    setCrossfadeMs(num(s.crossfade_ms, FALLBACK_CROSSFADE_MS));
  } catch (err) {
    console.warn("Failed to load sound config, using fallback defaults:", err);
  }

  // A saved per-device choice (Options slider) overrides the config default.
  musicVolume = readStored(LS_MUSIC, defaultMusicVolume);
  sfxVolume = readStored(LS_SFX, defaultSfxVolume);
  muted = readStoredBool(LS_MUTED, false);
  setMusicVolume(muted ? 0 : musicVolume);
  setSfxVolume(muted ? 0 : sfxVolume);
}

export function getMusicVolumeSetting(): number {
  return musicVolume;
}

export function getSfxVolumeSetting(): number {
  return sfxVolume;
}

/** Set + persist the music volume (0..1) and apply it live (unless muted). */
export function setMusicVolumeSetting(volume: number): void {
  musicVolume = clamp01(volume);
  if (!muted) setMusicVolume(musicVolume);
  store(LS_MUSIC, musicVolume);
}

/** Set + persist the effects volume (0..1) and apply it live (unless muted). */
export function setSfxVolumeSetting(volume: number): void {
  sfxVolume = clamp01(volume);
  if (!muted) setSfxVolume(sfxVolume);
  store(LS_SFX, sfxVolume);
}

export function isSoundMuted(): boolean {
  return muted;
}

/**
 * Mute/unmute both music and effects without touching their saved volume
 * levels (the top-menu toggle) - unmuting restores exactly what the Options
 * sliders were set to.
 */
export function setSoundMuted(next: boolean): void {
  muted = next;
  setMusicVolume(muted ? 0 : musicVolume);
  setSfxVolume(muted ? 0 : sfxVolume);
  storeBool(LS_MUTED, muted);
}

// Sound settings — persists the music and effects volumes and applies them to
// the audio subsystems. Music (gameMusic) and SFX (gameAudio) are independent
// levels so players can balance them in Options.

import { setMusicVolume } from "@/lib/gameMusic";
import { setSfxVolume } from "@/lib/gameAudio";

const LS_MUSIC = "devend:musicVolume";
const LS_SFX = "devend:sfxVolume";

export const DEFAULT_MUSIC_VOLUME = 0.5; // 50% by default
export const DEFAULT_SFX_VOLUME = 1.0;

let musicVolume = DEFAULT_MUSIC_VOLUME;
let sfxVolume = DEFAULT_SFX_VOLUME;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

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

/** Load persisted volumes and apply them. Call once at app startup. */
export function loadSoundSettings(): void {
  musicVolume = readStored(LS_MUSIC, DEFAULT_MUSIC_VOLUME);
  sfxVolume = readStored(LS_SFX, DEFAULT_SFX_VOLUME);
  setMusicVolume(musicVolume);
  setSfxVolume(sfxVolume);
}

export function getMusicVolumeSetting(): number {
  return musicVolume;
}

export function getSfxVolumeSetting(): number {
  return sfxVolume;
}

/** Set + persist the music volume (0..1) and apply it live. */
export function setMusicVolumeSetting(volume: number): void {
  musicVolume = clamp01(volume);
  setMusicVolume(musicVolume);
  store(LS_MUSIC, musicVolume);
}

/** Set + persist the effects volume (0..1) and apply it live. */
export function setSfxVolumeSetting(volume: number): void {
  sfxVolume = clamp01(volume);
  setSfxVolume(sfxVolume);
  store(LS_SFX, sfxVolume);
}

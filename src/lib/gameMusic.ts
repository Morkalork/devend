// Background Music
//
// Two looping <audio> elements (module singletons, so they survive the per-round
// GameScreen remount and keep playing). Track selection is driven by the current
// level: a shared "main" loop plus one track per 5-level band (levels 1-5 ->
// maps_1-5.mp3, 6-10 -> maps_6-10.mp3, ...). Switching crossfades between the two
// elements so track changes are smooth, not abrupt. A missing/broken band track
// falls back to main.mp3.
//
// Files live in public/assets/music/ and are served at /assets/music/*.

import { isAudioMuted } from "@/lib/gameAudio";

const MUSIC_DIR = "/assets/music";
const MAIN_TRACK = `${MUSIC_DIR}/main.mp3`;
const DEFAULT_VOLUME = 0.2; // default music level; user-adjustable in Options
const LEVELS_PER_BAND = 5;
let crossfadeMs = 900; // default; overridden from game-config.yml via setCrossfadeMs

/** Path of the band track for a level (levels 1-5 -> maps_1-5.mp3, etc.). */
export function musicFileForLevel(levelNumber: number): string {
  const level = Math.max(1, Math.floor(levelNumber) || 1);
  const band = Math.floor((level - 1) / LEVELS_PER_BAND);
  const lo = band * LEVELS_PER_BAND + 1;
  const hi = lo + LEVELS_PER_BAND - 1;
  return `${MUSIC_DIR}/maps_${lo}-${hi}.mp3`;
}

/** Band key for a level, used to avoid restarting music within the same band. */
function bandKey(levelNumber: number): string {
  const level = Math.max(1, Math.floor(levelNumber) || 1);
  return `band:${Math.floor((level - 1) / LEVELS_PER_BAND)}`;
}

// Two-element crossfade deck. `activeIndex` is the element holding the current
// (foreground) track; the other is used for the incoming track on a switch.
let deck: [HTMLAudioElement, HTMLAudioElement] | null = null;
let activeIndex: 0 | 1 = 0;
let currentKey: string | null = null; // logical track: bandKey() or 'main'
let musicMuted = false;
let musicVolume = DEFAULT_VOLUME;
let fadeGen = 0; // bumped on each switch so stale fades cancel themselves
let audioUnlocked = false;
let gestureArmed = false;

function ensureDeck(): [HTMLAudioElement, HTMLAudioElement] | null {
  if (typeof Audio === "undefined") return null; // non-browser (tests/SSR)
  if (!deck) {
    const make = () => {
      const a = new Audio();
      a.loop = false; // crossfade-loop handled manually via timeupdate
      a.preload = "auto";
      a.volume = 0;
      return a;
    };
    deck = [make(), make()];
  }
  return deck;
}

function applyMute(a: HTMLAudioElement): void {
  // A single global "sound off" (isAudioMuted) also silences music; setMusicMuted
  // is an independent music-only toggle for a future settings UI.
  a.muted = musicMuted || isAudioMuted();
}

/**
 * Prime one deck element so it can be played later WITHOUT a fresh user gesture.
 * Mobile browsers (unlike desktop) unlock media per-element: an <audio> that has
 * never had play() called inside a gesture stays silent forever. Our crossfade
 * uses two elements, but only the foreground one plays during the first gesture —
 * so the FIRST band switch (level start) would crossfade onto a never-unlocked
 * element and produce nothing. Play a muted real clip on it inside the gesture,
 * then quietly reset; that permanently unlocks the element on mobile.
 */
function primeElement(a: HTMLAudioElement): void {
  try {
    a.dataset.priming = "1";
    a.muted = true;
    if (!a.src) a.src = MAIN_TRACK; // needs a reachable resource to unlock
    const restore = () => {
      if (a.dataset.priming !== "1") return; // a real switchTo took this element over
      delete a.dataset.priming;
      a.pause();
      try { a.currentTime = 0; } catch { /* ignore */ }
      applyMute(a);
    };
    const p = a.play();
    if (p && typeof p.then === "function") p.then(restore).catch(restore);
    else restore();
  } catch { /* ignore */ }
}

/**
 * First-gesture unlock: (re)start the foreground track for real AND prime the
 * crossfade partner, so both deck elements are usable thereafter. Without priming
 * the partner, mobile level music (a crossfade onto the fresh element) is silent
 * even though SFX — which use Web Audio, unlocked separately — work fine.
 */
function unlockDeck(): void {
  audioUnlocked = true;
  const pair = deck;
  if (!pair) return;
  const active = pair[activeIndex];
  const inactive = pair[(1 - activeIndex) as 0 | 1];
  if (active && currentKey) {
    const p = active.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
  }
  if (inactive) primeElement(inactive);
}

/**
 * Browsers block audio until the first user gesture. Our menu-screen .play() is
 * blocked, so arm a one-time capture-phase listener that, on the first interaction
 * anywhere, unlocks BOTH deck elements (see unlockDeck) from within the gesture.
 *
 * Armed EAGERLY (synchronously, the moment we first try to play while locked) —
 * not from the play() rejection, which is async: a first click can land in the
 * window where play() is still pending, before the .catch() would have armed us,
 * and be missed.
 */
function armGestureUnlock(): void {
  if (audioUnlocked || gestureArmed || typeof window === "undefined") return;
  gestureArmed = true;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const handler = () => {
    for (const ev of events) window.removeEventListener(ev, handler, true);
    unlockDeck();
  };
  for (const ev of events) window.addEventListener(ev, handler, true);
}

/**
 * Ramp an element's volume to `target` over `durationMs`. Tagged with the switch
 * generation so a newer switch cancels this fade mid-flight. Muted elements still
 * ramp (inaudible) so unmuting mid-fade lands at the right level.
 */
function fadeTo(a: HTMLAudioElement, target: number, durationMs: number, gen: number, onDone?: () => void): void {
  if (typeof requestAnimationFrame === "undefined") { a.volume = target; onDone?.(); return; }
  const start = a.volume;
  const t0 = performance.now();
  const step = (now: number) => {
    if (gen !== fadeGen) return; // superseded by a newer switch
    const p = Math.min(1, (now - t0) / durationMs);
    a.volume = Math.max(0, Math.min(1, start + (target - start) * p));
    if (p < 1) requestAnimationFrame(step);
    else onDone?.();
  };
  requestAnimationFrame(step);
}

/**
 * Crossfade to `src` (logical `key`). No-op if that track is already current, so
 * calling it every level only switches at band boundaries. When `withFallback`,
 * a load error swaps the incoming element to main.mp3 without changing the key
 * (so a missing band file isn't re-attempted on every level in the band).
 */
function switchTo(src: string, key: string, withFallback: boolean): void {
  if (key === currentKey) return;
  const pair = ensureDeck();
  if (!pair) return;
  currentKey = key;
  const gen = ++fadeGen;

  const outgoing = pair[activeIndex];
  const incoming = pair[(1 - activeIndex) as 0 | 1];
  const crossfade = !outgoing.paused;

  incoming.onerror = withFallback
    ? () => {
        incoming.onerror = null;
        incoming.src = MAIN_TRACK; // fall back, keep the in-flight crossfade + key
        incoming.currentTime = 0;
        const pf = incoming.play();
        if (pf && typeof pf.catch === "function") pf.catch(() => armGestureUnlock());
      }
    : null;

  delete incoming.dataset.priming; // cancel any in-flight prime-restore on this element
  incoming.src = src;
  incoming.currentTime = 0;
  incoming.volume = 0;
  applyMute(incoming);
  const p = incoming.play();
  if (p && typeof p.catch === "function") p.catch(() => armGestureUnlock());
  // Arm the gesture unlock NOW, not only from the async play() rejection above:
  // a first click can otherwise land before the .catch() fires and be missed.
  // No-op once audio is unlocked (self-guarded).
  armGestureUnlock();

  activeIndex = (1 - activeIndex) as 0 | 1;

  fadeTo(incoming, musicVolume, crossfadeMs, gen);
  if (crossfade) {
    fadeTo(outgoing, 0, crossfadeMs, gen, () => outgoing.pause());
  } else {
    outgoing.pause();
  }

  // Near-end crossfade loop. When the active element is ~(crossfadeMs + 500ms)
  // from its natural end, crossfade to the same track from the beginning so the
  // loop is seamless. The +500ms buffer means the fade completes ~500ms before
  // the old element ends, so it's already silent when it stops. Stale handlers
  // (from earlier switches) cancel immediately via the fadeGen guard.
  const self = incoming;
  const selfSrc = src;
  const selfKey = key;
  const selfFallback = withFallback;
  function onNearEnd() {
    if (fadeGen !== gen) { self.removeEventListener("timeupdate", onNearEnd); return; }
    const dur = self.duration;
    if (!dur || !isFinite(dur)) return;
    if (self.currentTime >= dur - crossfadeMs / 1000 - 0.5) {
      self.removeEventListener("timeupdate", onNearEnd);
      currentKey = null; // bypass the idempotency guard
      switchTo(selfSrc, selfKey, selfFallback);
    }
  }
  self.addEventListener("timeupdate", onNearEnd);
}

/**
 * Play the track for the given level. Idempotent within a band, so calling it
 * every level (including across GameScreen remounts) crossfades only at band
 * boundaries and runs continuously through a 5-level stretch. Missing/broken band
 * files fall back to main.mp3.
 */
export function playMusicForLevel(levelNumber: number): void {
  switchTo(musicFileForLevel(levelNumber), bandKey(levelNumber), true);
}

/** Crossfade to the shared main loop (menus, or an explicit default). */
export function playMainMusic(): void {
  switchTo(MAIN_TRACK, "main", false);
}

/** Stop and reset (e.g., returning to a silent screen). */
export function stopMusic(): void {
  currentKey = null;
  fadeGen++; // cancel any in-flight fades
  if (deck) for (const a of deck) a.pause();
}

/** Music-only mute (independent of the global SFX mute). */
export function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  if (deck) for (const a of deck) applyMute(a);
}

/** Re-evaluate mute after the global sound toggle changes. */
export function refreshMusicMute(): void {
  if (deck) for (const a of deck) applyMute(a);
}

/** Set music volume (0..1). */
export function setMusicVolume(volume: number): void {
  musicVolume = Math.max(0, Math.min(1, volume));
  if (deck) deck[activeIndex].volume = musicVolume;
}

/** Current music volume (0..1). */
export function getMusicVolume(): number {
  return musicVolume;
}

/** Set the crossfade duration between tracks (milliseconds). */
export function setCrossfadeMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) crossfadeMs = ms;
}

// Haptic feedback wrapper for Android WebView (navigator.vibrate).
// iOS Safari and desktop browsers silently no-op — the guard keeps it safe.
// Mirrors the mute-state pattern from gameAudio.ts.

let _enabled = true;

function vibe(pattern: number | number[]): void {
  if (!_enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported platform — no-op
  }
}

/** Short 15ms tap when the player successfully places a fence. */
export function vibrateFenceComplete(): void {
  vibe(15);
}

/** Firm 50ms pulse when a ball breaks a fence. */
export function vibrateFenceBreak(): void {
  vibe(50);
}

/** Double-thump on life lost: 50ms on, 40ms off, 30ms on. */
export function vibrateDeath(): void {
  vibe([50, 40, 30]);
}

/** Three rising pulses matching the lock-sound sequence. */
export function vibrateBallLock(): void {
  vibe([20, 50, 20, 50, 35]);
}

export function setHapticsEnabled(enabled: boolean): void {
  _enabled = enabled;
}

export function isHapticsEnabled(): boolean {
  return _enabled;
}

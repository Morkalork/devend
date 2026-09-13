/**
 * How the balls are dressed: the web on the shell and the flicker of the
 * light inside. Rendering settings, not gameplay, so they live outside the
 * modifiers; persisted, so a tester's dial survives a reload, and read by
 * the renderer every frame through one cached object.
 *
 * Both have a Playground control (CLAUDE.md: anything new that changes how
 * the game plays lands with the control that lets a tester reach it). The
 * web has a slider from off to obvious rather than a toggle, because the
 * right strength is a judgement made while playing, not in a review.
 */
export interface BallLook {
  /** Web strength, 0 (none) .. 1 (obvious). */
  web: number;
  /** Whether the light inside flickers now and then. */
  flicker: boolean;
}

const KEY = "devend.ballLook";
export const DEFAULT_BALL_LOOK: BallLook = { web: 0.6, flicker: true };

let current: BallLook | null = null;

function load(): BallLook {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BallLook>;
      return sanitise({ ...DEFAULT_BALL_LOOK, ...parsed });
    }
  } catch { /* unreadable storage: defaults */ }
  return { ...DEFAULT_BALL_LOOK };
}

function sanitise(l: BallLook): BallLook {
  const web = Number.isFinite(l.web) ? Math.min(1, Math.max(0, l.web)) : DEFAULT_BALL_LOOK.web;
  return { web, flicker: !!l.flicker };
}

/** The current look. Cached: this is read per ball per frame. */
export function getBallLook(): BallLook {
  if (!current) current = load();
  return current;
}

/** Change part of the look; persisted, and live from the next frame. */
export function setBallLook(patch: Partial<BallLook>): BallLook {
  current = sanitise({ ...getBallLook(), ...patch });
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* storage full or blocked: the setting still applies this session */ }
  return current;
}

/** Tests: forget the cached look so the next read comes from storage. */
export function resetBallLookCache(): void {
  current = null;
}

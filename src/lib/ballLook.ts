import { BALL_PATTERNS, type BallPattern } from "@/lib/ballTypes";

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
  /**
   * 3D board: how dark the shell's pattern shades the light inside, 0 (a bare
   * bulb, nothing to show it rolling) .. 1 (the ribs nearly black).
   */
  shade: number;
  /**
   * 3D board: the highlight facing the key light, 0 (none) .. 1. It stays put
   * while the pattern turns under it, which is most of what reads as rolling.
   */
  glint: number;
  /** 3D board: every ball in one pattern, for comparing; "auto" = each type's own. */
  pattern: BallPattern | "auto";
}

const KEY = "devend.ballLook";
export const DEFAULT_BALL_LOOK: BallLook = { web: 0.6, flicker: true, shade: 0.85, glint: 0.8, pattern: "auto" };

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

function unit(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function sanitise(l: BallLook): BallLook {
  return {
    web: unit(l.web, DEFAULT_BALL_LOOK.web),
    flicker: !!l.flicker,
    shade: unit(l.shade, DEFAULT_BALL_LOOK.shade),
    glint: unit(l.glint, DEFAULT_BALL_LOOK.glint),
    pattern: (BALL_PATTERNS as readonly string[]).includes(l.pattern) ? l.pattern : "auto",
  };
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

// ── Animation timing (milliseconds) ───────────────────────────────────────
export const LOCK_PULSE_DURATION  = 600;  // ms — 3 quick pulses
export const LOCK_FLOOD_DURATION  = 380;  // ms — fill explodes across region
export const LOCK_DUST_DURATION   = 900;  // ms — longest particle lifetime
export const LOCK_TOTAL_DURATION  = LOCK_PULSE_DURATION + LOCK_FLOOD_DURATION;
export const BALL_DISINTEGRATE_MS = 420;  // ms — ball shrinks to nothing
export const DISSOLVE_DURATION    = 1000; // ms — board dissolve after level complete

// ── Physics / world units ─────────────────────────────────────────────────
export const PHYSICS_STEP              = 1 / 120; // Fixed physics timestep: 120 ticks per second
export const BASE_BALL_RADIUS          = 18;      // World units
export const BALL_SPEED_INCREASE       = 1.03;    // Post-wall speed ramp
export const BASE_SWIPE_MIN_DISTANCE   = 5;       // World units
export const ARENA_MARGIN              = 0.05;    // 5% margin from board edges
export const MINIMUM_WALL_TIME         = 0.35;    // seconds
export const RECOVERY_WINDOW_MS        = 700;     // Recovery time after failed wall
export const BALL_WON_REGION_THRESHOLD = 10;      // Ball is WON if its region is <= this % of current active area
export const WON_BALL_SPIN_SPEED       = 8;       // Radians per second for won ball spin

// ── Static colours ────────────────────────────────────────────────────────
export const COLORS = {
  cutPreview:           "rgba(255, 255, 255, 0.3)",
  fastestBallHighlight: "#00ffff",
  debugOutline:         "#ff00ff",
};

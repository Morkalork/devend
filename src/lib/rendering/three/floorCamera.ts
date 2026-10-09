/**
 * The 3D board's camera: a perspective camera looking straight down, whose
 * floor lands on exactly the pixels the 2D board always did.
 *
 * WHY THIS IS THE WHOLE TRICK. Everything outside the renderer - input, the
 * layout latch, the trajectory preview, the perf HUD's picture of the board -
 * speaks in `boardRect`: world (x, y) is drawn at
 * (left + x * scale, top + y * scale). A camera looking straight down at a
 * plane parallel to its image plane projects that plane AFFINELY, so the floor
 * can be made to obey that same rule exactly, and then none of those callers
 * can tell the board became 3D. Only things standing above the floor show any
 * perspective: a fence's top leans a few units out from the middle of the
 * board, which is precisely the sliver of side wall that makes it read as a
 * thing standing up rather than a stripe.
 *
 * The frustum is OFF-AXIS. The board is not centred on the canvas (the top
 * bar and the bottom stack take different bites), so a symmetric frustum would
 * either misplace the floor or need the camera over the canvas centre, which
 * would lean fences on one side of the board more than the other. Instead the
 * eye sits over the board's centre and the frustum is skewed to the canvas.
 *
 * Space: one three.js unit is one world unit. The floor is y = 0, world x is
 * +X, world y is +Z (screen-down), and height above the board is +Y.
 */
import type { BoardRect } from "@/lib/boardConstants";

/** The centre of the 900-unit board, in world units. */
export const BOARD_CENTRE = 450;

/** Default vertical field of view, in degrees, across the board's height. */
export const DEFAULT_FOV_DEG = 26;
/** The Admin knob's range. Narrower is flatter; wider leans walls further. */
export const MIN_FOV_DEG = 8;
export const MAX_FOV_DEG = 50;

export interface FloorCamera {
  /** Eye position: over the board centre, `distance` above the floor. */
  eye: { x: number; y: number; z: number };
  /** Off-axis frustum at the near plane, three's makePerspective order. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * How far above the floor the eye sits for a field of view: the distance at
 * which the board's 900 units span `fovDeg` vertically.
 */
export function eyeDistance(fovDeg: number): number {
  const f = Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, fovDeg));
  return BOARD_CENTRE / Math.tan((f * Math.PI) / 360);
}

/**
 * The camera that maps the floor onto `rect` on a `width` x `height` surface.
 *
 * `headroom` is how tall the tallest thing in the scene can be (an explosion's
 * debris arcs above the walls); the near plane sits just above it so depth
 * precision is spent on the few dozen units the scene actually occupies.
 */
export function floorCamera(
  width: number, height: number, rect: BoardRect, fovDeg = DEFAULT_FOV_DEG, headroom = 260,
): FloorCamera {
  const d = eyeDistance(fovDeg);
  const s = rect.scale > 0 ? rect.scale : 1;
  // The floor's visible extent, in world units, at the canvas edges.
  const x0 = -rect.left / s;
  const x1 = (width - rect.left) / s;
  const z0 = -rect.top / s;
  const z1 = (height - rect.top) / s;
  // Camera space: +x is world +X; +y (up on screen) is world -Z.
  const near = Math.max(1, d - headroom);
  const far = d + 60;
  const k = near / d;
  return {
    eye: { x: BOARD_CENTRE, y: d, z: BOARD_CENTRE },
    left: (x0 - BOARD_CENTRE) * k,
    right: (x1 - BOARD_CENTRE) * k,
    top: (BOARD_CENTRE - z0) * k,
    bottom: (BOARD_CENTRE - z1) * k,
    near,
    far,
  };
}

/**
 * Where a scene point lands on the surface, in pixels: the camera's own
 * projection written out, for tests and for anything that needs to put a 2D
 * mark on a 3D object. For a floor point (y = 0) this is exactly
 * (left + x * scale, top + z * scale).
 */
export function projectToSurface(
  cam: FloorCamera, width: number, height: number, x: number, y: number, z: number,
): { x: number; y: number } {
  const depth = cam.eye.y - y;
  // Into camera space, then onto the near plane.
  const cx = (x - cam.eye.x) * (cam.near / depth);
  const cy = (cam.eye.z - z) * (cam.near / depth);
  const nx = ((cx - cam.left) / (cam.right - cam.left)) * 2 - 1;
  const ny = ((cy - cam.bottom) / (cam.top - cam.bottom)) * 2 - 1;
  return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
}

/** A surface pixel back onto the floor, in the scene's (tilted) world units. */
export function surfaceToFloor(rect: BoardRect, sx: number, sy: number): { x: number; z: number } {
  const s = rect.scale > 0 ? rect.scale : 1;
  return { x: (sx - rect.left) / s, z: (sy - rect.top) / s };
}

/**
 * The board's tilt (issue #77) as the 4x4 matrix the 3D board group carries,
 * column-major like three's Matrix4.elements: turn about the centre by the
 * same angle and shrink by the same fit the 2D w2s applies through
 * tiltWorldPoint, so a world point (x, h, y) lands at the tilted (x', h', y').
 * tiltWorldPoint rotates (x, y) by +angle in a y-down plane; in (x, z) that is
 * a rotation about Y by -angle.
 */
export function boardTiltElements(angle: number, k: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  // x' = C + k (c dx - s dz), z' = C + k (s dx + c dz), y' = k y.
  const C = BOARD_CENTRE;
  return [
    k * c, 0, k * s, 0,
    0, k, 0, 0,
    -k * s, 0, k * c, 0,
    C - k * (c * C - s * C), 0, C - k * (s * C + c * C), 1,
  ];
}

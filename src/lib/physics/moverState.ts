export interface MoverState {
  id: string;
  shape: "circle" | "rect";
  /** Center of oscillation (circle: cx/cy; rect: x+w/2, y+h/2). */
  homeX: number;
  homeY: number;
  radius?: number;
  width?: number;
  height?: number;
  axis: "horizontal" | "vertical";
  range: number;
  speed: number;
  /** Current displacement from home (−range/2 … +range/2). */
  offset: number;
  direction: 1 | -1;
  /** Polygon updated in place every physics step for collision + rendering. */
  polygon: { vertices: { x: number; y: number }[] };
  /** Cached bounding-circle radius (circle: radius; rect: half diagonal), filled lazily. */
  boundRadius?: number;
  /**
   * A bent mover's outline, relative to its home centre.
   *
   * Bending is not recomputed per step and must not be: this update runs at
   * 120 Hz per mover, and the whole reason updateMoverPolygon writes in place
   * is that rebuilding 25 vertex objects a step was measurable GC pressure -
   * a bend would make that a 90-vertex arc rebuild instead. A mover only ever
   * translates, never rotates, so the bent shape is computed once at build and
   * the step just adds the offset to it.
   */
  bentOutline?: { x: number; y: number }[];
}

const CIRCLE_SIDES = 24;

export function buildMoverPolygon(m: MoverState): MoverState["polygon"] {
  const dx = m.axis === "horizontal" ? m.offset : 0;
  const dy = m.axis === "vertical"   ? m.offset : 0;

  if (m.bentOutline) {
    return {
      vertices: m.bentOutline.map(p => ({ x: m.homeX + p.x + dx, y: m.homeY + p.y + dy })),
    };
  }

  if (m.shape === "circle") {
    const cx = m.homeX + dx;
    const cy = m.homeY + dy;
    return {
      vertices: Array.from({ length: CIRCLE_SIDES }, (_, i) => {
        const a = (i / CIRCLE_SIDES) * Math.PI * 2;
        return { x: cx + Math.cos(a) * m.radius!, y: cy + Math.sin(a) * m.radius! };
      }),
    };
  }

  const x = m.homeX - m.width!  / 2 + dx;
  const y = m.homeY - m.height! / 2 + dy;
  return {
    vertices: [
      { x,                  y                   },
      { x: x + m.width!,   y                   },
      { x: x + m.width!,   y: y + m.height!    },
      { x,                  y: y + m.height!    },
    ],
  };
}

/**
 * Update an existing mover polygon's vertices in place for the current offset.
 * Same geometry as buildMoverPolygon, but with zero allocations — this runs at
 * 120 Hz per mover, and rebuilding 25 vertex objects per step was measurable
 * GC pressure.
 */
export function updateMoverPolygon(m: MoverState): void {
  const dx = m.axis === "horizontal" ? m.offset : 0;
  const dy = m.axis === "vertical"   ? m.offset : 0;
  const verts = m.polygon.vertices;

  if (m.bentOutline) {
    const base = m.bentOutline;
    for (let i = 0; i < verts.length; i++) {
      verts[i].x = m.homeX + base[i].x + dx;
      verts[i].y = m.homeY + base[i].y + dy;
    }
    return;
  }

  if (m.shape === "circle") {
    const cx = m.homeX + dx;
    const cy = m.homeY + dy;
    for (let i = 0; i < verts.length; i++) {
      const a = (i / verts.length) * Math.PI * 2;
      verts[i].x = cx + Math.cos(a) * m.radius!;
      verts[i].y = cy + Math.sin(a) * m.radius!;
    }
    return;
  }

  const x = m.homeX - m.width!  / 2 + dx;
  const y = m.homeY - m.height! / 2 + dy;
  verts[0].x = x;             verts[0].y = y;
  verts[1].x = x + m.width!;  verts[1].y = y;
  verts[2].x = x + m.width!;  verts[2].y = y + m.height!;
  verts[3].x = x;             verts[3].y = y + m.height!;
}

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
  /** Polygon rebuilt every physics step for collision + rendering. */
  polygon: { vertices: { x: number; y: number }[] };
}

const CIRCLE_SIDES = 24;

export function buildMoverPolygon(m: MoverState): MoverState["polygon"] {
  const dx = m.axis === "horizontal" ? m.offset : 0;
  const dy = m.axis === "vertical"   ? m.offset : 0;

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

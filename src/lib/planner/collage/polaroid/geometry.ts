export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned bounds, in px, of a frame rotated about its centre. */
export function rotatedBounds(frame: FrameRect): Bounds {
  const rad = (frame.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (frame.w * cos + frame.h * sin) / 2;
  const halfH = (frame.w * sin + frame.h * cos) / 2;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

function area(b: Bounds): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

/** Overlap area divided by the smaller bound's area; 0 when disjoint. */
export function overlapRatio(a: Bounds, b: Bounds): number {
  const inter = area({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  });
  const smaller = Math.min(area(a), area(b));
  return smaller === 0 ? 0 : inter / smaller;
}

export interface LayoutIssue {
  cellIndex: number;
  message: string;
}

interface RectCell {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Checks that every cell lies inside the canvas and that no two cells overlap.
 * All values are integer canvas pixels. Pure and deterministic.
 */
export function validateLayout(spec: {
  canvas: { w: number; h: number };
  cells: ReadonlyArray<RectCell & { image: string | null }>;
}): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const { canvas, cells } = spec;
  for (const [cellIndex, c] of cells.entries()) {
    if (c.x + c.w > canvas.w || c.y + c.h > canvas.h) {
      issues.push({ cellIndex, message: "cell extends outside the canvas" });
    }
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (overlaps(cells[i], cells[j])) {
        issues.push({ cellIndex: j, message: `cell overlaps cell ${cells[i].id}` });
      }
    }
  }
  return issues;
}

function overlaps(a: RectCell, b: RectCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

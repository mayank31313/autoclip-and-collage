import { TEMPLATE_IMAGE_COUNTS, type CollageTemplateId } from "@/lib/schemas/collage";
import { layoutRows, splitEven } from "./justifiedRows";
import type { CanvasSize, Slot } from "./types";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fills `area` with a rows x cols grid of equal cells (remainders go to earlier cells). */
function equalGrid(area: Rect, rows: number, cols: number, gapPx: number): Rect[] {
  const widths = splitEven(area.w - gapPx * (cols - 1), cols);
  const heights = splitEven(area.h - gapPx * (rows - 1), rows);
  const rects: Rect[] = [];
  let y = area.y;
  for (const h of heights) {
    let x = area.x;
    for (const w of widths) {
      rects.push({ x, y, w, h });
      x += w + gapPx;
    }
    y += h + gapPx;
  }
  return rects;
}

/** Hero takes half the usable span on the wider side; a 2x2 group fills the other half. */
function heroFour(canvas: CanvasSize, gapPx: number): Rect[] {
  const landscape = canvas.w > canvas.h;
  const [heroSpan, restSpan] = splitEven((landscape ? canvas.w : canvas.h) - gapPx, 2);
  if (landscape) {
    const group = { x: heroSpan + gapPx, y: 0, w: restSpan, h: canvas.h };
    return [{ x: 0, y: 0, w: heroSpan, h: canvas.h }, ...equalGrid(group, 2, 2, gapPx)];
  }
  const group = { x: 0, y: heroSpan + gapPx, w: canvas.w, h: restSpan };
  return [{ x: 0, y: 0, w: canvas.w, h: heroSpan }, ...equalGrid(group, 2, 2, gapPx)];
}

function curatedRects(
  canvas: CanvasSize,
  template: "grid-2x2" | "grid-3x3" | "hero-4",
  gapPx: number,
): Rect[] {
  const whole = { x: 0, y: 0, w: canvas.w, h: canvas.h };
  if (template === "grid-2x2") return equalGrid(whole, 2, 2, gapPx);
  if (template === "grid-3x3") return equalGrid(whole, 3, 3, gapPx);
  return heroFour(canvas, gapPx);
}

/**
 * Slots for a curated or rectangular template. Curated templates require their exact
 * image count; `rectangular` accepts any count >= 1 and never emits empty cells.
 * @param canvas output size in px
 * @param gapPx gap between cells in px
 */
export function generateTemplateSlots(
  canvas: CanvasSize,
  imageCount: number,
  template: CollageTemplateId,
  gapPx: number,
): Slot[] {
  if (template === "rectangular") {
    return layoutRows(canvas, imageCount, gapPx, (_start, size, usableW) =>
      splitEven(usableW, size),
    );
  }
  const required = TEMPLATE_IMAGE_COUNTS[template];
  if (imageCount !== required) {
    throw new RangeError(`${template} requires exactly ${required} images`);
  }
  return curatedRects(canvas, template, gapPx).map((rect, i) => ({
    id: i,
    ...rect,
    order: i,
    hero: template === "hero-4" && i === 0,
  }));
}

import type { CollageTemplateSpec } from "@/lib/schemas/collage";
import type { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";
import { apportionWidths, layoutRows, splitEven } from "./justifiedRows";
import type { CanvasSize, Slot } from "./types";

/** Track start offsets and sizes in px for `weights` spread over `totalPx` with gaps. */
function tracks(totalPx: number, weights: readonly number[], gapPx: number) {
  const sizes = apportionWidths(totalPx - gapPx * (weights.length - 1), weights);
  const starts: number[] = [];
  let at = 0;
  for (const size of sizes) {
    starts.push(at);
    at += size + gapPx;
  }
  return { sizes, starts };
}

function spanPx(t: { sizes: number[] }, start: number, count: number, gapPx: number): number {
  const sum = t.sizes.slice(start, start + count).reduce((a, b) => a + b, 0);
  return sum + gapPx * (count - 1);
}

/**
 * Slots for a weighted-grid template, one per cell in reading order.
 * @param canvas output size in px
 * @param gapPx gap between tracks in px
 */
export function generateDefinitionSlots(
  canvas: CanvasSize,
  template: CollageTemplateDefinition,
  gapPx: number,
): Slot[] {
  const cols = tracks(canvas.w, template.cols, gapPx);
  const rows = tracks(canvas.h, template.rows, gapPx);
  return template.cells.map((cell, i) => ({
    id: i,
    x: cols.starts[cell.col],
    y: rows.starts[cell.row],
    w: spanPx(cols, cell.col, cell.colSpan, gapPx),
    h: spanPx(rows, cell.row, cell.rowSpan, gapPx),
    order: i,
    hero: cell.hero,
  }));
}

/**
 * Slots for a template. Definitions require exactly one image per cell; `rectangular`
 * accepts any count >= 1 and never emits empty cells.
 * @param canvas output size in px
 * @param gapPx gap between cells in px
 */
export function generateTemplateSlots(
  canvas: CanvasSize,
  imageCount: number,
  template: CollageTemplateSpec,
  gapPx: number,
): Slot[] {
  if (template === "rectangular") {
    return layoutRows(canvas, imageCount, gapPx, (_start, size, usableW) =>
      splitEven(usableW, size),
    );
  }
  if (imageCount !== template.cells.length) {
    throw new RangeError(`${template.id} requires exactly ${template.cells.length} images`);
  }
  return generateDefinitionSlots(canvas, template, gapPx);
}

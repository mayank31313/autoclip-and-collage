import type { CanvasSize, ImageStats, Slot } from "./types";

/** Fixed-point scale so aspect-ratio apportioning uses exact integer arithmetic. */
const ASPECT_SCALE = 1_000_000;

/**
 * Splits `total` px into `parts` positive integers as evenly as possible, giving the
 * remainder to earlier parts. Throws when the parts cannot all be at least 1 px.
 */
export function splitEven(total: number, parts: number): number[] {
  if (!Number.isInteger(total) || total < parts) {
    throw new RangeError(`cannot split ${total}px into ${parts} positive cells`);
  }
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Number of rows for `count` cells on `canvas`, clamped to [1, count]. */
export function rowCountFor(canvas: CanvasSize, count: number): number {
  const rows = Math.round(Math.sqrt(count / (canvas.w / canvas.h)));
  return Math.min(Math.max(rows, 1), count);
}

/** Cell widths summing to `usableW`, each >= 1 px, proportional to `weights`. */
function apportionWidths(usableW: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const spare = usableW - n;
  if (spare < 0) throw new RangeError(`cannot fit ${n} cells in ${usableW}px`);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const widths = weights.map((w) => 1 + Math.floor((spare * w) / total));
  let remainder = usableW - widths.reduce((sum, w) => sum + w, 0);
  for (let i = 0; remainder > 0; i++, remainder--) widths[i] += 1;
  return widths;
}

/**
 * Lays out contiguous equal-height rows in upload order (earlier rows get the extra
 * cells). `rowWidths` returns the cell widths for a row given its usable width
 * (canvas width minus gaps).
 */
export function layoutRows(
  canvas: CanvasSize,
  count: number,
  gapPx: number,
  rowWidths: (start: number, size: number, usableW: number) => number[],
): Slot[] {
  if (count < 1) throw new RangeError("at least one image is required");
  const sizes = splitEven(count, rowCountFor(canvas, count));
  const heights = splitEven(canvas.h - gapPx * (sizes.length - 1), sizes.length);
  const slots: Slot[] = [];
  let y = 0;
  let start = 0;
  for (const [r, size] of sizes.entries()) {
    const widths = rowWidths(start, size, canvas.w - gapPx * (size - 1));
    let x = 0;
    for (const [c, w] of widths.entries()) {
      const id = start + c;
      slots.push({ id, x, y, w, h: heights[r], order: id, hero: false });
      x += w + gapPx;
    }
    y += heights[r] + gapPx;
    start += size;
  }
  return slots;
}

/**
 * Equal-height rows whose cell widths follow source aspect ratios; each row fills the
 * canvas width exactly (rounding remainder goes to cells left-to-right).
 * @param canvas output size in px
 * @param gapPx gap between cells and rows in px
 */
export function generateJustifiedSlots(
  canvas: CanvasSize,
  images: readonly ImageStats[],
  gapPx: number,
): Slot[] {
  const weights = images.map((img) =>
    Math.max(1, Math.round((ASPECT_SCALE * img.widthPx) / img.heightPx)),
  );
  return layoutRows(canvas, images.length, gapPx, (start, size, usableW) =>
    apportionWidths(usableW, weights.slice(start, start + size)),
  );
}

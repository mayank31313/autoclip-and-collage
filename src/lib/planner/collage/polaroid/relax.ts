import { POLAROID_MAX_OVERLAP_RATIO } from "./defaults";
import { overlapRatio, rotatedBounds } from "./geometry";

/** Keeps a margin under the validator's limit so integer rounding cannot tip a pair over it. */
const RELAX_TARGET_RATIO = POLAROID_MAX_OVERLAP_RATIO * 0.95;
const SHRINK_FACTOR = 0.94;
const MIN_RELAXED_WIDTH_PX = 100;
const MAX_PASSES = 60;

interface Sized {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
}

function shrinkAboutCentre<T extends Sized>(item: T): T {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const w = Math.max(MIN_RELAXED_WIDTH_PX, Math.floor(item.w * SHRINK_FACTOR));
  // Keep the frame's own proportions so the photo window still matches its photo.
  const h = Math.round((w * item.h) / item.w);
  return { ...item, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
}

/**
 * Shrinks the larger frame of any pair that overlaps too much, about its own centre, until every
 * pair is within the limit. Needed where neighbouring slides differ in count or size. Frames only
 * ever shrink, so bounds and slide membership of their centres are preserved. Lengths are px.
 */
export function relaxOverlaps<T extends Sized>(items: readonly T[]): T[] {
  const out = [...items];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (!a || !b) continue;
        if (overlapRatio(rotatedBounds(a), rotatedBounds(b)) <= RELAX_TARGET_RATIO) continue;
        const shrinkA = a.w * a.h >= b.w * b.h;
        const target = shrinkA ? a : b;
        if (target.w <= MIN_RELAXED_WIDTH_PX) continue;
        out[shrinkA ? i : j] = shrinkAboutCentre(target);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

import type { Cell } from "@/lib/schemas/layout";
import { ASPECT_LOG_SPAN, ASSIGNMENT_WEIGHTS, DEFAULT_FOCUS, TIE_BREAK_EPSILON } from "./defaults";
import type { ImageStats, Slot } from "./grid/types";
import { solveAssignment } from "./hungarian";

/**
 * Fraction of the image area removed when cover-scaling it into a slot.
 * @param imageAspect image width / height (norm)
 * @param slotAspect slot width / height (norm)
 */
export function coverCropFraction(imageAspect: number, slotAspect: number): number {
  return 1 - Math.min(imageAspect, slotAspect) / Math.max(imageAspect, slotAspect);
}

function pairCost(image: ImageStats, slot: Slot, maxPixels: number): number {
  const imageAspect = image.widthPx / image.heightPx;
  const slotAspect = slot.w / slot.h;
  const aspect = Math.abs(Math.log(imageAspect / slotAspect)) / ASPECT_LOG_SPAN;
  const heroResolution = slot.hero ? 1 - image.pixelCount / maxPixels : 0;
  return (
    ASSIGNMENT_WEIGHTS.aspect * aspect +
    ASSIGNMENT_WEIGHTS.cropLoss * coverCropFraction(imageAspect, slotAspect) +
    ASSIGNMENT_WEIGHTS.heroResolution * heroResolution
  );
}

function assertUsable(images: readonly ImageStats[], slots: readonly Slot[]): void {
  if (images.length > slots.length) {
    throw new RangeError(`cannot place ${images.length} images in ${slots.length} slots`);
  }
  for (const { assetId, widthPx, heightPx, pixelCount } of images) {
    if (!(widthPx > 0 && heightPx > 0 && pixelCount > 0)) {
      throw new RangeError(`image ${assetId} has non-positive dimensions`);
    }
  }
}

/**
 * Assigns each image to exactly one slot, minimizing aspect mismatch, cover-crop loss and
 * (for hero slots) lost resolution. Pure and deterministic; upload order (the order of
 * `images`) breaks exact ties. Cells are returned in `slots` order and keep each slot's
 * `order`; slots left over when there are fewer images than slots stay empty.
 */
export function assignImagesToSlots(images: readonly ImageStats[], slots: readonly Slot[]): Cell[] {
  assertUsable(images, slots);
  const maxPixels = Math.max(1, ...images.map((image) => image.pixelCount));
  const costs = images.map((image, i) =>
    slots.map((slot, s) => pairCost(image, slot, maxPixels) + TIE_BREAK_EPSILON * Math.abs(i - s)),
  );
  const imageOfSlot = new Map<number, string>();
  for (const { row, column } of solveAssignment(costs)) {
    imageOfSlot.set(column, images[row].assetId);
  }
  return slots.map((slot, s) => ({
    id: slot.id,
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    image: imageOfSlot.get(s) ?? null,
    focus: [DEFAULT_FOCUS[0], DEFAULT_FOCUS[1]],
    order: slot.order,
    pinned: false,
  }));
}

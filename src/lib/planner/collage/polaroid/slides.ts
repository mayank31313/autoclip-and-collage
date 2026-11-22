import {
  POLAROID_IMAGES_PER_SLIDE_DEFAULT,
  POLAROID_MAX_IMAGES_PER_SLIDE,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "./defaults";

/** Slide count used when the caller does not choose one; about three images per slide. */
export function defaultSlideCount(imageCount: number): number {
  const wanted = Math.ceil(imageCount / POLAROID_IMAGES_PER_SLIDE_DEFAULT);
  return Math.min(POLAROID_MAX_SLIDES, Math.max(POLAROID_MIN_SLIDES, wanted));
}

/** Returns why `imageCount` images cannot fill `slideCount` slides, or null when they can. */
export function slideCountProblem(imageCount: number, slideCount: number): string | null {
  if (imageCount < slideCount) {
    return `${slideCount} slides need at least ${slideCount} images`;
  }
  const capacity = slideCount * POLAROID_MAX_IMAGES_PER_SLIDE;
  if (imageCount > capacity) {
    return `${slideCount} slides hold at most ${capacity} images`;
  }
  return null;
}

/** Splits images across slides as evenly as possible; earlier slides take the remainder. */
export function evenSlideCounts(imageCount: number, slideCount: number): number[] {
  const base = Math.floor(imageCount / slideCount);
  const extra = imageCount % slideCount;
  return Array.from({ length: slideCount }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Returns why per-slide image counts are unusable, or null when they are consistent. */
export function imagesPerSlideProblem(
  imageCount: number,
  slideCount: number,
  counts: readonly number[],
): string | null {
  if (counts.length !== slideCount) return `send one image count per slide (${slideCount})`;
  const valid = counts.every(
    (n) => Number.isInteger(n) && n >= 1 && n <= POLAROID_MAX_IMAGES_PER_SLIDE,
  );
  if (!valid) return `each slide holds 1 to ${POLAROID_MAX_IMAGES_PER_SLIDE} images`;
  const total = counts.reduce((sum, n) => sum + n, 0);
  return total === imageCount
    ? null
    : `slide counts add up to ${total} but there are ${imageCount} images`;
}

/** Returns why per-slide sizes are unusable, or null. */
export function slideSizesProblem(slideCount: number, sizes: readonly unknown[]): string | null {
  return sizes.length === slideCount ? null : `send one size per slide (${slideCount})`;
}

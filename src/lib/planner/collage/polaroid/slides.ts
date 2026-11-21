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

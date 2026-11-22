import {
  POLAROID_MAX_PHOTO_ASPECT,
  POLAROID_MIN_PHOTO_ASPECT,
  POLAROID_SIDE_FRACTION,
  POLAROID_STRIP_FRACTION,
} from "./defaults";

/** Photo window aspect (width / height) for a photo; square when the aspect is unknown. */
export function windowAspect(photoAspect: number | undefined): number {
  if (photoAspect === undefined || !Number.isFinite(photoAspect) || photoAspect <= 0) return 1;
  return Math.min(POLAROID_MAX_PHOTO_ASPECT, Math.max(POLAROID_MIN_PHOTO_ASPECT, photoAspect));
}

/** Frame height, in px, of a frame `w` px wide whose photo window has aspect `aspect`. */
export function frameHeight(w: number, aspect: number): number {
  const side = Math.round(w * POLAROID_SIDE_FRACTION);
  const photoH = Math.round((w - 2 * side) / aspect);
  return side + photoH + Math.round(w * POLAROID_STRIP_FRACTION);
}

/** Splits a frame into its border and photo window sizes, in px. Shared by planner and renderer. */
export function framePieces(w: number, h: number) {
  const side = Math.round(w * POLAROID_SIDE_FRACTION);
  const strip = Math.round(w * POLAROID_STRIP_FRACTION);
  return { side, strip, photoW: w - 2 * side, photoH: h - side - strip };
}

/** Weights for the image-to-slot cost; costs are unitless and only compared to each other. */
export const ASSIGNMENT_WEIGHTS = {
  aspect: 1,
  cropLoss: 1,
  heroResolution: 1,
} as const;

/** |ln(aspect ratio)| that maps to a normalized aspect cost of 1 (a 4:1 mismatch). */
export const ASPECT_LOG_SPAN = Math.log(4);

/**
 * Per-step index-distance cost used only to break exact ties toward upload order. It is
 * far smaller than any meaningful cost difference.
 */
export const TIE_BREAK_EPSILON = 1e-9;

/** Default focus point (normalized 0..1, center) until focus analysis exists. */
export const DEFAULT_FOCUS: readonly [number, number] = [0.5, 0.5];

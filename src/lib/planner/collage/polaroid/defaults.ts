/** Shared limits and layout constants for polaroid carousels. All lengths are canvas px. */
export const POLAROID_SLIDE_WIDTH_PX = 1080;
export const POLAROID_SLIDE_HEIGHT_PX = { "4:5": 1350, "1:1": 1080 } as const;
export const POLAROID_MIN_SLIDES = 2;
export const POLAROID_MAX_SLIDES = 10;
export const POLAROID_IMAGES_PER_SLIDE_DEFAULT = 3;
export const POLAROID_MAX_IMAGES_PER_SLIDE = 6;
export const POLAROID_MAX_CAPTION_CHARS = 60;

export const POLAROID_SLIDE_SIZES = ["small", "medium", "large"] as const;
export type PolaroidSlideSize = (typeof POLAROID_SLIDE_SIZES)[number];
export const DEFAULT_POLAROID_SLIDE_SIZE: PolaroidSlideSize = "large";
/** Polaroid width multiplier per slide size; `large` is the full fit for the slide's photo count. */
export const POLAROID_SLIDE_SIZE_SCALE: Record<PolaroidSlideSize, number> = {
  small: 0.7,
  medium: 0.85,
  large: 1,
};

/** Torn sheet is inset from the spread edge so the diary page shows around it. */
export const SHEET_INSET_PX = 80;
export const TEAR_AMPLITUDE_PX = 12;
export const TEAR_STEP_PX = 14;
/** Extra clearance between the sheet edge and the polaroids' rotated bounds. */
export const CONTENT_PAD_PX = 28;
export const CONTENT_MARGIN_PX = SHEET_INSET_PX + CONTENT_PAD_PX;

export const PAGE_RULE_STEP_PX = 44;
export const PAGE_HOLE_PITCH_PX = 90;
export const PAGE_HOLE_Y_PX = 40;
export const PAGE_HOLE_RADIUS_PX = 9;

/** Polaroid frame height as a multiple of its width (square photo plus thick bottom strip). */
export const POLAROID_FRAME_RATIO = 1.22;
/** Frame border widths as fractions of the frame width. The photo window is what remains. */
export const POLAROID_SIDE_FRACTION = 0.065;
export const POLAROID_STRIP_FRACTION = 0.285;
/** The photo window follows the photo's width/height within this range; beyond it the photo is fitted, never cropped. */
export const POLAROID_MIN_PHOTO_ASPECT = 0.5;
export const POLAROID_MAX_PHOTO_ASPECT = 2;
export const POLAROID_MAX_WIDTH_PX = 540;
export const POLAROID_MIN_WIDTH_PX = 220;
/** Largest frame height as a fraction of the usable sheet height. */
export const POLAROID_MAX_HEIGHT_FRACTION = 0.62;
export const POLAROID_MAX_ROTATION_DEG = 6;
export const POLAROID_ROW_FILL = 0.92;
/** Largest allowed overlap of two rotated bounds, as a fraction of the smaller one's area. */
export const POLAROID_MAX_OVERLAP_RATIO = 0.4;
export const POLAROID_TAPE_VARIANTS = ["top", "left", "right"] as const;

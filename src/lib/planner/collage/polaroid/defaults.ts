/** Shared limits and layout constants for polaroid carousels. All lengths are canvas px. */
export const POLAROID_SLIDE_WIDTH_PX = 1080;
export const POLAROID_SLIDE_HEIGHT_PX = { "4:5": 1350, "1:1": 1080 } as const;
export const POLAROID_MIN_SLIDES = 2;
export const POLAROID_MAX_SLIDES = 10;
export const POLAROID_IMAGES_PER_SLIDE_DEFAULT = 3;
export const POLAROID_MAX_IMAGES_PER_SLIDE = 6;
export const POLAROID_MAX_CAPTION_CHARS = 60;

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
export const POLAROID_MAX_WIDTH_PX = 432;
export const POLAROID_MIN_WIDTH_PX = 220;
export const POLAROID_SMALL_SCALE = 0.82;
export const POLAROID_MAX_ROTATION_DEG = 6;
export const POLAROID_ROW_FILL = 0.92;
export const POLAROID_JITTER_X_FRACTION = 0.1;
export const POLAROID_JITTER_Y_FRACTION = 0.04;
export const POLAROID_BAND_CENTERS = [0.27, 0.73] as const;
/** Largest allowed overlap of two rotated bounds, as a fraction of the smaller one's area. */
export const POLAROID_MAX_OVERLAP_RATIO = 0.4;
export const POLAROID_TAPE_VARIANTS = ["top", "left", "right"] as const;

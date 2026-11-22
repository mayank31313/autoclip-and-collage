export const SLIDESHOW_CANVAS_SIZE = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const;

export const SLIDESHOW_MAX_SLIDES = 20;
export const SLIDESHOW_MAX_SLIDE_SEC = 30;
export const SLIDESHOW_MAX_DURATION_SEC = 300;
export const SLIDESHOW_MAX_TRANSITION_SEC = 2;
/** Minimum seconds a still image may be shown for in a slideshow (route, schema, and client all share this). */
export const SLIDESHOW_MIN_IMAGE_DURATION_SEC = 1;

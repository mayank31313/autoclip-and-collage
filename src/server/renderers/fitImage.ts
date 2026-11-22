import sharp from "sharp";

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** Aspect mismatch below this is rounding noise; stretching by it is invisible, a gap would show. */
const ASPECT_TOLERANCE = 0.015;
const SWAPPED_ORIENTATIONS = new Set([5, 6, 7, 8]);

async function displayedAspect(sourcePath: string): Promise<number | null> {
  const meta = await sharp(sourcePath).metadata();
  const width = meta.width;
  const height = meta.pageHeight ?? meta.height;
  if (!width || !height) return null;
  return SWAPPED_ORIENTATIONS.has(meta.orientation ?? 1) ? height / width : width / height;
}

/**
 * EXIF-rotates the image and fits all of it into a `w` x `h` box, never cropping. Leftover space is
 * transparent so whatever sits underneath shows through. When the aspects match within rounding
 * the image fills the box exactly.
 */
export async function renderFitted(sourcePath: string, w: number, h: number): Promise<Buffer> {
  const aspect = await displayedAspect(sourcePath);
  const matches = aspect !== null && Math.abs(aspect / (w / h) - 1) <= ASPECT_TOLERANCE;
  return sharp(sourcePath)
    .rotate()
    .resize({
      width: w,
      height: h,
      fit: matches ? "fill" : "contain",
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();
}

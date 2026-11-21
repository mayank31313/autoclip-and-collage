import sharp from "sharp";
import type { ImageStats } from "@/lib/planner/collage/grid/types";
import { AppError } from "@/server/http/errors";

const BASE_MIME_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);
const SHARP_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp"]);
const HEIC_MIME_TYPES: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);
const HEIC_SUFFIXES = [".heic", ".heif"];
const FIRST_AXIS_SWAPPING_ORIENTATION = 5;

/**
 * Prebuilt sharp ships libheif with AVIF only (no HEVC): its heif format lists just `.avif`.
 * HEIC counts as supported only when the build advertises HEIC input and buffer output.
 */
function heicSupported(): boolean {
  const { heif } = sharp.format;
  const hasSuffix = HEIC_SUFFIXES.some((s) => heif.input.fileSuffix?.includes(s) === true);
  return hasSuffix && heif.input.buffer && heif.output.buffer;
}

/** True when the installed sharp build can decode inputs of this MIME type. */
export function isSupportedImageMime(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return BASE_MIME_TYPES.has(type) || (HEIC_MIME_TYPES.has(type) && heicSupported());
}

function invalid(message: string): AppError {
  return new AppError("VALIDATION_FAILED", 400, message);
}

/**
 * Fully decodes the image once (bounded by `maxPixels`) and returns its EXIF-oriented size.
 * Errors never include file paths or decoder internals.
 */
export async function inspectImage(
  path: string,
  assetId: string,
  maxPixels: number,
): Promise<ImageStats> {
  try {
    const input = sharp(path, { limitInputPixels: maxPixels });
    const meta = await input.metadata();
    if (meta.format === undefined || !SHARP_FORMATS.has(meta.format)) {
      throw invalid("Unsupported image format");
    }
    const rawWidth = meta.width;
    const rawHeight = meta.pageHeight ?? meta.height;
    if (rawWidth === undefined || rawHeight === undefined || rawWidth < 1 || rawHeight < 1) {
      throw invalid("Image dimensions are unavailable");
    }
    if (rawWidth * rawHeight > maxPixels) throw invalid("Image exceeds the pixel limit");
    await input.stats();
    const swap = (meta.orientation ?? 1) >= FIRST_AXIS_SWAPPING_ORIENTATION;
    const widthPx = swap ? rawHeight : rawWidth;
    const heightPx = swap ? rawWidth : rawHeight;
    return { assetId, widthPx, heightPx, pixelCount: widthPx * heightPx };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid("Image is corrupt or exceeds the pixel limit");
  }
}

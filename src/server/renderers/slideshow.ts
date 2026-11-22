import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SlideshowSpec } from "@/lib/schemas/slideshow";
import { escapeConcatListPath, runFfmpeg } from "./ffmpeg";

const FFMPEG_TIMEOUT_MS = 120_000;
const XFADE_TYPE: Record<"fade" | "wipe", string> = { fade: "fade", wipe: "wipeleft" };

export interface SlideFilterArgs {
  w: number;
  h: number;
  fit: "cover" | "contain";
}

/**
 * Normalizes any source frame to the canvas size: `cover` fills the canvas and crops the
 * overflow, `contain` letterboxes onto the canvas. All values are already-validated integers
 * from the spec, never user text, so no filtergraph escaping is required here.
 */
export function buildSlideFilter(args: SlideFilterArgs): string {
  const { w, h, fit } = args;
  return fit === "cover"
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

export interface NormalizeImageSlideArgs extends SlideFilterArgs {
  imagePath: string;
  outputPath: string;
  fps: 24 | 30;
  durationSec: number;
}

/**
 * Renders a still image into a fixed-duration, video-only MP4 clip. `-an` keeps every normalized
 * slide audio-free so later concat/xfade steps never need to reconcile mismatched audio streams.
 */
export async function normalizeImageSlide(args: NormalizeImageSlideArgs): Promise<void> {
  const filter = buildSlideFilter(args);
  await runFfmpeg(
    [
      "-loop",
      "1",
      "-framerate",
      String(args.fps),
      "-i",
      args.imagePath,
      "-vf",
      filter,
      "-an",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-t",
      String(args.durationSec),
      args.outputPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
}

export interface NormalizeVideoSlideArgs extends SlideFilterArgs {
  videoPath: string;
  outputPath: string;
  fps: 24 | 30;
  startSec: number;
  durationSec: number;
}

/** Trims and normalizes a video source to the canvas size, frame rate, and a fixed duration. */
export async function normalizeVideoSlide(args: NormalizeVideoSlideArgs): Promise<void> {
  const filter = `${buildSlideFilter(args)},fps=${args.fps}`;
  await runFfmpeg(
    [
      "-ss",
      String(args.startSec),
      "-i",
      args.videoPath,
      "-t",
      String(args.durationSec),
      "-vf",
      filter,
      "-map",
      "0:v:0",
      "-an",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      args.outputPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
}

export interface NormalizeSlideshowSourceArgs extends SlideFilterArgs {
  sourcePath: string;
  outputPath: string;
  kind: "image" | "video";
  fps: 24 | 30;
  startSec: number;
  durationSec: number;
}

/** Dispatches to the image or video normalizer by source kind and returns the written path. */
export async function normalizeSlideshowSource(
  args: NormalizeSlideshowSourceArgs,
): Promise<string> {
  const { sourcePath, outputPath, kind, w, h, fit, fps, startSec, durationSec } = args;
  if (kind === "image") {
    await normalizeImageSlide({ imagePath: sourcePath, outputPath, w, h, fit, fps, durationSec });
  } else {
    await normalizeVideoSlide({
      videoPath: sourcePath,
      outputPath,
      w,
      h,
      fit,
      fps,
      startSec,
      durationSec,
    });
  }
  return outputPath;
}

export interface RenderPerSlideArgs {
  spec: SlideshowSpec;
  sourcePaths: ReadonlyMap<string, string>;
  dir: string;
}

/**
 * Normalizes every slide in spec order. Returns one output path per slide, in the same order as
 * `spec.slides` (which mirrors the worker input's source order), so callers can zip the result
 * 1:1 with source asset IDs.
 */
export async function renderPerSlideVideos(args: RenderPerSlideArgs): Promise<string[]> {
  const { spec, sourcePaths, dir } = args;
  const outputs: string[] = [];
  for (const slide of spec.slides) {
    const sourcePath = sourcePaths.get(slide.assetId);
    if (sourcePath === undefined) {
      throw new Error(`Missing source file for slide ${slide.id}`);
    }
    const outputPath = path.join(dir, `slide-${String(slide.id).padStart(2, "0")}.mp4`);
    await normalizeSlideshowSource({
      sourcePath,
      outputPath,
      kind: slide.kind,
      w: spec.canvas.w,
      h: spec.canvas.h,
      fit: slide.fit,
      fps: spec.fps,
      startSec: slide.startSec,
      durationSec: slide.durationSec,
    });
    outputs.push(outputPath);
  }
  return outputs;
}

async function concatSlides(slidePaths: readonly string[], outputPath: string): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const lines = slidePaths.map((file) => `file '${escapeConcatListPath(path.resolve(file))}'`);
  await writeFile(listPath, lines.join("\n"));
  // All normalized slides share codec/pix_fmt/fps, so a stream copy is safe and avoids a re-encode.
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], {
    timeoutMs: FFMPEG_TIMEOUT_MS,
  });
}

/**
 * Chains slides with `xfade` crossfades. Inputs are referenced only by their `-i` index inside
 * the filtergraph (never by file path), and transition type/duration/offsets are all numbers or
 * a fixed enum, so nothing user-controlled is interpolated into the filter string.
 */
async function xfadeSlides(
  slidePaths: readonly string[],
  spec: SlideshowSpec,
  outputPath: string,
): Promise<void> {
  const transitionSec = spec.transition.durationSec;
  const xfadeType = XFADE_TYPE[spec.transition.type as "fade" | "wipe"];
  const durations = spec.slides.map((slide) => slide.durationSec);
  let total = durations[0] ?? 0;
  let prevLabel = "[0:v]";
  const parts: string[] = [];
  for (let i = 1; i < slidePaths.length; i++) {
    const offset = total - transitionSec;
    const label = i === slidePaths.length - 1 ? "[v]" : `[v${i}]`;
    parts.push(
      `${prevLabel}[${i}:v]xfade=transition=${xfadeType}:duration=${transitionSec}:offset=${offset}${label}`,
    );
    total = total + (durations[i] ?? 0) - transitionSec;
    prevLabel = label;
  }
  const inputs = slidePaths.flatMap((file) => ["-i", file]);
  await runFfmpeg(
    [
      ...inputs,
      "-filter_complex",
      parts.join(";"),
      "-map",
      "[v]",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      outputPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
}

export interface RenderMasterArgs {
  slidePaths: readonly string[];
  spec: SlideshowSpec;
  outputPath: string;
}

/** Renders the final master: a direct concat for `cut`, or `xfade` crossfades otherwise. */
export async function renderSlideshowMaster(args: RenderMasterArgs): Promise<void> {
  const { slidePaths, spec, outputPath } = args;
  if (spec.transition.type === "cut" || slidePaths.length === 1) {
    await concatSlides(slidePaths, outputPath);
    return;
  }
  await xfadeSlides(slidePaths, spec, outputPath);
}

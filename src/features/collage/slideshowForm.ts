import { z } from "zod";
import { CreateCollageBody } from "@/lib/schemas/api";
import { SlideshowCanvas, SlideshowFit } from "@/lib/schemas/slideshow";
import { SLIDESHOW_MIN_IMAGE_DURATION_SEC } from "@/lib/planner/slideshow/defaults";

export type SlideshowSourceKind = "image" | "video";
export type SlideshowFitValue = z.infer<typeof SlideshowFit>;
export type SlideshowCanvasValue = z.infer<typeof SlideshowCanvas>;
export type SlideshowTransitionValue = "cut" | "fade" | "wipe";
export type SlideshowFpsValue = 24 | 30;

export const SLIDESHOW_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SLIDESHOW_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
] as const;
/** Accepted MIME types for a slideshow source: still images or video clips. */
export const SLIDESHOW_TYPES = [...SLIDESHOW_IMAGE_TYPES, ...SLIDESHOW_VIDEO_TYPES] as const;

export const DEFAULT_IMAGE_DURATION_SEC = 3;

const IMAGE_EXTENSION_BY_TYPE: Record<string, RegExp> = {
  "image/jpeg": /\.jpe?g$/i,
  "image/png": /\.png$/i,
  "image/webp": /\.webp$/i,
};
const VIDEO_EXTENSION_BY_TYPE: Record<string, RegExp> = {
  "video/mp4": /\.mp4$/i,
  "video/quicktime": /\.mov$/i,
  "video/webm": /\.webm$/i,
  "video/x-matroska": /\.mkv$/i,
};

export const SLIDESHOW_CANVAS_OPTIONS: ReadonlyArray<{
  id: SlideshowCanvasValue;
  label: string;
}> = [
  { id: "16:9", label: "Widescreen 16:9" },
  { id: "9:16", label: "Portrait 9:16" },
  { id: "1:1", label: "Square 1:1" },
];

export const SLIDESHOW_FPS_OPTIONS: readonly SlideshowFpsValue[] = [24, 30];

export const SLIDESHOW_TRANSITION_OPTIONS: ReadonlyArray<{
  id: SlideshowTransitionValue;
  label: string;
}> = [
  { id: "cut", label: "Cut" },
  { id: "fade", label: "Fade" },
  { id: "wipe", label: "Wipe" },
];

export const SLIDESHOW_FIT_OPTIONS: ReadonlyArray<{ id: SlideshowFitValue; label: string }> = [
  { id: "cover", label: "Cover" },
  { id: "contain", label: "Contain" },
];

/** `image` for image/* MIME types, `video` for video/* MIME types, or null when unsupported. */
export function slideshowKindOf(file: File): SlideshowSourceKind | null {
  if ((SLIDESHOW_IMAGE_TYPES as readonly string[]).includes(file.type)) return "image";
  if ((SLIDESHOW_VIDEO_TYPES as readonly string[]).includes(file.type)) return "video";
  return null;
}

/** A single slide/source as edited in the form; NaN fields mean "unset" until filled in. */
export interface SlideshowSourceDraft {
  kind: SlideshowSourceKind;
  /** Seconds a still image is shown; unused for video sources. */
  durationSec: number;
  /** Trim start/end in seconds; both NaN means "use the full clip" for a video source. */
  startSec: number;
  endSec: number;
  fit: SlideshowFitValue;
}

export function defaultSourceDraft(kind: SlideshowSourceKind): SlideshowSourceDraft {
  return {
    kind,
    durationSec: kind === "image" ? DEFAULT_IMAGE_DURATION_SEC : Number.NaN,
    startSec: Number.NaN,
    endSec: Number.NaN,
    fit: "cover",
  };
}

/** The per-source shape sent to the API: only the fields relevant to `kind` are included. */
export type SlideshowSourceInput =
  | { kind: "image"; durationSec: number; fit: SlideshowFitValue }
  | { kind: "video"; startSec?: number; endSec?: number; fit: SlideshowFitValue };

/** Drops unset (NaN) fields so the request matches the discriminated API shape. */
export function toSourceInput(draft: SlideshowSourceDraft): SlideshowSourceInput {
  if (draft.kind === "image") {
    return { kind: "image", durationSec: draft.durationSec, fit: draft.fit };
  }
  const hasTrim = Number.isFinite(draft.startSec) && Number.isFinite(draft.endSec);
  return hasTrim
    ? { kind: "video", startSec: draft.startSec, endSec: draft.endSec, fit: draft.fit }
    : { kind: "video", fit: draft.fit };
}

export interface SlideshowFormValues {
  canvas: SlideshowCanvasValue;
  fps: SlideshowFpsValue;
  transition: SlideshowTransitionValue;
  transitionSec: number;
  sources: SlideshowSourceInput[];
}

/** Builds the slideshow API request from form values and the uploaded object keys. */
export function buildSlideshowBody(values: SlideshowFormValues, keys: string[]): CreateCollageBody {
  return CreateCollageBody.parse({
    mode: "slideshow",
    sources: values.sources.map((source, i) => ({ key: keys[i], ...source })),
    slideshow: {
      canvas: values.canvas,
      fps: values.fps,
      transition: values.transition,
      // "cut" always submits a zero transitionSec: the UI hides the field for "cut", but a
      // stale non-zero value (left over from switching away from fade/wipe) must never reach
      // the server's `.refine()` as a raw, unfriendly Zod error.
      transitionSec: values.transition === "cut" ? 0 : values.transitionSec,
    },
    format: "mp4",
  });
}

export interface FormProblem {
  path: (string | number)[];
  message: string;
}

function sourceDraftProblems(draft: SlideshowSourceDraft, index: number): FormProblem[] {
  if (draft.kind === "image") {
    if (
      !Number.isFinite(draft.durationSec) ||
      draft.durationSec < SLIDESHOW_MIN_IMAGE_DURATION_SEC
    ) {
      return [
        {
          path: ["slideshowSources", index, "durationSec"],
          message: `Enter at least ${SLIDESHOW_MIN_IMAGE_DURATION_SEC} second(s) to show this image`,
        },
      ];
    }
    return [];
  }
  const hasStart = Number.isFinite(draft.startSec);
  const hasEnd = Number.isFinite(draft.endSec);
  if (hasStart !== hasEnd) {
    return [
      {
        path: ["slideshowSources", index, hasStart ? "endSec" : "startSec"],
        message: "Enter both a start and end time, or leave both empty",
      },
    ];
  }
  if (hasStart && hasEnd && draft.endSec <= draft.startSec) {
    return [{ path: ["slideshowSources", index, "endSec"], message: "End must be after start" }];
  }
  return [];
}

/** Client-side mirror of the server's slideshow checks: file count, kind, and per-source fields. */
export function slideshowProblems(
  files: File[],
  sources: SlideshowSourceDraft[],
  maxSources: number,
): FormProblem[] {
  const problems: FormProblem[] = [];
  if (files.length > maxSources) {
    problems.push({
      path: ["files"],
      message: `Select at most ${maxSources} files`,
    });
  }
  files.forEach((file, i) => {
    const kind = slideshowKindOf(file);
    if (!kind) {
      problems.push({
        path: ["files", i],
        message: `${file.name}: only JPEG, PNG, WebP images or MP4, MOV, WebM, MKV videos are supported`,
      });
      return;
    }
    const byType = kind === "image" ? IMAGE_EXTENSION_BY_TYPE : VIDEO_EXTENSION_BY_TYPE;
    if (byType[file.type]?.test(file.name) === false) {
      problems.push({
        path: ["files", i],
        message: `${file.name}: file extension does not match its type`,
      });
    }
    const draft = sources[i];
    if (draft) problems.push(...sourceDraftProblems(draft, i));
  });
  return problems;
}

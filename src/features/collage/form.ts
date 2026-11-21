import { z } from "zod";
import type { CollageLimits } from "@/features/collage/limits";
import { CreateCollageBody } from "@/lib/schemas/api";
import {
  CollageFormat,
  CollageStyle,
  CollageTemplateId,
  TEMPLATE_IMAGE_COUNTS,
  checkStyleTemplate,
} from "@/lib/schemas/collage";

export const CUSTOM_PRESET = "custom";

export const CANVAS_PRESETS = [
  { id: "square", label: "Square", w: 1080, h: 1080 },
  { id: "landscape", label: "Landscape", w: 1920, h: 1080 },
  { id: "portrait", label: "Portrait", w: 1080, h: 1350 },
] as const;

const PresetId = z.enum(["square", "landscape", "portrait", CUSTOM_PRESET]);

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const BYTES_PER_MB = 1024 * 1024;
const HEIC_TYPE = /^image\/hei[cf]$/i;
const HEIC_EXTENSION = /\.hei[cf]$/i;

export const TEMPLATE_LABELS: Record<CollageTemplateId, string> = {
  "grid-2x2": "2×2 grid (4 images)",
  "grid-3x3": "3×3 grid (9 images)",
  "hero-4": "Hero + 4 (5 images)",
  rectangular: "Rectangular grid (any count)",
};

export interface CollageFormValues {
  files: File[];
  style: CollageStyle;
  template: CollageTemplateId;
  preset: z.infer<typeof PresetId>;
  width: number;
  height: number;
  format: CollageFormat;
}

export const COLLAGE_FORM_DEFAULTS: CollageFormValues = {
  files: [],
  style: "justified",
  template: "rectangular",
  preset: "square",
  width: 1080,
  height: 1080,
  format: "png",
};

/** Templates usable with `count` images: curated ones need an exact count. */
export function compatibleTemplates(count: number): CollageTemplateId[] {
  const exact = CollageTemplateId.options.filter(
    (id) => id !== "rectangular" && TEMPLATE_IMAGE_COUNTS[id] === count,
  );
  return [...exact, "rectangular"];
}

export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_MB) return `${bytes} B`;
  return `${Number((bytes / BYTES_PER_MB).toFixed(1))} MB`;
}

/** Canvas size in px for the chosen preset, or the custom width/height. */
export function resolveCanvas(v: Pick<CollageFormValues, "preset" | "width" | "height">) {
  const preset = CANVAS_PRESETS.find((p) => p.id === v.preset);
  return preset ? { w: preset.w, h: preset.h } : { w: v.width, h: v.height };
}

function fileProblem(file: File, maxBytes: number): string | null {
  if (HEIC_TYPE.test(file.type) || HEIC_EXTENSION.test(file.name)) {
    return `${file.name}: HEIC/HEIF images are not supported`;
  }
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: only JPEG, PNG, or WebP images are supported`;
  }
  if (file.size > maxBytes) return `${file.name} is larger than ${formatBytes(maxBytes)}`;
  return null;
}

function canvasProblem(v: CollageFormValues, limits: CollageLimits): string | null {
  const { w, h } = resolveCanvas(v);
  if (!Number.isInteger(w) || w < 1) return "Width must be a whole number of at least 1 px";
  if (!Number.isInteger(h) || h < 1) return "Height must be a whole number of at least 1 px";
  if (w > limits.maxCanvasDimension || h > limits.maxCanvasDimension) {
    return `Canvas sides must not exceed ${limits.maxCanvasDimension} px`;
  }
  if (w * h > limits.maxCanvasPixels) {
    return `Canvas must not exceed ${limits.maxCanvasPixels} pixels`;
  }
  return null;
}

/** Client-side mirror of the server's checks, using limits passed in from the server page. */
export function createCollageFormSchema(limits: CollageLimits) {
  // NaN is allowed through the type check so a cleared custom field reports a readable message.
  const size = z.union([z.number(), z.nan()]);
  return z
    .object({
      files: z
        .array(z.custom<File>((f) => f instanceof File))
        .min(1, "Select at least one image")
        .max(limits.maxImages, `Select at most ${limits.maxImages} images`),
      style: CollageStyle,
      template: CollageTemplateId,
      preset: PresetId,
      width: size,
      height: size,
      format: CollageFormat,
    })
    .superRefine((v, ctx) => {
      v.files.forEach((file, i) => {
        const message = fileProblem(file, limits.maxImageUploadBytes);
        if (message) ctx.addIssue({ code: "custom", path: ["files", i], message });
      });
      const canvas = canvasProblem(v, limits);
      if (canvas) {
        const path = v.preset === CUSTOM_PRESET ? "width" : "preset";
        ctx.addIssue({ code: "custom", path: [path], message: canvas });
      }
      const template = v.style === "template" ? v.template : undefined;
      checkStyleTemplate(ctx, { style: v.style, template }, v.files.length);
    });
}

/** Builds the API request from form values and the object keys of the uploaded images. */
export function buildCreateBody(values: CollageFormValues, keys: string[]): CreateCollageBody {
  return CreateCollageBody.parse({
    images: keys,
    mode: "grid",
    style: values.style,
    template: values.style === "template" ? values.template : undefined,
    canvas: resolveCanvas(values),
    format: values.format,
  });
}

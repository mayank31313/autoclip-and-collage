import { z } from "zod";
import type { CollageLimits } from "@/features/collage/limits";
import { CreateCollageBody } from "@/lib/schemas/api";
import {
  POLAROID_FORM_DEFAULTS,
  buildPolaroidBody,
  polaroidProblems,
  type PolaroidFormValues,
} from "@/features/collage/polaroidForm";
import { CollageFormat } from "@/lib/schemas/collage";
import { PolaroidAspect, PolaroidTemplate } from "@/lib/schemas/polaroid";
import { PhotoWallPreset } from "@/lib/schemas/photoWall";
import {
  CollageTemplateDefinition,
  RECTANGULAR_TEMPLATE_ID,
  type TemplateCell,
} from "@/lib/schemas/collageTemplate";

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

/** Layout picked in the form; `custom` is sent to the API as template style with an inline template. */
export const LayoutChoice = z.enum(["justified", "template", "custom", "photo-wall"]);
export type LayoutChoice = z.infer<typeof LayoutChoice>;

export const CUSTOM_GRID_MAX_TRACKS = 6;

/** Equal `rows` x `cols` grid; `hero` merges the top-left 2x2 block into one hero cell. */
export function buildGridTemplate(opts: {
  rows: number;
  cols: number;
  hero: boolean;
}): CollageTemplateDefinition {
  const { rows, cols } = opts;
  const hero = opts.hero && rows > 1 && cols > 1;
  const cells: TemplateCell[] = hero
    ? [{ col: 0, row: 0, colSpan: 2, rowSpan: 2, hero: true }]
    : [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (hero && row < 2 && col < 2) continue;
      cells.push({ col, row, colSpan: 1, rowSpan: 1, hero: false });
    }
  }
  return CollageTemplateDefinition.parse({
    version: 1,
    id: "custom",
    name: "Custom layout",
    cols: Array.from({ length: cols }, () => 1),
    rows: Array.from({ length: rows }, () => 1),
    cells,
  });
}

export const DEFAULT_CUSTOM_GRID = { rows: 2, cols: 2, hero: false };

export function stringifyTemplate(template: CollageTemplateDefinition): string {
  return JSON.stringify(template, null, 2);
}

type ParsedTemplate =
  { ok: true; template: CollageTemplateDefinition } | { ok: false; message: string };

/** Parses custom template JSON text with the shared schema; never throws. */
export function parseTemplateJson(text: string): ParsedTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "Enter valid JSON" };
  }
  const parsed = CollageTemplateDefinition.safeParse(raw);
  if (parsed.success) return { ok: true, template: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, message: `${where}${issue?.message ?? "Invalid template"}` };
}

export interface CollageFormValues extends PolaroidFormValues {
  files: File[];
  style: LayoutChoice;
  /** A file template id or `rectangular`. */
  template: string;
  photoWallPreset: PhotoWallPreset;
  /** JSON text of the custom template (used when style is `custom`). */
  customTemplate: string;
  preset: z.infer<typeof PresetId>;
  width: number;
  height: number;
  format: CollageFormat;
}

export const COLLAGE_FORM_DEFAULTS: CollageFormValues = {
  ...POLAROID_FORM_DEFAULTS,
  files: [],
  style: "justified",
  template: RECTANGULAR_TEMPLATE_ID,
  photoWallPreset: "warm",
  customTemplate: stringifyTemplate(buildGridTemplate(DEFAULT_CUSTOM_GRID)),
  preset: "square",
  width: 1080,
  height: 1080,
  format: "png",
};

/** Template ids usable with `count` images: file templates need an exact count. */
export function compatibleTemplates(
  templates: readonly CollageTemplateDefinition[],
  count: number,
): string[] {
  const exact = templates.filter((t) => t.cells.length === count).map((t) => t.id);
  return [...exact, RECTANGULAR_TEMPLATE_ID];
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

function templateProblem(
  v: CollageFormValues,
  templates: readonly CollageTemplateDefinition[],
): { path: "template" | "customTemplate"; message: string } | null {
  const count = v.files.length;
  if (v.style === "custom") {
    const parsed = parseTemplateJson(v.customTemplate);
    if (!parsed.ok) return { path: "customTemplate", message: parsed.message };
    const needed = parsed.template.cells.length;
    if (count > 0 && needed !== count) {
      return { path: "customTemplate", message: `This layout needs exactly ${needed} images` };
    }
    return null;
  }
  if (v.style !== "template" || v.template === RECTANGULAR_TEMPLATE_ID) return null;
  const found = templates.find((t) => t.id === v.template);
  if (!found) return { path: "template", message: "Choose a template" };
  if (count > 0 && found.cells.length !== count) {
    return {
      path: "template",
      message: `${found.name} needs exactly ${found.cells.length} images`,
    };
  }
  return null;
}

/** Client-side mirror of the server's checks, using limits and templates from the server page. */
export function createCollageFormSchema(
  limits: CollageLimits,
  templates: readonly CollageTemplateDefinition[],
) {
  // NaN is allowed through the type check so a cleared custom field reports a readable message.
  const size = z.union([z.number(), z.nan()]);
  return z
    .object({
      files: z
        .array(z.custom<File>((f) => f instanceof File))
        .min(1, "Select at least one image")
        .max(limits.maxImages, `Select at most ${limits.maxImages} images`),
      style: LayoutChoice,
      template: z.string(),
      photoWallPreset: PhotoWallPreset,
      customTemplate: z.string(),
      preset: PresetId,
      width: size,
      height: size,
      format: CollageFormat,
      mode: z.enum(["grid", "polaroid"]),
      slides: size,
      slideAspect: PolaroidAspect,
      polaroidTemplate: PolaroidTemplate,
      slideLayout: z.enum(["even", "custom"]),
      imagesPerSlide: z.array(size),
      slideSizes: z.array(z.string()),
      captions: z.array(z.string()),
    })
    .superRefine((v, ctx) => {
      v.files.forEach((file, i) => {
        const message = fileProblem(file, limits.maxImageUploadBytes);
        if (message) ctx.addIssue({ code: "custom", path: ["files", i], message });
      });
      if (v.mode === "polaroid") {
        for (const problem of polaroidProblems(v, v.files.length)) {
          ctx.addIssue({ code: "custom", path: problem.path, message: problem.message });
        }
        return;
      }
      const canvas = canvasProblem(v, limits);
      if (canvas) {
        const path = v.preset === CUSTOM_PRESET ? "width" : "preset";
        ctx.addIssue({ code: "custom", path: [path], message: canvas });
      }
      const template = templateProblem(v, templates);
      if (template)
        ctx.addIssue({ code: "custom", path: [template.path], message: template.message });
    });
}

function templateFields(values: CollageFormValues) {
  if (values.style === "justified") return { style: "justified" };
  if (values.style === "photo-wall")
    return { style: "photo-wall", photoWallPreset: values.photoWallPreset };
  if (values.style === "template") return { style: "template", template: values.template };
  const parsed = parseTemplateJson(values.customTemplate);
  // Validation runs first, so an invalid template here is a programming error.
  if (!parsed.ok) throw new Error(parsed.message);
  return { style: "template", customTemplate: parsed.template };
}

/** Builds the API request from form values and the object keys of the uploaded images. */
export function buildCreateBody(values: CollageFormValues, keys: string[]): CreateCollageBody {
  if (values.mode === "polaroid") return buildPolaroidBody(values, keys);
  return CreateCollageBody.parse({
    images: keys,
    mode: "grid",
    ...templateFields(values),
    canvas: resolveCanvas(values),
    format: values.format,
  });
}

import { z } from "zod";
import {
  CollageCanvas,
  CollageFormat,
  CollageStyle,
  checkStyleTemplate,
  checkUnique,
} from "@/lib/schemas/collage";
import { CollageTemplateDefinition, TemplateId } from "@/lib/schemas/collageTemplate";
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { PolaroidOptions, checkSlideLayout } from "@/lib/schemas/polaroid";
import { PhotoWallPreset } from "@/lib/schemas/photoWall";
import { SlideshowOptions, SlideshowSourceSchema } from "@/lib/schemas/slideshow";

export const ALLOWED_UPLOAD_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// The packaged sharp/libvips build cannot decode HEVC, so HEIC/HEIF is excluded by type and name.
const HEIC_EXTENSION = /\.hei[cf]$/i;
const NOT_HEIC = { message: "HEIC/HEIF images are not supported" };

export const PresignBody = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !HEIC_EXTENSION.test(name), NOT_HEIC),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive(),
});
export type PresignBody = z.infer<typeof PresignBody>;

export const PresignResponse = z.object({
  url: z.string(),
  key: z.string(),
  expiresInSec: z.number().int().positive(),
});
export type PresignResponse = z.infer<typeof PresignResponse>;

const HttpUrl = z.url({ protocol: /^https?$/ });
const MAX_OBJECT_KEY_LENGTH = 1024;
const ImageKey = z
  .string()
  .min(1)
  .max(MAX_OBJECT_KEY_LENGTH)
  .refine((key) => !HEIC_EXTENSION.test(key), NOT_HEIC);

export const CreateGridCollageBody = z
  .object({
    images: z.array(ImageKey).min(1),
    mode: z.literal("grid"),
    style: CollageStyle,
    /** A template id from GET /api/collages/templates, or `rectangular` (any image count). */
    template: TemplateId.optional(),
    /** An inline template; mutually exclusive with `template`. */
    customTemplate: CollageTemplateDefinition.optional(),
    photoWallPreset: PhotoWallPreset.optional(),
    canvas: CollageCanvas,
    format: CollageFormat.default("png"),
    webhookUrl: HttpUrl.optional(),
  })
  .superRefine((body, ctx) => {
    checkUnique(ctx, body.images, "images", "image key");
    if (body.style !== "photo-wall" && body.photoWallPreset !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["photoWallPreset"],
        message: "photoWallPreset requires photo-wall style",
      });
    }
    if (body.template !== undefined && body.customTemplate !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["customTemplate"],
        message: "send either template or customTemplate, not both",
      });
      return;
    }
    // Only custom templates and `rectangular` are checked here; file template counts need
    // the server-side registry and are checked by the route.
    const template =
      body.customTemplate ?? (body.template === undefined ? undefined : "rectangular");
    checkStyleTemplate(ctx, { style: body.style, template }, body.images.length);
  });
export type CreateGridCollageBody = z.infer<typeof CreateGridCollageBody>;

export const CreatePolaroidCollageBody = z
  .object({
    images: z.array(ImageKey).min(1),
    mode: z.literal("polaroid"),
    polaroid: PolaroidOptions,
    format: CollageFormat.default("png"),
    webhookUrl: HttpUrl.optional(),
  })
  .superRefine((body, ctx) => {
    checkUnique(ctx, body.images, "images", "image key");
    const { slides, captions, imagesPerSlide, slideSizes } = body.polaroid;
    if (captions !== undefined && captions.length !== body.images.length) {
      ctx.addIssue({
        code: "custom",
        path: ["polaroid", "captions"],
        message: "send exactly one caption per image",
      });
    }
    const slideCount = slides ?? imagesPerSlide?.length ?? defaultSlideCount(body.images.length);
    const problem = slideCountProblem(body.images.length, slideCount);
    if (problem) ctx.addIssue({ code: "custom", path: ["polaroid", "slides"], message: problem });
    checkSlideLayout(
      ctx,
      { imageCount: body.images.length, slides: slideCount, imagesPerSlide, slideSizes },
      ["polaroid"],
    );
  });
export type CreatePolaroidCollageBody = z.infer<typeof CreatePolaroidCollageBody>;

export const CreateSlideshowCollageBody = z
  .object({
    sources: z.array(SlideshowSourceSchema).min(1),
    mode: z.literal("slideshow"),
    slideshow: SlideshowOptions,
    format: z.literal("mp4"),
    webhookUrl: HttpUrl.optional(),
  })
  .superRefine((body, ctx) => {
    checkUnique(
      ctx,
      body.sources.map((s) => s.key),
      "sources",
      "source key",
    );
  });
export type CreateSlideshowCollageBody = z.infer<typeof CreateSlideshowCollageBody>;

export const CreateCollageBody = z.discriminatedUnion("mode", [
  CreateGridCollageBody,
  CreatePolaroidCollageBody,
  CreateSlideshowCollageBody,
]);
export type CreateCollageBody = z.infer<typeof CreateCollageBody>;

export const CreateCollageResponse = z.object({ jobId: z.string().min(1) });
export type CreateCollageResponse = z.infer<typeof CreateCollageResponse>;

export const CollageTemplatesResponse = z.object({
  templates: z.array(CollageTemplateDefinition),
});
export type CollageTemplatesResponse = z.infer<typeof CollageTemplatesResponse>;

export const CollageJobResult = z.object({
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: CollageFormat,
    downloadUrl: HttpUrl,
    expiresInSec: z.number().int().positive(),
  }),
});
export type CollageJobResult = z.infer<typeof CollageJobResult>;

export const PolaroidJobResult = z.object({
  output: z.object({
    slideCount: z.number().int().min(2),
    slideWidth: z.number().int().positive(),
    slideHeight: z.number().int().positive(),
    slideFormat: CollageFormat,
    zipUrl: HttpUrl,
    slides: z.array(z.object({ index: z.number().int().nonnegative(), url: HttpUrl })).min(2),
    expiresInSec: z.number().int().positive(),
  }),
});
export type PolaroidJobResult = z.infer<typeof PolaroidJobResult>;

export { SlideshowJobResult } from "@/lib/schemas/slideshow";
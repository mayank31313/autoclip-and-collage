import { z } from "zod";
import {
  CollageCanvas,
  CollageFormat,
  CollageStyle,
  CollageTemplateId,
  checkStyleTemplate,
  checkUnique,
} from "@/lib/schemas/collage";

export const ALLOWED_UPLOAD_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const PresignBody = z.object({
  filename: z.string().min(1).max(255),
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

export const CreateCollageBody = z
  .object({
    images: z.array(z.string().min(1).max(MAX_OBJECT_KEY_LENGTH)).min(1),
    mode: z.literal("grid"),
    style: CollageStyle,
    template: CollageTemplateId.optional(),
    canvas: CollageCanvas,
    format: CollageFormat.default("png"),
    webhookUrl: HttpUrl.optional(),
  })
  .superRefine((body, ctx) => {
    checkUnique(ctx, body.images, "images", "image key");
    checkStyleTemplate(ctx, body, body.images.length);
  });
export type CreateCollageBody = z.infer<typeof CreateCollageBody>;

export const CreateCollageResponse = z.object({ jobId: z.string().min(1) });
export type CreateCollageResponse = z.infer<typeof CreateCollageResponse>;

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

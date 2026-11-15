import { z } from "zod";

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

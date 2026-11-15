import { z } from "zod";

export const CropPoint = z.object({
  t: z.number().nonnegative(), // seconds, relative to clip start
  cx: z.number().min(0).max(1), // normalized center x
  cy: z.number().min(0).max(1), // normalized center y
  w: z.number().min(0).max(1), // normalized crop width
  h: z.number().min(0).max(1), // normalized crop height
});
export type CropPoint = z.infer<typeof CropPoint>;

export const EdlClip = z
  .object({
    src: z.string(), // asset id
    start: z.number().nonnegative(), // seconds
    end: z.number().positive(), // seconds
    score: z.number().min(0).max(1),
    crop: z.object({
      mode: z.enum(["none", "center", "track"]),
      aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
      path: z.array(CropPoint).optional(),
    }),
    captions: z.object({ enabled: z.boolean(), style: z.string().default("default") }),
    audio: z.object({ normalizeLufs: z.number().default(-16) }),
  })
  .refine((c) => c.end > c.start, { message: "end must be after start" });
export type EdlClip = z.infer<typeof EdlClip>;

export const Edl = z.object({ version: z.literal(1), clips: z.array(EdlClip).min(1) });
export type Edl = z.infer<typeof Edl>;

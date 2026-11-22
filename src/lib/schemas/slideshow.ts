import { z } from "zod";
import { validateSlideshowSpec } from "@/lib/planner/slideshow/validate";

export const SLIDESHOW_JOB_TYPE = "collage.slideshow";

export const SlideshowSourceKind = z.enum(["image", "video"]);
export const SlideshowCanvas = z.enum(["16:9", "9:16", "1:1"]);
export const SlideshowFit = z.enum(["cover", "contain"]);

export const SlideshowSourceSchema = z
  .object({
    key: z.string().min(1).max(1024),
    kind: SlideshowSourceKind,
    durationSec: z.number().positive().max(30).optional(),
    startSec: z.number().nonnegative().optional(),
    endSec: z.number().positive().optional(),
    fit: SlideshowFit.default("cover"),
  })
  .superRefine((source, ctx) => {
    if (source.kind === "image" && source.durationSec === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["durationSec"],
        message: "image durationSec is required",
      });
    }
    if (source.kind === "video" && source.startSec !== undefined && source.endSec === undefined) {
      ctx.addIssue({ code: "custom", path: ["endSec"], message: "endSec is required with startSec" });
    }
    if (source.startSec !== undefined && source.endSec !== undefined && source.endSec <= source.startSec) {
      ctx.addIssue({ code: "custom", path: ["endSec"], message: "endSec must follow startSec" });
    }
  });

export const SlideshowOptions = z
  .object({
    canvas: SlideshowCanvas.default("16:9"),
    fps: z.union([z.literal(24), z.literal(30)]).default(30),
    transition: z.enum(["cut", "fade", "wipe"]).default("cut"),
    transitionSec: z.number().nonnegative().max(2).default(0),
  })
  .refine(
    (options) => options.transition !== "cut" || options.transitionSec === 0,
    "cut requires transitionSec to be zero",
  );

export const SlideshowWorkerSource = z.object({
  assetId: z.string().min(1),
  kind: SlideshowSourceKind,
  durationSec: z.number().positive().max(30),
  startSec: z.number().nonnegative().default(0),
  endSec: z.number().positive(),
  fit: SlideshowFit,
});

export const SlideshowWorkerInput = z
  .object({
    sources: z.array(SlideshowWorkerSource).min(1).max(20),
    slideshow: SlideshowOptions,
  })
  .superRefine((input, ctx) => {
    const ids = new Set<string>();
    input.sources.forEach((source, index) => {
      if (ids.has(source.assetId)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "assetId"],
          message: "asset used more than once",
        });
      }
      ids.add(source.assetId);
    });
  });

const HttpUrl = z.url({ protocol: /^https?$/ });

export const SlideshowJobResult = z.object({
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.union([z.literal(24), z.literal(30)]),
    durationSec: z.number().positive(),
    format: z.literal("mp4"),
    masterUrl: HttpUrl,
    zipUrl: HttpUrl,
    slides: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          durationSec: z.number().positive(),
          url: HttpUrl,
        }),
      )
      .min(1)
      .max(20),
    expiresInSec: z.number().int().positive(),
  }),
});

export const SlideshowSpec = z
  .object({
    version: z.literal(1),
    canvas: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    fps: z.union([z.literal(24), z.literal(30)]),
    transition: z.object({ type: z.enum(["cut", "fade", "wipe"]), durationSec: z.number().nonnegative() }),
    slides: z
      .array(
        z.object({
          id: z.number().int().nonnegative(),
          assetId: z.string().min(1),
          kind: SlideshowSourceKind,
          startSec: z.number().nonnegative(),
          endSec: z.number().positive(),
          durationSec: z.number().positive(),
          fit: SlideshowFit,
        }),
      )
      .min(1)
      .max(20),
    masterDurationSec: z.number().positive(),
  })
  .superRefine((spec, ctx) => {
    const issues = validateSlideshowSpec(spec);
    for (const issue of issues) {
      ctx.addIssue({
        code: "custom",
        path: issue.path as (string | number)[],
        message: issue.message,
      });
    }
  });

export const SlideshowWorkerResult = z.object({
  masterAssetId: z.string().min(1),
  zipAssetId: z.string().min(1),
  slideAssetIds: z.array(z.string().min(1)).min(1).max(20),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.union([z.literal(24), z.literal(30)]),
  durationSec: z.number().positive(),
});

export type SlideshowSourceSchema = z.infer<typeof SlideshowSourceSchema>;
export type SlideshowOptions = z.infer<typeof SlideshowOptions>;
export type SlideshowWorkerInput = z.infer<typeof SlideshowWorkerInput>;
export type SlideshowSpec = z.infer<typeof SlideshowSpec>;
export type SlideshowWorkerResult = z.infer<typeof SlideshowWorkerResult>;
export type SlideshowJobResult = z.infer<typeof SlideshowJobResult>;
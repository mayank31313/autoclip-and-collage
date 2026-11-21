import { z } from "zod";
import { validatePolaroidSpec } from "@/lib/planner/collage/polaroid/validate";
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
  POLAROID_TAPE_VARIANTS,
} from "@/lib/planner/collage/polaroid/defaults";
import { slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { CollageFormat, checkUnique } from "@/lib/schemas/collage";

export const POLAROID_JOB_TYPE = "collage.polaroid";

export const PolaroidAspect = z.enum(["4:5", "1:1"]);
export type PolaroidAspect = z.infer<typeof PolaroidAspect>;

export const PolaroidCaption = z.string().max(POLAROID_MAX_CAPTION_CHARS);
const SlideCount = z.number().int().min(POLAROID_MIN_SLIDES).max(POLAROID_MAX_SLIDES);

/** The `polaroid` options object of a create-collage request. */
export const PolaroidOptions = z.object({
  slides: SlideCount.optional(),
  slideAspect: PolaroidAspect,
  captions: z.array(PolaroidCaption).optional(),
});
export type PolaroidOptions = z.infer<typeof PolaroidOptions>;

/** Resolved worker input: slide count and captions are always explicit. */
export const PolaroidWorkerInput = z
  .object({
    sourceAssetIds: z.array(z.string().min(1)).min(1),
    slides: SlideCount,
    slideAspect: PolaroidAspect,
    captions: z.array(PolaroidCaption),
    format: CollageFormat,
  })
  .superRefine((input, ctx) => {
    checkUnique(ctx, input.sourceAssetIds, "sourceAssetIds", "asset ID");
    if (input.captions.length !== input.sourceAssetIds.length) {
      ctx.addIssue({ code: "custom", path: ["captions"], message: "one caption per image" });
    }
    const problem = slideCountProblem(input.sourceAssetIds.length, input.slides);
    if (problem) ctx.addIssue({ code: "custom", path: ["slides"], message: problem });
  });
export type PolaroidWorkerInput = z.infer<typeof PolaroidWorkerInput>;

/** Internal worker result; asset IDs are never exposed publicly. */
export const PolaroidWorkerResult = z.object({
  zipAssetId: z.string().min(1),
  slideAssetIds: z.array(z.string().min(1)).min(POLAROID_MIN_SLIDES),
  slideWidth: z.number().int().positive(),
  slideHeight: z.number().int().positive(),
  format: CollageFormat,
});
export type PolaroidWorkerResult = z.infer<typeof PolaroidWorkerResult>;

const Point = z.tuple([z.number().int(), z.number().int()]);

export const PolaroidItem = z.object({
  id: z.number().int().nonnegative(),
  image: z.string().min(1), // asset id
  caption: PolaroidCaption,
  x: z.number().int(), // unrotated frame top-left, spread px
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  rotationDeg: z.number().min(-POLAROID_MAX_ROTATION_DEG).max(POLAROID_MAX_ROTATION_DEG),
  tape: z.enum(POLAROID_TAPE_VARIANTS),
});
export type PolaroidItem = z.infer<typeof PolaroidItem>;

export const PaperSpec = z.object({
  seed: z.number().int().nonnegative(),
  page: z.object({
    ruleStepPx: z.number().int().positive(),
    ruleFirstYPx: z.number().int().nonnegative(),
    holes: z.object({
      xs: z.array(z.number().int()),
      yPx: z.number().int(),
      rPx: z.number().int().positive(),
    }),
  }),
  /** Closed polygon of the torn, glued sheet in spread px. */
  sheet: z.object({ outline: z.array(Point).min(3) }),
});
export type PaperSpec = z.infer<typeof PaperSpec>;

export const PolaroidSpec = z
  .object({
    version: z.literal(1),
    spread: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    slide: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      count: SlideCount,
    }),
    polaroids: z.array(PolaroidItem).min(1),
    paper: PaperSpec,
  })
  .superRefine((spec, ctx) => {
    for (const issue of validatePolaroidSpec(spec)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });
export type PolaroidSpec = z.infer<typeof PolaroidSpec>;

import { z } from "zod";
import { validatePolaroidSpec } from "@/lib/planner/collage/polaroid/validate";
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_IMAGES_PER_SLIDE,
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
  POLAROID_SLIDE_SIZES,
  POLAROID_TAPE_VARIANTS,
} from "@/lib/planner/collage/polaroid/defaults";
import {
  imagesPerSlideProblem,
  slideCountProblem,
  slideSizesProblem,
} from "@/lib/planner/collage/polaroid/slides";
import {
  DEFAULT_POLAROID_TEMPLATE,
  POLAROID_TEMPLATE_IDS,
} from "@/lib/planner/collage/polaroid/templates";
import { CollageFormat, checkUnique } from "@/lib/schemas/collage";

export const POLAROID_JOB_TYPE = "collage.polaroid";

export const PolaroidAspect = z.enum(["4:5", "1:1"]);
export type PolaroidAspect = z.infer<typeof PolaroidAspect>;

export const PolaroidCaption = z.string().max(POLAROID_MAX_CAPTION_CHARS);
export const PolaroidTemplate = z.enum(POLAROID_TEMPLATE_IDS);
export const PolaroidSlideSize = z.enum(POLAROID_SLIDE_SIZES);
const SlideCount = z.number().int().min(POLAROID_MIN_SLIDES).max(POLAROID_MAX_SLIDES);
const SlideImageCount = z.number().int().min(1).max(POLAROID_MAX_IMAGES_PER_SLIDE);

/** The `polaroid` options object of a create-collage request. */
export const PolaroidOptions = z.object({
  slides: SlideCount.optional(),
  slideAspect: PolaroidAspect,
  template: PolaroidTemplate.optional(),
  /** Images on each slide, in order; must add up to the image count. */
  imagesPerSlide: z.array(SlideImageCount).max(POLAROID_MAX_SLIDES).optional(),
  /** Polaroid size on each slide, in order. */
  slideSizes: z.array(PolaroidSlideSize).max(POLAROID_MAX_SLIDES).optional(),
  captions: z.array(PolaroidCaption).optional(),
});
export type PolaroidOptions = z.infer<typeof PolaroidOptions>;

interface SlideLayoutFields {
  imageCount: number;
  slides: number;
  imagesPerSlide?: readonly number[] | undefined;
  slideSizes?: readonly unknown[] | undefined;
}

/** Reports per-slide count and size problems; `path` is where the options object lives. */
export function checkSlideLayout(
  ctx: z.RefinementCtx,
  fields: SlideLayoutFields,
  path: (string | number)[],
): void {
  const { imageCount, slides, imagesPerSlide, slideSizes } = fields;
  const counts = imagesPerSlide && imagesPerSlideProblem(imageCount, slides, imagesPerSlide);
  if (counts) ctx.addIssue({ code: "custom", path: [...path, "imagesPerSlide"], message: counts });
  const sizes = slideSizes && slideSizesProblem(slides, slideSizes);
  if (sizes) ctx.addIssue({ code: "custom", path: [...path, "slideSizes"], message: sizes });
}

/** Resolved worker input: slide count and captions are always explicit. */
export const PolaroidWorkerInput = z
  .object({
    sourceAssetIds: z.array(z.string().min(1)).min(1),
    slides: SlideCount,
    slideAspect: PolaroidAspect,
    // Jobs queued before templates existed have no template.
    template: PolaroidTemplate.default(DEFAULT_POLAROID_TEMPLATE),
    // Jobs queued before per-slide layout existed split images evenly at the default size.
    imagesPerSlide: z.array(SlideImageCount).optional(),
    slideSizes: z.array(PolaroidSlideSize).optional(),
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
    checkSlideLayout(ctx, { imageCount: input.sourceAssetIds.length, ...input }, []);
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

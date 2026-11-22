import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_IMAGES_PER_SLIDE,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
  POLAROID_SLIDE_SIZES,
  DEFAULT_POLAROID_SLIDE_SIZE,
  type PolaroidSlideSize,
} from "@/lib/planner/collage/polaroid/defaults";
import {
  defaultSlideCount,
  evenSlideCounts,
  imagesPerSlideProblem,
  slideCountProblem,
} from "@/lib/planner/collage/polaroid/slides";
import {
  DEFAULT_POLAROID_TEMPLATE,
  type PolaroidTemplateId,
} from "@/lib/planner/collage/polaroid/templates";
import { CreateCollageBody } from "@/lib/schemas/api";
import type { CollageFormat } from "@/lib/schemas/collage";
import type { PolaroidAspect } from "@/lib/schemas/polaroid";

export type CollageMode = "grid" | "polaroid";
export type SlideLayoutMode = "even" | "custom";

export interface PolaroidFormValues {
  mode: CollageMode;
  /** Slide count; NaN (an empty field) means "choose automatically". */
  slides: number;
  slideAspect: PolaroidAspect;
  polaroidTemplate: PolaroidTemplateId;
  /** `even` splits the photos across slides; `custom` uses `imagesPerSlide`. */
  slideLayout: SlideLayoutMode;
  /** Photos on each slide, by slide index; only used when `slideLayout` is `custom`. */
  imagesPerSlide: number[];
  /** Polaroid size on each slide, by slide index; a missing entry means the default size. */
  slideSizes: string[];
  /** One caption per selected file, by index. */
  captions: string[];
}

export const POLAROID_FORM_DEFAULTS: PolaroidFormValues = {
  mode: "grid",
  slides: Number.NaN,
  slideAspect: "4:5",
  polaroidTemplate: DEFAULT_POLAROID_TEMPLATE,
  slideLayout: "even",
  imagesPerSlide: [],
  slideSizes: [],
  captions: [],
};

export const SLIDE_ASPECT_OPTIONS = [
  { id: "4:5", label: "Portrait 4:5", size: "1080×1350" },
  { id: "1:1", label: "Square 1:1", size: "1080×1080" },
] as const;

export const SLIDE_LAYOUT_OPTIONS: ReadonlyArray<{
  id: SlideLayoutMode;
  label: string;
  description: string;
}> = [
  { id: "even", label: "Even split", description: "Spread the photos evenly over the slides." },
  { id: "custom", label: "Custom", description: "Choose how many photos go on each slide." },
];

export const SLIDE_SIZE_OPTIONS: ReadonlyArray<{ id: PolaroidSlideSize; label: string }> = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

export const POLAROID_TEMPLATE_OPTIONS: ReadonlyArray<{
  id: PolaroidTemplateId;
  label: string;
  description: string;
}> = [
  { id: "scatter", label: "Scatter", description: "Playful tilts in two staggered rows." },
  { id: "tidy", label: "Tidy", description: "Evenly sized, nearly straight zigzag." },
  { id: "cascade", label: "Cascade", description: "A stepped diagonal that tumbles down." },
  { id: "spotlight", label: "Spotlight", description: "Every third photo is large and centred." },
];

export function effectiveSlides(slides: number, imageCount: number): number {
  return Number.isNaN(slides) ? defaultSlideCount(imageCount) : slides;
}

/** Size chosen for a slide; anything unrecognised falls back to the default. */
export function slideSizeAt(sizes: readonly string[], slide: number): PolaroidSlideSize {
  const size = POLAROID_SLIDE_SIZES.find((s) => s === sizes[slide]);
  return size ?? DEFAULT_POLAROID_SLIDE_SIZE;
}

/** Photos per slide as the form currently describes them (NaN for an unfilled custom entry). */
export function slideCounts(values: PolaroidFormValues, imageCount: number): number[] {
  const slides = effectiveSlides(values.slides, imageCount);
  if (values.slideLayout === "even") return evenSlideCounts(imageCount, slides);
  return Array.from({ length: slides }, (_, i) => values.imagesPerSlide[i] ?? Number.NaN);
}

export interface FormProblem {
  path: (string | number)[];
  message: string;
}

function customCountProblems(values: PolaroidFormValues, imageCount: number): FormProblem[] {
  const counts = slideCounts(values, imageCount);
  const invalid = counts.flatMap((n, i) =>
    Number.isInteger(n) && n >= 1 && n <= POLAROID_MAX_IMAGES_PER_SLIDE
      ? []
      : [
          {
            path: ["imagesPerSlide", i],
            message: `Enter 1 to ${POLAROID_MAX_IMAGES_PER_SLIDE}`,
          },
        ],
  );
  if (invalid.length > 0 || imageCount === 0) return invalid;
  const problem = imagesPerSlideProblem(imageCount, counts.length, counts);
  return problem ? [{ path: ["imagesPerSlide"], message: capitalize(problem) }] : [];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Client-side mirror of the server's polaroid checks. */
export function polaroidProblems(values: PolaroidFormValues, imageCount: number): FormProblem[] {
  const problems: FormProblem[] = [];
  const { slides } = values;
  const outOfRange =
    !Number.isNaN(slides) &&
    (!Number.isInteger(slides) || slides < POLAROID_MIN_SLIDES || slides > POLAROID_MAX_SLIDES);
  if (outOfRange) {
    problems.push({
      path: ["slides"],
      message: `Choose ${POLAROID_MIN_SLIDES} to ${POLAROID_MAX_SLIDES} slides`,
    });
  } else if (imageCount > 0) {
    const problem = slideCountProblem(imageCount, effectiveSlides(slides, imageCount));
    if (problem) problems.push({ path: ["slides"], message: problem });
    else if (values.slideLayout === "custom") {
      problems.push(...customCountProblems(values, imageCount));
    }
  }
  values.captions.forEach((caption, i) => {
    if (caption.trim().length > POLAROID_MAX_CAPTION_CHARS) {
      problems.push({
        path: ["captions", i],
        message: `Captions can be up to ${POLAROID_MAX_CAPTION_CHARS} characters`,
      });
    }
  });
  return problems;
}

/** Builds the polaroid API request from form values and the uploaded object keys. */
export function buildPolaroidBody(
  values: PolaroidFormValues & { format: CollageFormat },
  keys: string[],
): CreateCollageBody {
  const captions = keys.map((_, i) => (values.captions[i] ?? "").trim());
  const slides = effectiveSlides(values.slides, keys.length);
  const sizes = Array.from({ length: slides }, (_, i) => slideSizeAt(values.slideSizes, i));
  const custom = values.slideLayout === "custom";
  return CreateCollageBody.parse({
    images: keys,
    mode: "polaroid",
    polaroid: {
      ...(Number.isNaN(values.slides) ? {} : { slides: values.slides }),
      slideAspect: values.slideAspect,
      template: values.polaroidTemplate,
      ...(custom && { imagesPerSlide: slideCounts(values, keys.length) }),
      ...(sizes.some((size) => size !== DEFAULT_POLAROID_SLIDE_SIZE) && { slideSizes: sizes }),
      ...(captions.some((caption) => caption !== "") && { captions }),
    },
    format: values.format,
  });
}

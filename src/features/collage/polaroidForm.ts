import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "@/lib/planner/collage/polaroid/defaults";
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { CreateCollageBody } from "@/lib/schemas/api";
import type { CollageFormat } from "@/lib/schemas/collage";
import type { PolaroidAspect } from "@/lib/schemas/polaroid";

export type CollageMode = "grid" | "polaroid";

export interface PolaroidFormValues {
  mode: CollageMode;
  /** Slide count; NaN (an empty field) means "choose automatically". */
  slides: number;
  slideAspect: PolaroidAspect;
  /** One caption per selected file, by index. */
  captions: string[];
}

export const POLAROID_FORM_DEFAULTS: PolaroidFormValues = {
  mode: "grid",
  slides: Number.NaN,
  slideAspect: "4:5",
  captions: [],
};

export const SLIDE_ASPECT_OPTIONS = [
  { id: "4:5", label: "Portrait 4:5", size: "1080×1350" },
  { id: "1:1", label: "Square 1:1", size: "1080×1080" },
] as const;

export function effectiveSlides(slides: number, imageCount: number): number {
  return Number.isNaN(slides) ? defaultSlideCount(imageCount) : slides;
}

export interface FormProblem {
  path: (string | number)[];
  message: string;
}

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
  return CreateCollageBody.parse({
    images: keys,
    mode: "polaroid",
    polaroid: {
      ...(Number.isNaN(values.slides) ? {} : { slides: values.slides }),
      slideAspect: values.slideAspect,
      ...(captions.some((caption) => caption !== "") && { captions }),
    },
    format: values.format,
  });
}

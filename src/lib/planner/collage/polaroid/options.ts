import type { PolaroidAspect } from "@/lib/schemas/polaroid";
import { DEFAULT_POLAROID_SLIDE_SIZE, type PolaroidSlideSize } from "./defaults";
import { defaultSlideCount, evenSlideCounts } from "./slides";
import { DEFAULT_POLAROID_TEMPLATE, type PolaroidTemplateId } from "./templates";

export interface ResolvedPolaroidOptions {
  slides: number;
  slideAspect: PolaroidAspect;
  template: PolaroidTemplateId;
  imagesPerSlide: number[];
  slideSizes: PolaroidSlideSize[];
  captions: string[];
}

/**
 * Fills request defaults: slide count from the image count (or the per-slide counts), an even
 * split, the default size on every slide, and one trimmed caption per image.
 */
export function resolvePolaroidOptions(
  options: {
    slides?: number | undefined;
    slideAspect: PolaroidAspect;
    template?: PolaroidTemplateId | undefined;
    imagesPerSlide?: readonly number[] | undefined;
    slideSizes?: readonly PolaroidSlideSize[] | undefined;
    captions?: readonly string[] | undefined;
  },
  imageCount: number,
): ResolvedPolaroidOptions {
  const slides = options.slides ?? options.imagesPerSlide?.length ?? defaultSlideCount(imageCount);
  return {
    slides,
    slideAspect: options.slideAspect,
    template: options.template ?? DEFAULT_POLAROID_TEMPLATE,
    imagesPerSlide: [...(options.imagesPerSlide ?? evenSlideCounts(imageCount, slides))],
    slideSizes: [
      ...(options.slideSizes ?? Array.from({ length: slides }, () => DEFAULT_POLAROID_SLIDE_SIZE)),
    ],
    captions: Array.from({ length: imageCount }, (_, i) => (options.captions?.[i] ?? "").trim()),
  };
}

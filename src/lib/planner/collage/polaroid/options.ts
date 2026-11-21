import type { PolaroidAspect } from "@/lib/schemas/polaroid";
import { defaultSlideCount } from "./slides";

export interface ResolvedPolaroidOptions {
  slides: number;
  slideAspect: PolaroidAspect;
  captions: string[];
}

/** Fills request defaults: slide count from the image count and one trimmed caption per image. */
export function resolvePolaroidOptions(
  options: {
    slides?: number | undefined;
    slideAspect: PolaroidAspect;
    captions?: readonly string[] | undefined;
  },
  imageCount: number,
): ResolvedPolaroidOptions {
  return {
    slides: options.slides ?? defaultSlideCount(imageCount),
    slideAspect: options.slideAspect,
    captions: Array.from({ length: imageCount }, (_, i) => (options.captions?.[i] ?? "").trim()),
  };
}

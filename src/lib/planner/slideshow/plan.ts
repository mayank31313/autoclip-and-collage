import { SLIDESHOW_CANVAS_SIZE } from "./defaults";
import type { SlideshowSpec } from "@/lib/schemas/slideshow";

interface PlanSource {
  assetId: string;
  kind: "image" | "video";
  durationSec: number;
  startSec?: number;
  endSec?: number;
  fit: "cover" | "contain";
}

export function planSlideshowTimeline(input: {
  canvas: "16:9" | "9:16" | "1:1";
  fps: 24 | 30;
  transition: "cut" | "fade" | "wipe";
  transitionSec: number;
  sources: readonly PlanSource[];
}): SlideshowSpec {
  const transitionSec = input.transition === "cut" ? 0 : input.transitionSec;
  const slides = input.sources.map((source, id) => {
    const startSec = source.startSec ?? 0;
    const endSec = source.endSec ?? startSec + source.durationSec;
    return {
      id,
      assetId: source.assetId,
      kind: source.kind,
      startSec,
      endSec,
      durationSec: source.durationSec,
      fit: source.fit,
    };
  });
  const overlap = transitionSec * Math.max(0, slides.length - 1);
  return {
    version: 1,
    canvas: SLIDESHOW_CANVAS_SIZE[input.canvas],
    fps: input.fps,
    transition: { type: input.transition, durationSec: transitionSec },
    slides,
    masterDurationSec: Math.max(0, slides.reduce((sum, slide) => sum + slide.durationSec, 0) - overlap),
  };
}
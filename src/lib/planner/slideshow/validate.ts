import type { SlideshowSpec } from "@/lib/schemas/slideshow";

export interface SlideshowIssue {
  path: readonly (string | number)[];
  message: string;
}

export function validateSlideshowSpec(spec: SlideshowSpec): readonly SlideshowIssue[] {
  const issues: SlideshowIssue[] = [];
  const assetIds = new Set<string>();
  for (const [index, slide] of spec.slides.entries()) {
    if (assetIds.has(slide.assetId)) {
      issues.push({ path: ["slides", index, "assetId"], message: "asset used more than once" });
    }
    assetIds.add(slide.assetId);
    if (slide.endSec <= slide.startSec) {
      issues.push({ path: ["slides", index, "endSec"], message: "endSec must follow startSec" });
    }
  }
  if (spec.transition.type === "cut" && spec.transition.durationSec !== 0) {
    issues.push({ path: ["transition", "durationSec"], message: "cut requires zero transition" });
  }
  return issues;
}
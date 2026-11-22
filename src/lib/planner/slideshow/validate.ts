import type { SlideshowSpec } from "@/lib/schemas/slideshow";

export interface SlideshowIssue {
  path: readonly (string | number)[];
  message: string;
}

const DURATION_EPSILON_SEC = 1e-6;

/**
 * Structural checks only: positive/ordered durations, unique asset usage, and the
 * cut-requires-zero-transition rule. Runtime upper bounds (max slide/master/transition
 * duration, max slide count) come from server Config and are enforced in the API route,
 * not here, so this pure planner stays IO-free and config changes do not require rebuilding
 * the browser bundle that imports it for live preview.
 */
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
    } else if (
      Math.abs(slide.durationSec - (slide.endSec - slide.startSec)) > DURATION_EPSILON_SEC
    ) {
      issues.push({
        path: ["slides", index, "durationSec"],
        message: "durationSec must equal endSec minus startSec",
      });
    }
  }
  if (spec.transition.type === "cut" && spec.transition.durationSec !== 0) {
    issues.push({ path: ["transition", "durationSec"], message: "cut requires zero transition" });
  }
  return issues;
}
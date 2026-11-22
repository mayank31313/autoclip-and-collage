import type { SlideshowSpec } from "@/lib/schemas/slideshow";
import {
  SLIDESHOW_MAX_DURATION_SEC,
  SLIDESHOW_MAX_SLIDE_SEC,
  SLIDESHOW_MAX_TRANSITION_SEC,
} from "@/lib/planner/slideshow/defaults";

export interface SlideshowIssue {
  path: readonly (string | number)[];
  message: string;
}

const DURATION_EPSILON_SEC = 1e-6;

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
    if (slide.durationSec > SLIDESHOW_MAX_SLIDE_SEC) {
      issues.push({
        path: ["slides", index, "durationSec"],
        message: `durationSec must not exceed ${SLIDESHOW_MAX_SLIDE_SEC}s`,
      });
    }
  }
  if (spec.transition.type === "cut" && spec.transition.durationSec !== 0) {
    issues.push({ path: ["transition", "durationSec"], message: "cut requires zero transition" });
  }
  if (spec.transition.durationSec > SLIDESHOW_MAX_TRANSITION_SEC) {
    issues.push({
      path: ["transition", "durationSec"],
      message: `transition durationSec must not exceed ${SLIDESHOW_MAX_TRANSITION_SEC}s`,
    });
  }
  if (spec.masterDurationSec > SLIDESHOW_MAX_DURATION_SEC) {
    issues.push({
      path: ["masterDurationSec"],
      message: `masterDurationSec must not exceed ${SLIDESHOW_MAX_DURATION_SEC}s`,
    });
  }
  return issues;
}

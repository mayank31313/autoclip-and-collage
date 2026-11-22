import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planSlideshowTimeline } from "@/lib/planner/slideshow/plan";

describe("slideshow timeline", () => {
  it("is deterministic and calculates overlap duration", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.float({ min: 1, max: 30, noNaN: true }),
        fc.constantFrom("cut", "fade", "wipe"),
        (count, duration, transition) => {
          const sources = Array.from({ length: count }, (_, id) => ({
            assetId: `asset-${id}`,
            kind: "image" as const,
            durationSec: duration,
            fit: "cover" as const,
          }));
          const input = {
            canvas: "16:9" as const,
            fps: 30 as const,
            transition,
            transitionSec: transition === "cut" ? 0 : 0.5,
            sources,
          };
          const a = planSlideshowTimeline(input);
          const b = planSlideshowTimeline(input);
          expect(a).toEqual(b);
          expect(a.slides).toHaveLength(count);
          expect(new Set(a.slides.map((slide) => slide.assetId)).size).toBe(count);
          const transitionOverlap = transition === "cut" ? 0 : 0.5 * (count - 1);
          expect(a.masterDurationSec).toBeCloseTo(duration * count - transitionOverlap, 5);
        },
      ),
    );
  });
});

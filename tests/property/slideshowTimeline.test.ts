import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planSlideshowTimeline } from "@/lib/planner/slideshow/plan";
import { validateSlideshowSpec } from "@/lib/planner/slideshow/validate";

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

  it("accepts a fade/wipe transition kept within the overlap bounds and keeps master duration consistent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.float({ min: Math.fround(2), max: Math.fround(10), noNaN: true }),
        fc.constantFrom("fade", "wipe"),
        (count, duration, transition) => {
          // Half of the shortest (middle) slide's duration is always a safe upper bound.
          const transitionSec = Math.min(duration / 2.5, 1);
          const sources = Array.from({ length: count }, (_, id) => ({
            assetId: `asset-${id}`,
            kind: "image" as const,
            durationSec: duration,
            fit: "cover" as const,
          }));
          const spec = planSlideshowTimeline({
            canvas: "16:9",
            fps: 30,
            transition,
            transitionSec,
            sources,
          });
          expect(validateSlideshowSpec(spec)).toHaveLength(0);
          const overlap = transitionSec * (count - 1);
          expect(spec.masterDurationSec).toBeCloseTo(duration * count - overlap, 5);
        },
      ),
    );
  });

  it("rejects a fade/wipe transition that is not shorter than every slide's duration", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.float({ min: Math.fround(0.5), max: Math.fround(5), noNaN: true }),
        fc.constantFrom("fade", "wipe"),
        (count, duration, transition) => {
          const sources = Array.from({ length: count }, (_, id) => ({
            assetId: `asset-${id}`,
            kind: "image" as const,
            durationSec: duration,
            fit: "cover" as const,
          }));
          // A transition at least as long as every slide must always be rejected.
          const spec = planSlideshowTimeline({
            canvas: "16:9",
            fps: 30,
            transition,
            transitionSec: duration,
            sources,
          });
          expect(validateSlideshowSpec(spec).length).toBeGreaterThan(0);
        },
      ),
    );
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { POLAROID_MAX_ROTATION_DEG } from "@/lib/planner/collage/polaroid/defaults";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";

const MAX_IMAGES = 20;
const MAX_PER_SLIDE = 6;

const planInput = fc.integer({ min: 2, max: 10 }).chain((slideCount) =>
  fc
    .integer({ min: slideCount, max: Math.min(MAX_IMAGES, slideCount * MAX_PER_SLIDE) })
    .chain((count) =>
      fc.record({
        slideCount: fc.constant(slideCount),
        slideAspect: fc.constantFrom("4:5" as const, "1:1" as const),
        ids: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: count,
          maxLength: count,
        }),
      }),
    ),
);

const toInput = (p: { slideCount: number; slideAspect: "4:5" | "1:1"; ids: string[] }) => ({
  slideCount: p.slideCount,
  slideAspect: p.slideAspect,
  images: p.ids.map((assetId) => ({ assetId, caption: "" })),
});

describe("planPolaroidCarousel (property)", () => {
  it("yields a valid spec: inside the spread, bounded overlap, every slide used", () => {
    // Planning parses the spec, so a thrown error means an invariant (bounds, overlap, slides) broke.
    fc.assert(
      fc.property(planInput, (p) => {
        const spec = planPolaroidCarousel(toInput(p));
        expect(spec.polaroids).toHaveLength(p.ids.length);
        expect(spec.spread.w).toBe(spec.slide.w * p.slideCount);
      }),
      { numRuns: 60 },
    );
  });

  it("uses each image exactly once and keeps tilt within the limit", () => {
    fc.assert(
      fc.property(planInput, (p) => {
        const spec = planPolaroidCarousel(toInput(p));
        expect(spec.polaroids.map((x) => x.image)).toEqual(p.ids);
        for (const item of spec.polaroids) {
          expect(Math.abs(item.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_ROTATION_DEG);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(planInput, (p) => {
        expect(planPolaroidCarousel(toInput(p))).toEqual(planPolaroidCarousel(toInput(p)));
      }),
      { numRuns: 30 },
    );
  });
});

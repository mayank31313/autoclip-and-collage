import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_SLIDE_SIZES,
  type PolaroidSlideSize,
} from "@/lib/planner/collage/polaroid/defaults";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import { POLAROID_TEMPLATE_IDS } from "@/lib/planner/collage/polaroid/templates";

const MAX_PER_SLIDE = 6;

const planInput = fc
  .integer({ min: 2, max: 10 })
  .chain((slideCount) =>
    fc.record({
      slideCount: fc.constant(slideCount),
      counts: fc.array(fc.integer({ min: 1, max: MAX_PER_SLIDE }), {
        minLength: slideCount,
        maxLength: slideCount,
      }),
      sizes: fc.array(fc.constantFrom(...POLAROID_SLIDE_SIZES), {
        minLength: slideCount,
        maxLength: slideCount,
      }),
      slideAspect: fc.constantFrom("4:5" as const, "1:1" as const),
      template: fc.constantFrom(...POLAROID_TEMPLATE_IDS),
    }),
  )
  .chain((p) => {
    const total = p.counts.reduce((sum, n) => sum + n, 0);
    return fc
      .tuple(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: total,
          maxLength: total,
        }),
        // Covers portrait, landscape and panoramas beyond the window's aspect range.
        fc.array(fc.double({ min: 0.2, max: 5, noNaN: true }), {
          minLength: total,
          maxLength: total,
        }),
      )
      .map(([ids, aspects]) => ({ ...p, ids, aspects }));
  });

const toInput = (p: {
  slideCount: number;
  counts: number[];
  sizes: PolaroidSlideSize[];
  slideAspect: "4:5" | "1:1";
  template: (typeof POLAROID_TEMPLATE_IDS)[number];
  ids: string[];
  aspects: number[];
}) => ({
  slideCount: p.slideCount,
  slideAspect: p.slideAspect,
  template: p.template,
  imagesPerSlide: p.counts,
  slideSizes: p.sizes,
  images: p.ids.map((assetId, i) => ({ assetId, caption: "", aspect: p.aspects[i] })),
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

  it("puts exactly the requested number of polaroid centres on each slide", () => {
    fc.assert(
      fc.property(planInput, (p) => {
        const spec = planPolaroidCarousel(toInput(p));
        const perSlide = p.counts.map(() => 0);
        for (const item of spec.polaroids) {
          perSlide[Math.floor((item.x + item.w / 2) / spec.slide.w)]++;
        }
        expect(perSlide).toEqual(p.counts);
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

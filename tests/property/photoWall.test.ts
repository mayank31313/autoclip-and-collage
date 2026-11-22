import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rotatedBounds } from "@/lib/planner/collage/polaroid/geometry";
import { planPhotoWall } from "@/lib/planner/collage/photoWall";
import { PhotoWallSpec } from "@/lib/schemas/photoWall";

describe("photo wall planning", () => {
  it("plans distinct wall presets with different backgrounds and arrangements", () => {
    const images = Array.from({ length: 6 }, (_, i) => ({
      assetId: `image-${i}`,
      widthPx: 1000,
      heightPx: 1000,
      pixelCount: 1_000_000,
    }));
    const canvas = { w: 1080, h: 1080, gap: 12, bg: "#ffffff" };
    const presets = ["warm", "gallery", "midnight", "scrapbook"] as const;
    const plans = presets.map((preset) => planPhotoWall({ canvas, images, preset }));
    expect(new Set(plans.map((plan) => plan.canvas.bg)).size).toBe(4);
    expect(new Set(plans.map((plan) => JSON.stringify(plan.items))).size).toBe(4);
    for (const plan of plans) expect(PhotoWallSpec.safeParse(plan).success).toBe(true);
  });

  it("varies print sizes and positions instead of forming a uniform grid", () => {
    const images = Array.from({ length: 6 }, (_, i) => ({
      assetId: `image-${i}`,
      widthPx: 1000,
      heightPx: 1000,
      pixelCount: 1_000_000,
    }));
    const plan = planPhotoWall({ canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" }, images });
    expect(new Set(plan.items.map((item) => item.w)).size).toBeGreaterThan(1);
    expect(new Set(plan.items.slice(0, 3).map((item) => item.y + item.h / 2)).size).toBeGreaterThan(
      2,
    );
    expect(
      new Set(plan.items.map((item) => Math.round((item.x + item.w / 2) / 100))).size,
    ).toBeGreaterThan(2);
  });

  it("rejects a plan that would hide one print behind another", () => {
    const item = { x: 30, y: 30, w: 40, h: 40, rotationDeg: 0 };
    const spec = {
      version: 1,
      canvas: { w: 100, h: 100, bg: "#ffffff" },
      items: [
        { ...item, image: "a" },
        { ...item, image: "b" },
      ],
    };
    expect(PhotoWallSpec.safeParse(spec).success).toBe(false);
  });

  it("fits twenty mixed-aspect photos on a small square-ish canvas", () => {
    const images = Array.from({ length: 20 }, (_, i) => ({
      assetId: `image-${i}`,
      widthPx: i % 2 ? 800 : 1200,
      heightPx: i % 2 ? 1200 : 800,
      pixelCount: 960000,
    }));
    expect(
      planPhotoWall({ canvas: { w: 200, h: 208, gap: 12, bg: "#ffffff" }, images }).items,
    ).toHaveLength(20);
  });

  it("keeps every uniquely assigned tilted print inside the canvas without obscuring another", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.constantFrom("warm", "gallery", "midnight", "scrapbook"),
        (count, w, h, preset) => {
          const images = Array.from({ length: count }, (_, i) => ({
            assetId: `image-${i}`,
            widthPx: i % 2 ? 800 : 1200,
            heightPx: i % 2 ? 1200 : 800,
            pixelCount: 960000,
          }));
          const input = { canvas: { w, h, gap: 12, bg: "#ffffff" }, images, preset };
          const plan = planPhotoWall(input);
          expect(planPhotoWall(input)).toEqual(plan);
          expect(plan.items.map((item) => item.image)).toEqual(
            images.map((image) => image.assetId),
          );
          for (const [index, item] of plan.items.entries()) {
            const bounds = rotatedBounds(item);
            expect(bounds.x0).toBeGreaterThanOrEqual(0);
            expect(bounds.y0).toBeGreaterThanOrEqual(0);
            expect(bounds.x1).toBeLessThanOrEqual(w);
            expect(bounds.y1).toBeLessThanOrEqual(h);
            for (const other of plan.items.slice(index + 1)) {
              const b = rotatedBounds(other);
              expect(
                bounds.x1 <= b.x0 || b.x1 <= bounds.x0 || bounds.y1 <= b.y0 || b.y1 <= bounds.y0,
              ).toBe(true);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

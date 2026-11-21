import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planGridCollage } from "@/lib/planner/collage/plan";
import { LayoutSpec } from "@/lib/schemas/layout";

const dimensions = fc.array(
  fc.record({
    widthPx: fc.integer({ min: 1, max: 6000 }),
    heightPx: fc.integer({ min: 1, max: 6000 }),
  }),
  { minLength: 1, maxLength: 20 },
);

function toImages(dims: { widthPx: number; heightPx: number }[]) {
  return dims.map(({ widthPx, heightPx }, i) => ({
    assetId: `a${i}`,
    widthPx,
    heightPx,
    pixelCount: widthPx * heightPx,
  }));
}

describe("planGridCollage (property)", () => {
  it("builds valid, unique, deterministic justified layouts", () => {
    fc.assert(
      fc.property(
        dimensions,
        fc.integer({ min: 200, max: 8192 }),
        fc.integer({ min: 200, max: 8192 }),
        fc.constantFrom(0, 12),
        (dims, w, h, gap) => {
          const input = {
            canvas: { w, h, gap, bg: "#ffffff" },
            images: toImages(dims),
            style: "justified" as const,
          };
          const layout = planGridCollage(input);
          expect(LayoutSpec.safeParse(layout).success).toBe(true);
          expect(layout.cells).toHaveLength(dims.length);
          expect(new Set(layout.cells.map((c) => c.id)).size).toBe(dims.length);
          expect(planGridCollage(input)).toEqual(layout);
        },
      ),
    );
  });

  it("fills each justified row to the canvas width within 1 px", () => {
    fc.assert(
      fc.property(dimensions, fc.integer({ min: 200, max: 4000 }), (dims, w) => {
        const layout = planGridCollage({
          canvas: { w, h: 1350, gap: 12, bg: "#ffffff" },
          images: toImages(dims),
          style: "justified",
        });
        const rights = new Map<number, number>();
        for (const c of layout.cells) {
          rights.set(c.y, Math.max(rights.get(c.y) ?? 0, c.x + c.w));
        }
        for (const right of rights.values()) {
          expect(Math.abs(right - w)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("builds valid rectangular layouts for any count", () => {
    fc.assert(
      fc.property(dimensions, (dims) => {
        const layout = planGridCollage({
          canvas: { w: 1080, h: 1350, gap: 12, bg: "#ffffff" },
          images: toImages(dims),
          style: "template",
          template: "rectangular",
        });
        expect(LayoutSpec.safeParse(layout).success).toBe(true);
        expect(layout.cells).toHaveLength(dims.length);
      }),
    );
  });
});

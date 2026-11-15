import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateLayout } from "@/lib/planner/collage/validate";

const canvas = { w: 200, h: 200 };

describe("validateLayout (property)", () => {
  it("accepts any grid of disjoint cells inside the canvas", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (cols, rows) => {
        const w = Math.floor(canvas.w / cols);
        const h = Math.floor(canvas.h / rows);
        const cells = Array.from({ length: cols * rows }, (_, i) => ({
          id: i,
          x: (i % cols) * w,
          y: Math.floor(i / cols) * h,
          w,
          h,
          image: null,
        }));
        expect(validateLayout({ canvas, cells })).toEqual([]);
      }),
    );
  });

  it("flags any pair of cells that share area", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        (x, y, dx, dy) => {
          const a = { id: 0, x, y, w: 100, h: 100, image: null };
          const b = { id: 1, x: x + dx, y: y + dy, w: 100, h: 100, image: null };
          const issues = validateLayout({ canvas: { w: 400, h: 400 }, cells: [a, b] });
          expect(issues.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("is deterministic", () => {
    const cells = [{ id: 0, x: 0, y: 0, w: 300, h: 10, image: null }];
    expect(validateLayout({ canvas, cells })).toEqual(validateLayout({ canvas, cells }));
  });
});

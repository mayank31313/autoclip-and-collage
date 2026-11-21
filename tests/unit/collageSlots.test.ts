import { describe, expect, it } from "vitest";
import { generateJustifiedSlots } from "@/lib/planner/collage/grid/justifiedRows";
import { generateTemplateSlots } from "@/lib/planner/collage/grid/templates";
import type { CanvasSize, ImageStats, Slot } from "@/lib/planner/collage/grid/types";
import { planGridCollage } from "@/lib/planner/collage/plan";
import { validateLayout } from "@/lib/planner/collage/validate";

const canvases: CanvasSize[] = [
  { w: 1080, h: 1350 },
  { w: 1080, h: 1080 },
  { w: 1920, h: 1080 },
];
const gaps = [0, 12];

function image(i: number): ImageStats {
  const widthPx = [4000, 3000, 2000, 1500, 6000][i % 5];
  const heightPx = [3000, 4000, 2000, 3000, 1000][i % 5];
  return { assetId: `a${i}`, widthPx, heightPx, pixelCount: widthPx * heightPx };
}

function images(count: number): ImageStats[] {
  return Array.from({ length: count }, (_, i) => image(i));
}

function expectValid(slots: Slot[], canvas: CanvasSize, count: number) {
  expect(slots).toHaveLength(count);
  expect(new Set(slots.map((s) => s.id)).size).toBe(count);
  expect(slots.map((s) => s.order)).toEqual(slots.map((_, i) => i));
  expect(validateLayout({ canvas, cells: slots.map((s) => ({ ...s, image: null })) })).toEqual([]);
  for (const s of slots) {
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
  }
}

function rowsOf(slots: Slot[]): Slot[][] {
  const byY = new Map<number, Slot[]>();
  for (const s of slots) byY.set(s.y, [...(byY.get(s.y) ?? []), s]);
  return [...byY.values()];
}

describe("generateJustifiedSlots", () => {
  it("covers the whole canvas for one image", () => {
    const slots = generateJustifiedSlots({ w: 800, h: 600 }, images(1), 12);
    expect(slots).toEqual([{ id: 0, x: 0, y: 0, w: 800, h: 600, order: 0, hero: false }]);
  });

  it.each(canvases.flatMap((c) => gaps.map((g) => [c, g] as const)))(
    "produces valid rows filling the width for 1-20 images (%o gap %i)",
    (canvas, gap) => {
      for (let n = 1; n <= 20; n++) {
        const slots = generateJustifiedSlots(canvas, images(n), gap);
        expectValid(slots, canvas, n);
        for (const row of rowsOf(slots)) {
          const right = Math.max(...row.map((s) => s.x + s.w));
          expect(Math.abs(right - canvas.w)).toBeLessThanOrEqual(1);
        }
        const last = slots[slots.length - 1];
        expect(last.y + last.h).toBe(canvas.h);
      }
    },
  );

  it("uses round(sqrt(n / aspect)) rows split in upload order, earlier rows larger", () => {
    const slots = generateJustifiedSlots({ w: 1000, h: 1000 }, images(7), 0);
    expect(rowsOf(slots).map((r) => r.length)).toEqual([3, 2, 2]);
    expect(slots.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("sizes cells proportionally to aspect ratio and gives remainder left-to-right", () => {
    const wide = { assetId: "w", widthPx: 2000, heightPx: 1000, pixelCount: 2e6 };
    const tall = { assetId: "t", widthPx: 1000, heightPx: 2000, pixelCount: 2e6 };
    const [a, b] = generateJustifiedSlots({ w: 1000, h: 400 }, [wide, tall], 10);
    expect(a.w + b.w + 10).toBe(1000);
    expect(a.w / b.w).toBeGreaterThan(3.9);
    expect(a.w / b.w).toBeLessThan(4.1);
  });

  it("is deterministic", () => {
    const run = () => generateJustifiedSlots(canvases[0], images(13), 12);
    expect(run()).toEqual(run());
  });

  it("rejects canvases too small for positive cells", () => {
    expect(() => generateJustifiedSlots({ w: 10, h: 10 }, images(4), 12)).toThrow(RangeError);
    expect(() => generateJustifiedSlots({ w: 100, h: 100 }, [], 0)).toThrow(RangeError);
  });
});

describe("generateTemplateSlots", () => {
  it.each(canvases.flatMap((c) => gaps.map((g) => [c, g] as const)))(
    "builds valid curated templates (%o gap %i)",
    (canvas, gap) => {
      expectValid(generateTemplateSlots(canvas, 4, "grid-2x2", gap), canvas, 4);
      expectValid(generateTemplateSlots(canvas, 9, "grid-3x3", gap), canvas, 9);
      expectValid(generateTemplateSlots(canvas, 5, "hero-4", gap), canvas, 5);
    },
  );

  it("builds equal 2x2 cells with exact geometry", () => {
    const slots = generateTemplateSlots({ w: 100, h: 100 }, 4, "grid-2x2", 10);
    expect(slots.map(({ x, y, w, h }) => [x, y, w, h])).toEqual([
      [0, 0, 45, 45],
      [55, 0, 45, 45],
      [0, 55, 45, 45],
      [55, 55, 45, 45],
    ]);
  });

  it("places the hero cell on the left for landscape canvases", () => {
    const slots = generateTemplateSlots({ w: 1000, h: 500 }, 5, "hero-4", 10);
    expect(slots[0]).toMatchObject({ x: 0, y: 0, w: 495, h: 500, hero: true });
    expect(slots.slice(1).every((s) => !s.hero && s.x >= 505)).toBe(true);
  });

  it("places the hero cell on top for portrait and square canvases", () => {
    for (const canvas of [
      { w: 1000, h: 1500 },
      { w: 1000, h: 1000 },
    ]) {
      const slots = generateTemplateSlots(canvas, 5, "hero-4", 10);
      expect(slots[0]).toMatchObject({ x: 0, y: 0, w: 1000, hero: true });
      expect(slots[0].h).toBe(Math.ceil((canvas.h - 10) / 2));
      expect(slots.slice(1).every((s) => s.y >= slots[0].h + 10)).toBe(true);
    }
  });

  it.each(canvases.flatMap((c) => gaps.map((g) => [c, g] as const)))(
    "rectangular covers 1-20 images with equal-width rows (%o gap %i)",
    (canvas, gap) => {
      for (let n = 1; n <= 20; n++) {
        const slots = generateTemplateSlots(canvas, n, "rectangular", gap);
        expectValid(slots, canvas, n);
        for (const row of rowsOf(slots)) {
          const widths = row.map((s) => s.w);
          expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
          expect(Math.max(...row.map((s) => s.x + s.w))).toBe(canvas.w);
        }
      }
    },
  );

  it("rejects wrong counts for curated templates and tiny canvases", () => {
    expect(() => generateTemplateSlots(canvases[0], 5, "grid-2x2", 12)).toThrow(RangeError);
    expect(() => generateTemplateSlots(canvases[0], 8, "grid-3x3", 12)).toThrow(RangeError);
    expect(() => generateTemplateSlots(canvases[0], 4, "hero-4", 12)).toThrow(RangeError);
    expect(() => generateTemplateSlots({ w: 20, h: 20 }, 5, "hero-4", 12)).toThrow(RangeError);
  });
});

describe("planGridCollage", () => {
  const canvas = { w: 1080, h: 1080, gap: 12, bg: "#ffffff" };

  it("returns a validated grid spec with empty cells", () => {
    const layout = planGridCollage({
      canvas,
      images: images(5),
      style: "template",
      template: "hero-4",
    });
    expect(layout).toMatchObject({ version: 1, mode: "grid", style: "template", canvas });
    expect(layout.cells.every((c) => c.image === null && !c.pinned)).toBe(true);
  });

  it("requires a template for template style", () => {
    expect(() => planGridCollage({ canvas, images: images(4), style: "template" })).toThrow();
  });

  it("does not let a curated template accept a single image", () => {
    expect(() =>
      planGridCollage({ canvas, images: images(1), style: "template", template: "grid-2x2" }),
    ).toThrow(RangeError);
  });
});

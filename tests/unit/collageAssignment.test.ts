import { describe, expect, it } from "vitest";
import { assignImagesToSlots, coverCropFraction } from "@/lib/planner/collage/assign";
import type { ImageStats, Slot } from "@/lib/planner/collage/grid/types";
import { solveAssignment } from "@/lib/planner/collage/hungarian";
import { planGridCollage } from "@/lib/planner/collage/plan";

function pairs(costs: number[][]) {
  return solveAssignment(costs).map(({ row, column }) => [row, column]);
}

function img(assetId: string, widthPx: number, heightPx: number): ImageStats {
  return { assetId, widthPx, heightPx, pixelCount: widthPx * heightPx };
}

function slot(id: number, w: number, h: number, hero = false): Slot {
  return { id, x: id * 1000, y: 0, w, h, order: id, hero };
}

describe("solveAssignment", () => {
  it("finds the minimum-cost square assignment", () => {
    expect(
      pairs([
        [4, 1],
        [2, 3],
      ]),
    ).toEqual([
      [0, 1],
      [1, 0],
    ]);
    const result = solveAssignment([
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ]);
    expect(result.map((a) => a.column)).toEqual([1, 0, 2]);
    expect(result.map((a) => a.cost)).toEqual([1, 2, 2]);
  });

  it("returns assignments ordered by row with the original costs", () => {
    const result = solveAssignment([
      [10, 19, 8, 15],
      [10, 18, 7, 17],
      [13, 16, 9, 14],
      [12, 19, 8, 18],
    ]);
    expect(result.map((a) => a.row)).toEqual([0, 1, 2, 3]);
    expect(result.reduce((sum, a) => sum + a.cost, 0)).toBe(49);
  });

  it("handles more columns than rows", () => {
    expect(
      pairs([
        [5, 1, 9],
        [5, 9, 2],
      ]),
    ).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("handles more rows than columns, leaving the costliest row unassigned", () => {
    expect(pairs([[3], [1], [2]])).toEqual([[1, 0]]);
  });

  it("returns nothing for empty matrices", () => {
    expect(solveAssignment([])).toEqual([]);
    expect(solveAssignment([[], []])).toEqual([]);
  });

  it("breaks ties toward the identity deterministically", () => {
    expect(
      pairs([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("rejects ragged and non-finite matrices", () => {
    expect(() => solveAssignment([[1, 2], [3]])).toThrow(/ragged/i);
    expect(() => solveAssignment([[1, Number.NaN]])).toThrow(/finite/i);
    expect(() => solveAssignment([[Number.POSITIVE_INFINITY]])).toThrow(/finite/i);
  });
});

describe("coverCropFraction", () => {
  it("is zero for equal aspects and grows with mismatch, symmetrically", () => {
    expect(coverCropFraction(2, 2)).toBe(0);
    expect(coverCropFraction(2, 1)).toBeCloseTo(0.5);
    expect(coverCropFraction(1, 2)).toBeCloseTo(0.5);
    expect(coverCropFraction(4, 1)).toBeGreaterThan(coverCropFraction(2, 1));
  });
});

describe("assignImagesToSlots", () => {
  it("places each image in the slot matching its aspect ratio", () => {
    const images = [img("wide", 4000, 2000), img("tall", 2000, 4000), img("square", 3000, 3000)];
    const slots = [slot(0, 1000, 1000), slot(1, 500, 1000), slot(2, 1000, 500)];
    const cells = assignImagesToSlots(images, slots);
    expect(cells.map((c) => c.image)).toEqual(["square", "tall", "wide"]);
  });

  it("gives the hero slot the highest-resolution image when aspects tie", () => {
    const images = [img("small", 1000, 1000), img("big", 4000, 4000), img("mid", 2000, 2000)];
    const slots = [slot(0, 800, 800, true), slot(1, 400, 400), slot(2, 400, 400)];
    const cells = assignImagesToSlots(images, slots);
    expect(cells[0].image).toBe("big");
  });

  it("does not let the hero resolution preference override a far better aspect fit", () => {
    const images = [img("hugeTall", 4000, 12000), img("squareSmall", 1000, 1000)];
    const slots = [slot(0, 800, 800, true), slot(1, 300, 900)];
    const cells = assignImagesToSlots(images, slots);
    expect(cells.map((c) => c.image)).toEqual(["squareSmall", "hugeTall"]);
  });

  it("uses upload order as the tie-break for identical images", () => {
    const images = ["a", "b", "c", "d"].map((id) => img(id, 3000, 2000));
    const slots = [0, 1, 2, 3].map((i) => slot(i, 600, 400));
    expect(assignImagesToSlots(images, slots).map((c) => c.image)).toEqual(["a", "b", "c", "d"]);
  });

  it("emits schema-ready cells ordered by slot with no duplicate or missing images", () => {
    const images = [img("a", 3000, 1000), img("b", 1000, 3000), img("c", 2000, 2000)];
    const slots = [slot(0, 300, 100), slot(1, 100, 300), slot(2, 200, 200)];
    const cells = assignImagesToSlots(images, slots);
    expect(cells.map((c) => c.id)).toEqual([0, 1, 2]);
    expect(cells.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(cells.map((c) => c.image).sort()).toEqual(["a", "b", "c"]);
    expect(cells.every((c) => !c.pinned && c.focus[0] === 0.5 && c.focus[1] === 0.5)).toBe(true);
  });

  it("leaves surplus slots empty and rejects surplus images", () => {
    const slots = [slot(0, 100, 100), slot(1, 100, 100)];
    const cells = assignImagesToSlots([img("a", 10, 10)], slots);
    expect(cells.map((c) => c.image)).toEqual(["a", null]);
    expect(() => assignImagesToSlots([img("a", 1, 1), img("b", 1, 1)], [slot(0, 1, 1)])).toThrow(
      RangeError,
    );
  });
});

describe("planGridCollage assignment", () => {
  it("assigns every input image exactly once", () => {
    const images = [img("a", 4000, 3000), img("b", 3000, 4000), img("c", 2000, 2000)];
    const layout = planGridCollage({
      canvas: { w: 1080, h: 1350, gap: 12, bg: "#ffffff" },
      images,
      style: "justified",
    });
    expect(layout.cells.map((c) => c.image).sort()).toEqual(["a", "b", "c"]);
  });

  it("puts the highest-resolution image in the hero cell for hero-4", () => {
    const images = [1000, 1000, 1000, 1000, 5000].map((side, i) => img(`a${i}`, side, side));
    const layout = planGridCollage({
      canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
      images,
      style: "template",
      template: "hero-4",
    });
    expect(layout.cells[0].image).toBe("a4");
  });
});

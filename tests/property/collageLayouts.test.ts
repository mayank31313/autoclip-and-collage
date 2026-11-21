import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveAssignment } from "@/lib/planner/collage/hungarian";
import { planGridCollage } from "@/lib/planner/collage/plan";
import { LayoutSpec } from "@/lib/schemas/layout";

function bruteForceMinimum(costs: number[][]): number {
  const rows = costs.length;
  const columns = costs[0].length;
  const used = new Array<boolean>(columns).fill(false);
  const search = (row: number): number => {
    if (row === rows) return 0;
    let best = Number.POSITIVE_INFINITY;
    for (let c = 0; c < columns; c++) {
      if (used[c]) continue;
      used[c] = true;
      best = Math.min(best, costs[row][c] + search(row + 1));
      used[c] = false;
    }
    return best;
  };
  return search(0);
}

describe("solveAssignment (property)", () => {
  it("matches the brute-force minimum for rows <= columns", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain((rows) =>
          fc.integer({ min: rows, max: 6 }).chain((columns) =>
            fc.array(
              fc.array(fc.integer({ min: -20, max: 50 }), {
                minLength: columns,
                maxLength: columns,
              }),
              {
                minLength: rows,
                maxLength: rows,
              },
            ),
          ),
        ),
        (costs) => {
          const result = solveAssignment(costs);
          expect(result).toHaveLength(costs.length);
          expect(new Set(result.map((a) => a.column)).size).toBe(costs.length);
          expect(result.reduce((sum, a) => sum + a.cost, 0)).toBe(bruteForceMinimum(costs));
        },
      ),
    );
  });
});

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

  it("assigns each input image exactly once, deterministically", () => {
    fc.assert(
      fc.property(dimensions, fc.constantFrom("justified", "rectangular"), (dims, kind) => {
        const images = toImages(dims);
        const input =
          kind === "justified"
            ? {
                canvas: { w: 1080, h: 1350, gap: 12, bg: "#ffffff" },
                images,
                style: "justified" as const,
              }
            : {
                canvas: { w: 1080, h: 1350, gap: 12, bg: "#ffffff" },
                images,
                style: "template" as const,
                template: "rectangular" as const,
              };
        const layout = planGridCollage(input);
        const used = layout.cells.map((c) => c.image);
        expect([...used].sort()).toEqual(images.map((i) => i.assetId).sort());
        expect(new Set(layout.cells.map((c) => c.order)).size).toBe(dims.length);
        expect(planGridCollage(input)).toEqual(layout);
      }),
    );
  });

  it("assigns hero-4 and fixed-count grids exactly once", () => {
    const counts = { "grid-2x2": 4, "grid-3x3": 9, "hero-4": 5 } as const;
    fc.assert(
      fc.property(
        dimensions,
        fc.constantFrom("grid-2x2", "grid-3x3", "hero-4"),
        (dims, template) => {
          const images = toImages(
            Array.from({ length: counts[template] }, (_, i) => dims[i % dims.length]),
          );
          const layout = planGridCollage({
            canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
            images,
            style: "template",
            template,
          });
          expect(layout.cells.map((c) => c.image).sort()).toEqual(
            images.map((i) => i.assetId).sort(),
          );
        },
      ),
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

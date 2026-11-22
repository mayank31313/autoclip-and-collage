import { describe, expect, it } from "vitest";
import { generateDefinitionSlots } from "@/lib/planner/collage/grid/templates";
import { validateLayout } from "@/lib/planner/collage/validate";
import { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

const heroFour = {
  version: 1,
  id: "hero-4",
  name: "Hero + 4",
  cols: [2, 1, 1],
  rows: [1, 1],
  cells: [
    { col: 0, row: 0, rowSpan: 2, hero: true },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 1 },
  ],
};

function issues(value: unknown): string[] {
  const r = CollageTemplateDefinition.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("CollageTemplateDefinition", () => {
  it("accepts a valid template and defaults spans and hero", () => {
    const parsed = CollageTemplateDefinition.parse(heroFour);
    expect(parsed.cells[1]).toEqual({ col: 1, row: 0, colSpan: 1, rowSpan: 1, hero: false });
  });

  it("rejects cells outside the grid", () => {
    const cells = [{ col: 2, row: 0, colSpan: 2 }];
    expect(issues({ ...heroFour, cells })).toContain("cell 0 extends past the grid");
  });

  it("rejects overlapping cells", () => {
    const cells = [
      { col: 0, row: 0, rowSpan: 2 },
      { col: 0, row: 1 },
    ];
    expect(issues({ ...heroFour, cells })).toContain("cell 1 overlaps cell 0");
  });

  it("rejects more than one hero cell", () => {
    const cells = [
      { col: 0, row: 0, hero: true },
      { col: 1, row: 0, hero: true },
    ];
    expect(issues({ ...heroFour, cells })).toContain("at most one cell can be the hero");
  });

  it("rejects ids that are not lowercase slugs and the reserved rectangular id", () => {
    expect(issues({ ...heroFour, id: "Hero 4" })).not.toEqual([]);
    expect(issues({ ...heroFour, id: "rectangular" })).toContain("id rectangular is reserved");
  });

  it("rejects non-integer or non-positive track weights", () => {
    expect(issues({ ...heroFour, cols: [1.5, 1, 1] })).not.toEqual([]);
    expect(issues({ ...heroFour, rows: [0, 1] })).not.toEqual([]);
  });
});

describe("generateDefinitionSlots", () => {
  const template = CollageTemplateDefinition.parse(heroFour);

  it("converts track weights to exact pixel cells with gaps", () => {
    const slots = generateDefinitionSlots({ w: 1012, h: 500 }, template, 12);
    expect(slots.map(({ x, y, w, h, hero }) => [x, y, w, h, hero])).toEqual([
      [0, 0, 494, 500, true],
      [506, 0, 247, 244, false],
      [765, 0, 247, 244, false],
      [506, 256, 247, 244, false],
      [765, 256, 247, 244, false],
    ]);
    expect(slots.map((s) => [s.id, s.order])).toEqual([0, 1, 2, 3, 4].map((i) => [i, i]));
  });

  it("produces valid layouts on square and portrait canvases", () => {
    for (const canvas of [
      { w: 1080, h: 1080 },
      { w: 1080, h: 1350 },
    ]) {
      const slots = generateDefinitionSlots(canvas, template, 12);
      expect(validateLayout({ canvas, cells: slots.map((s) => ({ ...s, image: null })) })).toEqual(
        [],
      );
    }
  });

  it("rejects canvases too small for positive tracks", () => {
    expect(() => generateDefinitionSlots({ w: 20, h: 20 }, template, 12)).toThrow(RangeError);
  });
});

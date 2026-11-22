import { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

/** An equal `cols` x `rows` grid template, cells in reading order. */
export function gridTemplate(cols: number, rows: number, id = `grid-${cols}x${rows}`) {
  const cells = Array.from({ length: cols * rows }, (_, i) => ({
    col: i % cols,
    row: Math.floor(i / cols),
  }));
  return CollageTemplateDefinition.parse({
    version: 1,
    id,
    name: id,
    cols: Array.from({ length: cols }, () => 1),
    rows: Array.from({ length: rows }, () => 1),
    cells,
  });
}

/** Hero on the left half spanning both rows, with a 2x2 group beside it. */
export const heroFourTemplate = CollageTemplateDefinition.parse({
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
});

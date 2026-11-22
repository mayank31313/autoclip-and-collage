import { z } from "zod";

/** Reserved for the built-in any-count layout; file templates cannot use it. */
export const RECTANGULAR_TEMPLATE_ID = "rectangular";
export const TEMPLATE_MAX_TRACKS = 12;
export const TEMPLATE_MAX_WEIGHT = 100;
export const TEMPLATE_MAX_CELLS = TEMPLATE_MAX_TRACKS * TEMPLATE_MAX_TRACKS;

export const TemplateId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug like hero-4");

const TrackWeights = z
  .array(z.number().int().min(1).max(TEMPLATE_MAX_WEIGHT))
  .min(1)
  .max(TEMPLATE_MAX_TRACKS);

const span = z.number().int().min(1).max(TEMPLATE_MAX_TRACKS).default(1);

/** One cell in grid-track units: column/row index plus how many tracks it spans. */
export const TemplateCell = z.object({
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  colSpan: span,
  rowSpan: span,
  hero: z.boolean().default(false),
});
export type TemplateCell = z.infer<typeof TemplateCell>;

type Cell = z.infer<typeof TemplateCell>;

function overlaps(a: Cell, b: Cell): boolean {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

function checkCells(ctx: z.RefinementCtx, t: { cols: number[]; rows: number[]; cells: Cell[] }) {
  for (const [i, c] of t.cells.entries()) {
    if (c.col + c.colSpan > t.cols.length || c.row + c.rowSpan > t.rows.length) {
      ctx.addIssue({
        code: "custom",
        path: ["cells", i],
        message: `cell ${i} extends past the grid`,
      });
    }
    const j = t.cells.slice(0, i).findIndex((other) => overlaps(other, c));
    if (j >= 0) {
      ctx.addIssue({ code: "custom", path: ["cells", i], message: `cell ${i} overlaps cell ${j}` });
    }
  }
  if (t.cells.filter((c) => c.hero).length > 1) {
    ctx.addIssue({ code: "custom", path: ["cells"], message: "at most one cell can be the hero" });
  }
}

/**
 * A collage template as a weighted grid: `cols`/`rows` are relative track sizes and each
 * cell (in reading order) spans whole tracks. The template takes exactly `cells.length` images.
 */
export const CollageTemplateDefinition = z
  .object({
    version: z.literal(1),
    id: TemplateId,
    name: z.string().trim().min(1).max(80),
    description: z.string().max(200).optional(),
    cols: TrackWeights,
    rows: TrackWeights,
    cells: z.array(TemplateCell).min(1).max(TEMPLATE_MAX_CELLS),
  })
  .superRefine((t, ctx) => {
    if (t.id === RECTANGULAR_TEMPLATE_ID) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "id rectangular is reserved" });
    }
    checkCells(ctx, t);
  });
export type CollageTemplateDefinition = z.infer<typeof CollageTemplateDefinition>;

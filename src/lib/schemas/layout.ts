import { z } from "zod";
import { validateLayout } from "@/lib/planner/collage/validate";

export const Cell = z.object({
  id: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  image: z.string().nullable(), // asset id or null if empty
  focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
  order: z.number().int().nonnegative(),
  pinned: z.boolean().default(false), // user override, solver must not move it
});
export type Cell = z.infer<typeof Cell>;

export const LayoutSpec = z
  .object({
    version: z.literal(1),
    canvas: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      gap: z.number().int().nonnegative().default(12),
      bg: z.string().default("#ffffff"),
    }),
    mode: z.enum(["grid", "sequence"]),
    style: z.enum(["template", "justified", "guillotine", "filmstrip", "timeline", "storyboard"]),
    cells: z.array(Cell),
  })
  .superRefine((spec, ctx) => {
    for (const issue of validateLayout(spec)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["cells", issue.cellId] });
    }
  });
export type LayoutSpec = z.infer<typeof LayoutSpec>;

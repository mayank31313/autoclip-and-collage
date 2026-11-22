import { z } from "zod";
import { rotatedBounds } from "@/lib/planner/collage/polaroid/geometry";

export const PhotoWallPreset = z.enum(["warm", "gallery", "midnight", "scrapbook"]);
export type PhotoWallPreset = z.infer<typeof PhotoWallPreset>;

export const PhotoWallItem = z.object({
  image: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  rotationDeg: z.number().min(-10).max(10),
});
export type PhotoWallItem = z.infer<typeof PhotoWallItem>;

export const PhotoWallSpec = z
  .object({
    version: z.literal(1),
    canvas: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    items: z.array(PhotoWallItem).min(1),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    const previous: ReturnType<typeof rotatedBounds>[] = [];
    for (const [index, item] of spec.items.entries()) {
      const bounds = rotatedBounds(item);
      if (seen.has(item.image)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "image"],
          message: "Duplicate image",
        });
      }
      seen.add(item.image);
      if (
        bounds.x0 < 0 ||
        bounds.y0 < 0 ||
        bounds.x1 > spec.canvas.w ||
        bounds.y1 > spec.canvas.h
      ) {
        ctx.addIssue({ code: "custom", path: ["items", index], message: "Print outside canvas" });
      }
      if (
        previous.some(
          (other) =>
            bounds.x0 < other.x1 &&
            bounds.x1 > other.x0 &&
            bounds.y0 < other.y1 &&
            bounds.y1 > other.y0,
        )
      ) {
        ctx.addIssue({ code: "custom", path: ["items", index], message: "Prints overlap" });
      }
      previous.push(bounds);
    }
  });
export type PhotoWallSpec = z.infer<typeof PhotoWallSpec>;

import { z } from "zod";
import { CollageTemplateDefinition, RECTANGULAR_TEMPLATE_ID } from "./collageTemplate";
import { PhotoWallPreset } from "./photoWall";

/** A resolved template: the built-in any-count layout or a weighted-grid definition. */
export const CollageTemplateSpec = z.union([
  z.literal(RECTANGULAR_TEMPLATE_ID),
  CollageTemplateDefinition,
]);
export type CollageTemplateSpec = z.infer<typeof CollageTemplateSpec>;

export const CollageStyle = z.enum(["justified", "template", "photo-wall"]);
export type CollageStyle = z.infer<typeof CollageStyle>;

export const CollageFormat = z.enum(["png", "jpeg"]);
export type CollageFormat = z.infer<typeof CollageFormat>;

export const COLLAGE_DEFAULT_GAP_PX = 12;
export const COLLAGE_DEFAULT_BG = "#ffffff";

export const CollageCanvas = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  gap: z.number().int().nonnegative().default(COLLAGE_DEFAULT_GAP_PX),
  bg: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be #RRGGBB")
    .default(COLLAGE_DEFAULT_BG),
});
export type CollageCanvas = z.infer<typeof CollageCanvas>;

/** Reports style/template consistency and template image-count violations on `ctx`. */
export function checkStyleTemplate(
  ctx: z.RefinementCtx,
  value: { style: CollageStyle; template?: CollageTemplateSpec | undefined },
  imageCount: number,
): void {
  const { style, template } = value;
  if (style !== "template" && template !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["template"],
      message: "template is only allowed with template style",
    });
    return;
  }
  if (style !== "template") return;
  if (template === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["template"],
      message: "template is required with template style",
    });
    return;
  }
  if (template === RECTANGULAR_TEMPLATE_ID) return;
  const required = template.cells.length;
  if (imageCount !== required) {
    ctx.addIssue({
      code: "custom",
      path: ["template"],
      message: `${template.id} requires exactly ${required} images`,
    });
  }
}

/** Reports the first repeated entry of `items` on `ctx` under `path`. */
export function checkUnique(ctx: z.RefinementCtx, items: string[], path: string, label: string) {
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    if (seen.has(item)) {
      ctx.addIssue({ code: "custom", path: [path, i], message: `duplicate ${label}` });
      return;
    }
    seen.add(item);
  }
}

export const CollageWorkerInput = z
  .object({
    sourceAssetIds: z.array(z.string().min(1)).min(1),
    style: CollageStyle,
    template: CollageTemplateSpec.optional(),
    photoWallPreset: PhotoWallPreset.optional(),
    canvas: CollageCanvas,
    format: CollageFormat,
  })
  .superRefine((input, ctx) => {
    checkUnique(ctx, input.sourceAssetIds, "sourceAssetIds", "asset ID");
    checkStyleTemplate(ctx, input, input.sourceAssetIds.length);
    if (input.style !== "photo-wall" && input.photoWallPreset !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["photoWallPreset"],
        message: "photoWallPreset requires photo-wall style",
      });
    }
  });
export type CollageWorkerInput = z.infer<typeof CollageWorkerInput>;

/** Internal worker result; the output asset ID is never exposed publicly. */
export const CollageWorkerResult = z.object({
  outputAssetId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: CollageFormat,
});
export type CollageWorkerResult = z.infer<typeof CollageWorkerResult>;

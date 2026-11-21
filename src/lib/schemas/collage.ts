import { z } from "zod";

export const CollageTemplateId = z.enum(["grid-2x2", "grid-3x3", "hero-4", "rectangular"]);
export type CollageTemplateId = z.infer<typeof CollageTemplateId>;

export const CollageStyle = z.enum(["justified", "template"]);
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

/** Exact image counts for curated templates; `rectangular` accepts any count. */
export const TEMPLATE_IMAGE_COUNTS = {
  "grid-2x2": 4,
  "grid-3x3": 9,
  "hero-4": 5,
} as const satisfies Partial<Record<CollageTemplateId, number>>;

/** Reports style/template consistency and curated-count violations on `ctx`. */
export function checkStyleTemplate(
  ctx: z.RefinementCtx,
  value: { style: CollageStyle; template?: CollageTemplateId | undefined },
  imageCount: number,
): void {
  const { style, template } = value;
  if (style === "justified" && template !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["template"],
      message: "template is not allowed with justified style",
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
  const required = template === "rectangular" ? undefined : TEMPLATE_IMAGE_COUNTS[template];
  if (required !== undefined && imageCount !== required) {
    ctx.addIssue({
      code: "custom",
      path: ["template"],
      message: `${template} requires exactly ${required} images`,
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
    template: CollageTemplateId.optional(),
    canvas: CollageCanvas,
    format: CollageFormat,
  })
  .superRefine((input, ctx) => {
    checkUnique(ctx, input.sourceAssetIds, "sourceAssetIds", "asset ID");
    checkStyleTemplate(ctx, input, input.sourceAssetIds.length);
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

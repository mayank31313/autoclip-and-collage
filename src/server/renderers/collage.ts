import sharp, { type OverlayOptions } from "sharp";
import { LayoutSpec } from "@/lib/schemas/layout";
import type { CollageFormat } from "@/lib/schemas/collage";
import { AppError } from "@/server/http/errors";

export interface RenderCollageArgs {
  layout: LayoutSpec;
  sourcePaths: ReadonlyMap<string, string>;
  outputPath: string;
  format: CollageFormat;
}

/**
 * Executes a validated layout: EXIF-rotates and cover-resizes each populated cell, then
 * composites onto the background. Cells are rendered sequentially to bound native memory.
 */
export async function renderCollage(args: RenderCollageArgs): Promise<void> {
  const layout = LayoutSpec.parse(args.layout);
  const { w, h, bg } = layout.canvas;
  const composites: OverlayOptions[] = [];
  for (const cell of layout.cells) {
    if (cell.image === null) continue;
    const sourcePath = args.sourcePaths.get(cell.image);
    if (sourcePath === undefined) {
      throw new AppError("INTERNAL", 500, "Missing source image for layout cell");
    }
    const input = await sharp(sourcePath)
      .rotate()
      .resize({ width: cell.w, height: cell.h, fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    composites.push({ input, left: cell.x, top: cell.y });
  }
  const canvas = sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite(
    composites,
  );
  if (args.format === "jpeg") {
    await canvas.flatten({ background: bg }).jpeg().toFile(args.outputPath);
  } else {
    await canvas.png().toFile(args.outputPath);
  }
}

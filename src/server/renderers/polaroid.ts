import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { CollageFormat } from "@/lib/schemas/collage";
import { PolaroidSpec } from "@/lib/schemas/polaroid";
import { AppError } from "@/server/http/errors";
import { renderPaper } from "./polaroidPaper";
import { renderPolaroid } from "./polaroidPrint";

export interface RenderPolaroidArgs {
  spec: PolaroidSpec;
  sourcePaths: ReadonlyMap<string, string>;
  fontPath: string;
  outputDir: string;
  format: CollageFormat;
}

const JPEG_QUALITY = 90;
const SLIDE_BACKGROUND = "#ffffff";

/**
 * Executes a validated spec: draws the paper, composites each polaroid sequentially (bounding
 * native memory), then cuts the spread into slides. Returns slide file paths in slide order.
 */
export async function renderPolaroidSlides(args: RenderPolaroidArgs): Promise<string[]> {
  const spec = PolaroidSpec.parse(args.spec);
  const sprites: OverlayOptions[] = [];
  for (const item of spec.polaroids) {
    const sourcePath = args.sourcePaths.get(item.image);
    if (sourcePath === undefined) {
      throw new AppError("INTERNAL", 500, "Missing source image for polaroid");
    }
    sprites.push(await renderPolaroid(item, sourcePath, args.fontPath));
  }
  const { data, info } = await sharp(await renderPaper(spec))
    .composite(sprites)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ext = args.format === "jpeg" ? "jpg" : "png";
  const paths: string[] = [];
  for (let s = 0; s < spec.slide.count; s++) {
    const file = path.join(args.outputDir, `slide-${String(s + 1).padStart(2, "0")}.${ext}`);
    const slide = sharp(data, {
      raw: { width: info.width, height: info.height, channels: 3 },
    }).extract({ left: s * spec.slide.w, top: 0, width: spec.slide.w, height: spec.slide.h });
    if (args.format === "jpeg") {
      await slide
        .flatten({ background: SLIDE_BACKGROUND })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(file);
    } else {
      await slide.png().toFile(file);
    }
    paths.push(file);
  }
  return paths;
}

import sharp, { type OverlayOptions } from "sharp";
import { framePieces } from "@/lib/planner/collage/polaroid/frame";
import type { CollageFormat } from "@/lib/schemas/collage";
import { PhotoWallSpec, type PhotoWallItem } from "@/lib/schemas/photoWall";
import { AppError } from "@/server/http/errors";
import { renderFitted } from "./fitImage";

const FRAME_COLOR = "#fffdf6";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function printSprite(item: PhotoWallItem, sourcePath: string) {
  const pad = Math.max(2, Math.ceil(Math.max(item.w, item.h) * 0.1));
  const width = item.w + pad * 2;
  const height = item.h + pad * 2;
  const { side, photoW, photoH } = framePieces(item.w, item.h);
  const photo = await renderFitted(sourcePath, photoW, photoH);
  const card = await sharp({
    create: { width: item.w, height: item.h, channels: 4, background: FRAME_COLOR },
  })
    .composite([{ input: photo, left: side, top: side }])
    .png()
    .toBuffer();
  const blur = Math.max(1, Math.round(pad / 4));
  const tapeW = Math.max(3, Math.round(item.w * 0.25));
  const tapeH = Math.max(2, Math.round(item.w * 0.075));
  const decoration = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<filter id="shadow"><feGaussianBlur stdDeviation="${blur}"/></filter>` +
      `<rect x="${pad + blur}" y="${pad + blur * 2}" width="${item.w}" height="${item.h}" fill="#624f42" opacity=".32" filter="url(#shadow)"/>` +
      `</svg>`,
  );
  const tape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tapeW}" height="${tapeH}">` +
      `<rect width="${tapeW}" height="${tapeH}" fill="#e5cfa5" opacity=".8"/></svg>`,
  );
  const flat = await sharp({ create: { width, height, channels: 4, background: TRANSPARENT } })
    .composite([
      { input: decoration, left: 0, top: 0 },
      { input: card, left: pad, top: pad },
      {
        input: tape,
        left: Math.round(pad + (item.w - tapeW) / 2),
        top: Math.max(0, pad - Math.floor(tapeH / 2)),
      },
    ])
    .png()
    .toBuffer();
  const { data, info } = await sharp(flat)
    .rotate(item.rotationDeg, { background: TRANSPARENT })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    left: Math.round(item.x + item.w / 2 - info.width / 2),
    top: Math.round(item.y + item.h / 2 - info.height / 2),
  };
}

export async function renderPhotoWall(args: {
  spec: PhotoWallSpec;
  sourcePaths: ReadonlyMap<string, string>;
  outputPath: string;
  format: CollageFormat;
}): Promise<void> {
  const spec = PhotoWallSpec.parse(args.spec);
  const overlays: OverlayOptions[] = [];
  for (const item of spec.items) {
    const sourcePath = args.sourcePaths.get(item.image);
    if (sourcePath === undefined)
      throw new AppError("INTERNAL", 500, "Missing source image for photo wall");
    const sprite = await printSprite(item, sourcePath);
    const left = Math.max(0, sprite.left);
    const top = Math.max(0, sprite.top);
    const cropLeft = left - sprite.left;
    const cropTop = top - sprite.top;
    const width = Math.min(sprite.width - cropLeft, spec.canvas.w - left);
    const height = Math.min(sprite.height - cropTop, spec.canvas.h - top);
    const input = await sharp(sprite.data)
      .extract({ left: cropLeft, top: cropTop, width, height })
      .png()
      .toBuffer();
    overlays.push({ input, left, top });
  }
  const image = sharp({
    create: {
      width: spec.canvas.w,
      height: spec.canvas.h,
      channels: 3,
      background: spec.canvas.bg,
    },
  }).composite(overlays);
  if (args.format === "jpeg") await image.jpeg().toFile(args.outputPath);
  else await image.png().toFile(args.outputPath);
}

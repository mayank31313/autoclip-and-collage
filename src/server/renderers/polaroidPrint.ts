import sharp, { type OverlayOptions } from "sharp";
import { framePieces } from "@/lib/planner/collage/polaroid/frame";
import type { PolaroidItem } from "@/lib/schemas/polaroid";
import { renderFitted } from "@/server/renderers/fitImage";

const FRAME_COLOR = "#fbfaf4";
const CAPTION_COLOR = "#2f3a52";
const CAPTION_FONT = "Caveat";
/** Transparent padding around the card so its shadow and tape fit before rotation. */
export const SPRITE_PAD_PX = 60;
const SHADOW = { dx: 3, dy: 8, blur: 9, opacity: 0.38 };
const CAPTION_HEIGHT_FRACTION = 0.7;
const TAPE = { w: 150, h: 70, color: "#f0e4a6", opacity: 0.72 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export interface PrintSprite {
  input: Buffer;
  left: number;
  top: number;
}

/** Pango markup treats & < > as syntax, so caption text must be escaped before rendering. */
export function escapeMarkup(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tapeSvg(angleDeg: number): Buffer {
  const { w, h, color, opacity } = TAPE;
  const x0 = 15;
  const x1 = w - 15;
  const y0 = 17;
  const y1 = h - 17;
  const zig = (x: number, dir: 1 | -1) =>
    [0, 1, 2, 3].map(
      (i) => `${x + (i % 2 === 0 ? 0 : 4 * dir)},${y0 + (i + 0.5) * ((y1 - y0) / 4)}`,
    );
  const points = [
    `${x0},${y0}`,
    `${x1},${y0}`,
    ...zig(x1, -1),
    `${x1},${y1}`,
    `${x0},${y1}`,
    ...zig(x0, 1).reverse(),
  ];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<g transform="rotate(${angleDeg} ${w / 2} ${h / 2})">` +
      `<polygon points="${points.join(" ")}" fill="${color}" fill-opacity="${opacity}"/></g></svg>`,
  );
}

function tapePlacement(item: PolaroidItem) {
  const pad = SPRITE_PAD_PX;
  if (item.tape === "left") return { cx: pad + item.w * 0.1, cy: pad + 6, angle: -38 };
  if (item.tape === "right") return { cx: pad + item.w * 0.9, cy: pad + 6, angle: 38 };
  return { cx: pad + item.w / 2, cy: pad + 4, angle: -3 };
}

async function renderCard(item: PolaroidItem, sourcePath: string, fontPath: string) {
  const { side, strip, photoW, photoH } = framePieces(item.w, item.h);
  const photo = await renderFitted(sourcePath, photoW, photoH);
  const layers: OverlayOptions[] = [{ input: photo, left: side, top: side }];
  if (item.caption.trim() !== "") {
    const { data, info } = await sharp({
      text: {
        text: `<span foreground="${CAPTION_COLOR}">${escapeMarkup(item.caption)}</span>`,
        font: CAPTION_FONT,
        fontfile: fontPath,
        rgba: true,
        align: "center",
        width: photoW,
        height: Math.round(strip * CAPTION_HEIGHT_FRACTION),
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: data,
      left: side + Math.round((photoW - info.width) / 2),
      top: side + photoH + Math.round((strip - info.height) / 2),
    });
  }
  return sharp({
    create: { width: item.w, height: item.h, channels: 4, background: FRAME_COLOR },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

function shadowSvg(width: number, height: number, item: PolaroidItem): Buffer {
  const { dx, dy, blur, opacity } = SHADOW;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>` +
      `<rect x="${SPRITE_PAD_PX + dx}" y="${SPRITE_PAD_PX + dy}" width="${item.w}" height="${item.h}" ` +
      `fill="#000" fill-opacity="${opacity}" filter="url(#b)"/></svg>`,
  );
}

/**
 * Draws one polaroid (photo, white frame, caption, shadow, tape), rotates it about its centre and
 * returns the sprite with the composite offset that keeps the frame centred where the spec says.
 */
export async function renderPolaroid(
  item: PolaroidItem,
  sourcePath: string,
  fontPath: string,
): Promise<PrintSprite> {
  const width = item.w + 2 * SPRITE_PAD_PX;
  const height = item.h + 2 * SPRITE_PAD_PX;
  const tape = tapePlacement(item);
  const flat = await sharp({
    create: { width, height, channels: 4, background: TRANSPARENT },
  })
    .composite([
      { input: shadowSvg(width, height, item), left: 0, top: 0 },
      {
        input: await renderCard(item, sourcePath, fontPath),
        left: SPRITE_PAD_PX,
        top: SPRITE_PAD_PX,
      },
      {
        input: tapeSvg(tape.angle),
        left: Math.round(tape.cx - TAPE.w / 2),
        top: Math.round(tape.cy - TAPE.h / 2),
      },
    ])
    .png()
    .toBuffer();
  const { data, info } = await sharp(flat)
    .rotate(item.rotationDeg, { background: TRANSPARENT })
    .png()
    .toBuffer({ resolveWithObject: true });
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return {
    input: data,
    left: Math.round(cx - info.width / 2),
    top: Math.round(cy - info.height / 2),
  };
}

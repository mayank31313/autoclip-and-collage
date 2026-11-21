import sharp, { type Raw } from "sharp";
import type { PolaroidSpec } from "@/lib/schemas/polaroid";
import { createRng } from "@/lib/utils/rng";

const PAGE_COLOR = "#efe2c4";
const RULE_COLOR = "#9fb7cf";
const HOLE_FILL = "#d8c8a0";
const HOLE_RING = "#a8946a";
const SHEET_COLOR = "#fbf7ea";
const SHEET_RIM_WIDTH_PX = 7;
const SHADOW_OFFSET_PX = { x: 8, y: 12 };
const SHADOW_BLUR_SIGMA = 9;
const SHADOW_OPACITY = 0.38;
const GRAIN_TILE_PX = 256;
/** Maximum alpha of a grain speck; fibres stay subtle so photos remain the focus. */
const GRAIN_MAX_ALPHA = 40;
const GRAIN_RGB = [115, 92, 61] as const;

const svgOpen = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

function outlinePoints(spec: PolaroidSpec): string {
  return spec.paper.sheet.outline.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Diary page: cream paper, faint ruled lines and binding holes along the top margin. */
export function pageSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  const { page } = spec.paper;
  const rules: string[] = [];
  for (let y = page.ruleFirstYPx; y < h; y += page.ruleStepPx) {
    rules.push(`<line x1="0" x2="${w}" y1="${y}" y2="${y}"/>`);
  }
  const holes = page.holes.xs
    .map((x) => `<circle cx="${x}" cy="${page.holes.yPx}" r="${page.holes.rPx}"/>`)
    .join("");
  return (
    `${svgOpen(w, h)}<rect width="${w}" height="${h}" fill="${PAGE_COLOR}"/>` +
    `<g stroke="${RULE_COLOR}" stroke-opacity="0.55" stroke-width="2">${rules.join("")}</g>` +
    `<g fill="${HOLE_FILL}" stroke="${HOLE_RING}" stroke-width="2">${holes}</g></svg>`
  );
}

/** Torn sheet with a lighter rim (exposed paper fibres) on a transparent background. */
export function sheetSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  const points = outlinePoints(spec);
  return (
    `${svgOpen(w, h)}<polygon points="${points}" fill="${SHEET_COLOR}" stroke="#fffdf5" ` +
    `stroke-width="${SHEET_RIM_WIDTH_PX}" stroke-linejoin="round" paint-order="stroke"/></svg>`
  );
}

function shadowSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  return (
    `${svgOpen(w, h)}<polygon points="${outlinePoints(spec)}" fill="#000" ` +
    `fill-opacity="${SHADOW_OPACITY}" transform="translate(${SHADOW_OFFSET_PX.x} ${SHADOW_OFFSET_PX.y})"/></svg>`
  );
}

/** Seeded white-noise tile; tiles seamlessly because every pixel is independent. */
function grainTile(seed: number): { data: Buffer; raw: Raw } {
  const rng = createRng(seed);
  const data = Buffer.alloc(GRAIN_TILE_PX * GRAIN_TILE_PX * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = GRAIN_RGB[0];
    data[i + 1] = GRAIN_RGB[1];
    data[i + 2] = GRAIN_RGB[2];
    data[i + 3] = Math.floor(rng() * GRAIN_MAX_ALPHA);
  }
  return { data, raw: { width: GRAIN_TILE_PX, height: GRAIN_TILE_PX, channels: 4 } };
}

/**
 * Renders the paper background (page, soft shadow, glued torn sheet, grain) as an opaque PNG of
 * exactly the spread size. Uses sharp layers instead of SVG filters, which are too slow at spread size.
 */
export async function renderPaper(spec: PolaroidSpec): Promise<Buffer> {
  const shadow = await sharp(Buffer.from(shadowSvg(spec)))
    .blur(SHADOW_BLUR_SIGMA)
    .png()
    .toBuffer();
  const sheet = await sharp(Buffer.from(sheetSvg(spec)))
    .png()
    .toBuffer();
  const grain = grainTile(spec.paper.seed);
  const tile = await sharp(grain.data, { raw: grain.raw }).png().toBuffer();
  return sharp(Buffer.from(pageSvg(spec)))
    .composite([{ input: shadow }, { input: sheet }, { input: tile, tile: true }])
    .png()
    .toBuffer();
}

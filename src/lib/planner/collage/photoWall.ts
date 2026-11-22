import { PhotoWallSpec, type PhotoWallPreset } from "@/lib/schemas/photoWall";
import type { CanvasSpec, ImageStats } from "./grid/types";
import { frameHeight, windowAspect } from "./polaroid/frame";
import { rotatedBounds } from "./polaroid/geometry";

const PRINT_FILL = 0.86;
const ROTATIONS = [-6, 4, -3, 7, -5, 3] as const;
const SCALES = [1, 0.84, 0.93, 0.8, 0.97, 0.88] as const;
const X_OFFSETS = [-0.03, 0.035, 0, 0.025, -0.035, 0.01] as const;
const Y_OFFSETS = [-0.12, 0.1, 0.16, -0.16, 0.03, -0.03] as const;
const WALL_MARGIN_FRACTION = 0.025;
const MIN_FRAME_WIDTH_PX = 6;
export const PHOTO_WALL_PRESETS: readonly {
  id: PhotoWallPreset;
  name: string;
  description: string;
  bg: string;
  rotations: readonly number[];
  scales: readonly number[];
  offsets: boolean;
}[] = [
  {
    id: "warm",
    name: "Warm memories",
    description: "Relaxed prints on a warm wall",
    bg: "#e9ded0",
    rotations: ROTATIONS,
    scales: SCALES,
    offsets: true,
  },
  {
    id: "gallery",
    name: "Minimal gallery",
    description: "Straight prints on a soft ivory wall",
    bg: "#f2f0e9",
    rotations: [0],
    scales: [0.92],
    offsets: false,
  },
  {
    id: "midnight",
    name: "Midnight exhibition",
    description: "A bold, dark backdrop with dramatic angles",
    bg: "#252c39",
    rotations: [-3, 3, 0, -4, 4],
    scales: [0.96, 0.88, 0.96],
    offsets: false,
  },
  {
    id: "scrapbook",
    name: "Pastel scrapbook",
    description: "Playful scattered prints on dusty rose",
    bg: "#eacbd0",
    rotations: [8, -7, 5, -8, 6],
    scales: [0.8, 1, 0.84, 0.95],
    offsets: true,
  },
];

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

function splitRegions(region: Region, count: number, start = 0): Region[] {
  if (count === 1) return [region];
  const first = count === 6 ? 2 : count === 3 ? (start % 2 === 0 ? 1 : 2) : Math.floor(count / 2);
  const fraction = first / count;
  if (region.w >= region.h) {
    const w = region.w * fraction;
    return [
      ...splitRegions({ ...region, w }, first, start),
      ...splitRegions(
        { ...region, x: region.x + w, w: region.w - w },
        count - first,
        start + first,
      ),
    ];
  }
  const h = region.h * fraction;
  return [
    ...splitRegions({ ...region, h }, first, start),
    ...splitRegions({ ...region, y: region.y + h, h: region.h - h }, count - first, start + first),
  ];
}

/** Plans one wall of prints. Canvas and frame coordinates are in pixels. */
export function planPhotoWall(input: {
  canvas: CanvasSpec;
  images: readonly ImageStats[];
  preset?: PhotoWallPreset;
}): PhotoWallSpec {
  const { canvas, images } = input;
  const preset = PHOTO_WALL_PRESETS.find((item) => item.id === (input.preset ?? "warm"));
  if (!preset) throw new RangeError("Unknown photo wall preset");
  if (images.length === 0) throw new RangeError("At least one image is required");
  const margin = Math.min(canvas.w, canvas.h) * WALL_MARGIN_FRACTION;
  const regions = splitRegions(
    { x: margin, y: margin, w: canvas.w - 2 * margin, h: canvas.h - 2 * margin },
    images.length,
  );
  const items = images.map((image, index) => {
    const region = regions[index];
    if (!region) throw new RangeError("Missing photo wall region");
    const aspect = windowAspect(image.widthPx / image.heightPx);
    const cx =
      region.x +
      (0.5 + (preset.offsets ? (X_OFFSETS[index % X_OFFSETS.length] ?? 0) : 0)) * region.w;
    const cy =
      region.y +
      (0.5 + (preset.offsets ? (Y_OFFSETS[index % Y_OFFSETS.length] ?? 0) : 0)) * region.h;
    const rotationDeg = preset.rotations[index % preset.rotations.length] ?? 0;
    let w = Math.floor(Math.min(region.w * PRINT_FILL, region.h * PRINT_FILL * aspect));
    while (w > 0) {
      const h = frameHeight(w, aspect);
      const bounds = rotatedBounds({
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        w,
        h,
        rotationDeg,
      });
      if (
        bounds.x0 >= region.x + 1 &&
        bounds.y0 >= region.y + 1 &&
        bounds.x1 <= region.x + region.w - 1 &&
        bounds.y1 <= region.y + region.h - 1
      )
        break;
      w--;
    }
    w = Math.floor(w * (preset.scales[index % preset.scales.length] ?? 1));
    if (w < MIN_FRAME_WIDTH_PX) throw new RangeError("Canvas too small for photo wall");
    const h = frameHeight(w, aspect);
    return {
      image: image.assetId,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w,
      h,
      rotationDeg,
    };
  });
  return PhotoWallSpec.parse({
    version: 1,
    canvas: { w: canvas.w, h: canvas.h, bg: preset.bg },
    items,
  });
}

import type { CollageTemplateId } from "@/lib/schemas/collage";

export interface CanvasSize {
  w: number;
  h: number;
}

export interface CanvasSpec extends CanvasSize {
  gap: number;
  bg: string;
}

export interface ImageStats {
  assetId: string;
  widthPx: number;
  heightPx: number;
  pixelCount: number;
}

/** Empty rectangle in integer canvas pixels; `order` is the upload-order index. */
export interface Slot {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  order: number;
  hero: boolean;
}

export interface GridPlanInput {
  canvas: CanvasSpec;
  images: readonly ImageStats[];
  style: "justified" | "template";
  template?: CollageTemplateId;
}

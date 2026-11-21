import { createRng, hashStrings } from "@/lib/utils/rng";
import { PolaroidSpec, type PolaroidAspect, type PolaroidItem } from "@/lib/schemas/polaroid";
import {
  CONTENT_MARGIN_PX,
  POLAROID_BAND_CENTERS,
  POLAROID_FRAME_RATIO,
  POLAROID_JITTER_X_FRACTION,
  POLAROID_JITTER_Y_FRACTION,
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_MAX_WIDTH_PX,
  POLAROID_MIN_WIDTH_PX,
  POLAROID_ROW_FILL,
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
  POLAROID_SMALL_SCALE,
  POLAROID_TAPE_VARIANTS,
} from "./defaults";
import { rotatedBounds } from "./geometry";
import { planPaper } from "./paper";

export interface PolaroidPlanInput {
  images: ReadonlyArray<{ assetId: string; caption: string }>;
  slideCount: number;
  slideAspect: PolaroidAspect;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (rng: () => number, amount: number) => (rng() * 2 - 1) * amount;

/** Half the rotated width, in px, of a frame of width `w` tilted by the maximum rotation. */
function halfRotatedWidth(w: number): number {
  const b = rotatedBounds({
    x: 0,
    y: 0,
    w,
    h: w * POLAROID_FRAME_RATIO,
    rotationDeg: POLAROID_MAX_ROTATION_DEG,
  });
  return (b.x1 - b.x0) / 2;
}

interface Lattice {
  spread: { w: number; h: number };
  usableH: number;
  baseW: number;
  first: number;
  pitch: number;
  jitterX: number;
}

/**
 * Centres sit on a lattice inset by the widest tilted frame, so no frame needs clamping. Horizontal
 * jitter is capped so consecutive centres are never more than one slide width apart, which
 * guarantees every slide holds a centre.
 */
function layoutLattice(count: number, slideCount: number, slideAspect: PolaroidAspect): Lattice {
  const spread = {
    w: POLAROID_SLIDE_WIDTH_PX * slideCount,
    h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
  };
  const usableW = spread.w - 2 * CONTENT_MARGIN_PX;
  const usableH = spread.h - 2 * CONTENT_MARGIN_PX;
  const maxW = Math.min(POLAROID_MAX_WIDTH_PX, Math.floor((usableH * 0.55) / POLAROID_FRAME_RATIO));
  const baseW = clamp((usableW / count) * 2 * POLAROID_ROW_FILL, POLAROID_MIN_WIDTH_PX, maxW);
  const inset = halfRotatedWidth(baseW);
  const pitch = (usableW - 2 * inset) / count;
  const jitterX = Math.min(
    pitch * POLAROID_JITTER_X_FRACTION,
    Math.max(0, (POLAROID_SLIDE_WIDTH_PX - pitch) / 2 - 1),
  );
  return { spread, usableH, baseW, first: CONTENT_MARGIN_PX + inset, pitch, jitterX };
}

function placeItem(
  image: { assetId: string; caption: string },
  i: number,
  lattice: Lattice,
  rng: () => number,
): PolaroidItem {
  const scale = Math.floor(i / 2) % 2 === 0 ? 1 : POLAROID_SMALL_SCALE;
  const w = Math.round(lattice.baseW * scale);
  const h = Math.round(w * POLAROID_FRAME_RATIO);
  const rotationDeg = Math.round(jitter(rng, POLAROID_MAX_ROTATION_DEG) * 10) / 10;
  const cx = lattice.first + lattice.pitch * (i + 0.5) + jitter(rng, lattice.jitterX);
  const band = POLAROID_BAND_CENTERS[i % 2];
  const bandY = CONTENT_MARGIN_PX + lattice.usableH * band;
  const cy = bandY + jitter(rng, lattice.usableH * POLAROID_JITTER_Y_FRACTION);
  return {
    id: i,
    image: image.assetId,
    caption: image.caption,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w,
    h,
    rotationDeg,
    tape: POLAROID_TAPE_VARIANTS[i % POLAROID_TAPE_VARIANTS.length],
  };
}

/**
 * Plans a seamless diary spread: polaroids alternate between an upper and a lower band across the
 * whole spread (so they may straddle slide seams), with alternating sizes and seeded rotation.
 * Pure and deterministic; the seed derives from the ordered asset ids. Lengths are spread px.
 */
export function planPolaroidCarousel(input: PolaroidPlanInput): PolaroidSpec {
  const { images, slideCount, slideAspect } = input;
  const seed = hashStrings(images.map((i) => i.assetId));
  const rng = createRng(seed);
  const lattice = layoutLattice(images.length, slideCount, slideAspect);
  const polaroids = images.map((image, i) => placeItem(image, i, lattice, rng));
  return PolaroidSpec.parse({
    version: 1,
    spread: lattice.spread,
    slide: {
      w: POLAROID_SLIDE_WIDTH_PX,
      h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
      count: slideCount,
    },
    polaroids,
    paper: planPaper(lattice.spread, seed, rng),
  });
}

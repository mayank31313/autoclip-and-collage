import { createRng, hashStrings } from "@/lib/utils/rng";
import { PolaroidSpec, type PolaroidAspect, type PolaroidItem } from "@/lib/schemas/polaroid";
import {
  CONTENT_MARGIN_PX,
  DEFAULT_POLAROID_SLIDE_SIZE,
  POLAROID_FRAME_RATIO,
  POLAROID_MAX_HEIGHT_FRACTION,
  POLAROID_MAX_WIDTH_PX,
  POLAROID_MIN_WIDTH_PX,
  POLAROID_ROW_FILL,
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_SIZE_SCALE,
  POLAROID_SLIDE_WIDTH_PX,
  POLAROID_TAPE_VARIANTS,
  type PolaroidSlideSize,
} from "./defaults";
import { rotatedBounds } from "./geometry";
import { frameHeight, windowAspect } from "./frame";
import { planPaper } from "./paper";
import { relaxOverlaps } from "./relax";
import { evenSlideCounts } from "./slides";
import {
  DEFAULT_POLAROID_TEMPLATE,
  POLAROID_TEMPLATES,
  type PolaroidTemplateConfig,
  type PolaroidTemplateId,
} from "./templates";

export interface PolaroidPlanInput {
  /** `aspect` is the displayed photo's width / height; omitted means square. */
  images: ReadonlyArray<{ assetId: string; caption: string; aspect?: number }>;
  slideCount: number;
  slideAspect: PolaroidAspect;
  template?: PolaroidTemplateId;
  /** Images on each slide, in order; defaults to an even split. */
  imagesPerSlide?: readonly number[];
  /** Polaroid size on each slide, in order; defaults to `large`. */
  slideSizes?: readonly PolaroidSlideSize[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (rng: () => number, amount: number) => (rng() * 2 - 1) * amount;
const FIT_PASSES = 2;

/** Half the rotated width, in px, of a frame of width `w` tilted by `rotationDeg`. */
function halfRotatedWidth(w: number, rotationDeg: number): number {
  const b = rotatedBounds({ x: 0, y: 0, w, h: w * POLAROID_FRAME_RATIO, rotationDeg });
  return (b.x1 - b.x0) / 2;
}

interface Frame {
  spread: { w: number; h: number };
  usableH: number;
  maxW: number;
  /** Tallest allowed frame; keeps tall portrait polaroids inside the sheet. */
  maxH: number;
  template: PolaroidTemplateConfig;
}

/** Where one slide's polaroid centres sit: `count` evenly spaced from `lo`, `pitch` px apart. */
interface Lane {
  lo: number;
  pitch: number;
  baseW: number;
  jitterX: number;
}

/** Base polaroid width that fits `count` photos in a horizontal range of `rangePx`. */
function fitWidth(rangePx: number, count: number, frame: Frame, size: PolaroidSlideSize): number {
  const fit = (rangePx / count) * frame.template.widthSpan * POLAROID_ROW_FILL;
  return clamp(fit, POLAROID_MIN_WIDTH_PX, frame.maxW) * POLAROID_SLIDE_SIZE_SCALE[size];
}

/**
 * Lays one slide's centres between its seams. The first and last slides are also inset from the
 * page edge by the tilted half-width, so no frame needs clamping. Interior slides span the whole
 * slide, so neighbouring polaroids may still straddle a seam. Jitter is capped so every slide
 * keeps its own centres.
 */
function layoutLane(
  slide: number,
  count: number,
  slideCount: number,
  frame: Frame,
  size: PolaroidSlideSize,
): Lane {
  const first = slide === 0;
  const last = slide === slideCount - 1;
  const from = first ? CONTENT_MARGIN_PX : slide * POLAROID_SLIDE_WIDTH_PX;
  const to = last ? frame.spread.w - CONTENT_MARGIN_PX : (slide + 1) * POLAROID_SLIDE_WIDTH_PX;
  const insetFor = (w: number) => halfRotatedWidth(w, frame.template.maxRotationDeg);
  const range = (w: number) => ({
    lo: first ? from + insetFor(w) : from,
    hi: last ? to - insetFor(w) : to,
  });
  let baseW = fitWidth(to - from, count, frame, size);
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    const { lo, hi } = range(baseW);
    baseW = fitWidth(hi - lo, count, frame, size);
  }
  const { lo, hi } = range(baseW);
  const pitch = (hi - lo) / count;
  const jitterX = Math.min(
    pitch * frame.template.jitterXFraction,
    Math.max(0, (POLAROID_SLIDE_WIDTH_PX - pitch) / 2 - 1),
  );
  return { lo, pitch, baseW, jitterX };
}

interface Placement {
  image: { assetId: string; caption: string; aspect?: number };
  /** Index across the whole spread; drives the template's band and scale cycles. */
  index: number;
  /** Index within its slide. */
  slot: number;
}

/** Frame size whose photo window matches the photo; narrows tall frames until they fit `maxH`. */
function frameSize(baseW: number, aspect: number, maxH: number): { w: number; h: number } {
  let w = Math.round(baseW);
  let h = frameHeight(w, aspect);
  while (h > maxH && w > 1) {
    w = Math.min(w - 1, Math.floor((w * maxH) / h));
    h = frameHeight(w, aspect);
  }
  return { w, h };
}

function placeItem(p: Placement, lane: Lane, frame: Frame, rng: () => number): PolaroidItem {
  const { template } = frame;
  const scale = template.scales[p.index % template.scales.length] ?? 1;
  const { w, h } = frameSize(lane.baseW * scale, windowAspect(p.image.aspect), frame.maxH);
  const rotationDeg = Math.round(jitter(rng, template.maxRotationDeg) * 10) / 10;
  const cx = lane.lo + lane.pitch * (p.slot + 0.5) + jitter(rng, lane.jitterX);
  const band = template.bandCenters[p.index % template.bandCenters.length] ?? 0.5;
  const bandY = CONTENT_MARGIN_PX + frame.usableH * band;
  const cy = bandY + jitter(rng, frame.usableH * template.jitterYFraction);
  const item: PolaroidItem = {
    id: p.index,
    image: p.image.assetId,
    caption: p.image.caption,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w,
    h,
    rotationDeg,
    tape: POLAROID_TAPE_VARIANTS[p.index % POLAROID_TAPE_VARIANTS.length],
  };
  return { ...item, y: item.y + verticalShift(item, frame) };
}

/** Pulls a tilted frame back inside the content area when its band sits near an edge. */
function verticalShift(item: PolaroidItem, frame: Frame): number {
  const b = rotatedBounds(item);
  const top = CONTENT_MARGIN_PX - Math.floor(b.y0);
  const bottom = frame.spread.h - CONTENT_MARGIN_PX - Math.ceil(b.y1);
  if (top > 0) return top;
  return bottom < 0 ? bottom : 0;
}

function makeFrame(
  slideCount: number,
  slideAspect: PolaroidAspect,
  template: PolaroidTemplateConfig,
): Frame {
  const spread = {
    w: POLAROID_SLIDE_WIDTH_PX * slideCount,
    h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
  };
  const usableH = spread.h - 2 * CONTENT_MARGIN_PX;
  const maxH = Math.floor(usableH * POLAROID_MAX_HEIGHT_FRACTION);
  const maxW = Math.min(POLAROID_MAX_WIDTH_PX, Math.floor(maxH / POLAROID_FRAME_RATIO));
  return { spread, usableH, maxW, maxH, template };
}

/**
 * Plans a seamless diary spread: each slide holds its own number of polaroids at its own size,
 * following the chosen template's vertical bands, so polaroids may still straddle slide seams.
 * The counts must add up to the image count. Pure and deterministic; the seed derives from the
 * ordered asset ids. Lengths are spread px.
 */
export function planPolaroidCarousel(input: PolaroidPlanInput): PolaroidSpec {
  const { images, slideCount, slideAspect, template = DEFAULT_POLAROID_TEMPLATE } = input;
  const counts = input.imagesPerSlide ?? evenSlideCounts(images.length, slideCount);
  const seed = hashStrings(images.map((i) => i.assetId));
  const rng = createRng(seed);
  const frame = makeFrame(slideCount, slideAspect, POLAROID_TEMPLATES[template]);
  const polaroids: PolaroidItem[] = [];
  counts.forEach((count, slide) => {
    const size = input.slideSizes?.[slide] ?? DEFAULT_POLAROID_SLIDE_SIZE;
    const lane = layoutLane(slide, count, slideCount, frame, size);
    for (let slot = 0; slot < count; slot++) {
      const index = polaroids.length;
      const image = images[index];
      if (image) polaroids.push(placeItem({ image, index, slot }, lane, frame, rng));
    }
  });
  return PolaroidSpec.parse({
    version: 1,
    spread: frame.spread,
    slide: {
      w: POLAROID_SLIDE_WIDTH_PX,
      h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
      count: slideCount,
    },
    polaroids: relaxOverlaps(polaroids),
    paper: planPaper(frame.spread, seed, rng),
  });
}

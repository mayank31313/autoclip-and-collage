import { POLAROID_MAX_OVERLAP_RATIO } from "./defaults";
import { overlapRatio, rotatedBounds, type Bounds, type FrameRect } from "./geometry";

export interface PolaroidIssue {
  path: (string | number)[];
  message: string;
}

/** Structural view of a PolaroidSpec so the schema can call this without an import cycle. */
export interface PolaroidSpecLike {
  spread: { w: number; h: number };
  slide: { w: number; count: number };
  polaroids: ReadonlyArray<FrameRect & { image: string }>;
  paper: { sheet: { outline: ReadonlyArray<readonly [number, number]> } };
}

function checkPlacement(spec: PolaroidSpecLike, bounds: Bounds[]): PolaroidIssue[] {
  const { spread, polaroids } = spec;
  const issues: PolaroidIssue[] = [];
  const seen = new Set<string>();
  polaroids.forEach((p, i) => {
    const b = bounds[i];
    if (b && (b.x0 < 0 || b.y0 < 0 || b.x1 > spread.w || b.y1 > spread.h)) {
      issues.push({ path: ["polaroids", i], message: "polaroid extends outside the spread" });
    }
    if (seen.has(p.image)) {
      issues.push({ path: ["polaroids", i, "image"], message: "image is used more than once" });
    }
    seen.add(p.image);
  });
  return issues;
}

function checkSlides(spec: PolaroidSpecLike): PolaroidIssue[] {
  const { spread, slide, polaroids } = spec;
  const issues: PolaroidIssue[] = [];
  if (slide.w * slide.count !== spread.w) {
    issues.push({ path: ["slide"], message: "slide width times count must equal spread width" });
  }
  for (let s = 0; s < slide.count; s++) {
    const from = s * slide.w;
    const has = polaroids.some((p) => {
      const cx = p.x + p.w / 2;
      return cx >= from && cx < from + slide.w;
    });
    if (!has) issues.push({ path: ["polaroids"], message: `slide ${s + 1} has no polaroid` });
  }
  return issues;
}

function checkSheet(spec: PolaroidSpecLike): PolaroidIssue[] {
  const { spread, paper } = spec;
  const outside = paper.sheet.outline.findIndex(
    ([x, y]) => x < 0 || y < 0 || x > spread.w || y > spread.h,
  );
  if (outside < 0) return [];
  return [{ path: ["paper", "sheet", "outline", outside], message: "sheet point outside spread" }];
}

function checkOverlaps(bounds: Bounds[]): PolaroidIssue[] {
  const issues: PolaroidIssue[] = [];
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      if (overlapRatio(bounds[i], bounds[j]) > POLAROID_MAX_OVERLAP_RATIO) {
        issues.push({
          path: ["polaroids", j],
          message: `polaroid overlaps polaroid ${i} too much`,
        });
      }
    }
  }
  return issues;
}

/**
 * Checks that spread and slide sizes agree, polaroids (rotated) and the torn sheet lie inside the
 * spread, each image is used once, every slide holds a polaroid centre, and overlaps stay bounded.
 * All values are integer spread pixels. Pure and deterministic.
 */
export function validatePolaroidSpec(spec: PolaroidSpecLike): PolaroidIssue[] {
  const bounds = spec.polaroids.map((p) => rotatedBounds(p));
  return [
    ...checkPlacement(spec, bounds),
    ...checkSlides(spec),
    ...checkSheet(spec),
    ...checkOverlaps(bounds),
  ];
}

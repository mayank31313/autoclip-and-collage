import type { PaperSpec } from "@/lib/schemas/polaroid";
import {
  PAGE_HOLE_PITCH_PX,
  PAGE_HOLE_RADIUS_PX,
  PAGE_HOLE_Y_PX,
  PAGE_RULE_STEP_PX,
  SHEET_INSET_PX,
  TEAR_AMPLITUDE_PX,
  TEAR_STEP_PX,
} from "./defaults";

type Point = [number, number];

/** Smoothed random walk in [-amplitude, amplitude]: neighbouring points tear coherently. */
function tearOffsets(count: number, rng: () => number): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const step = (rng() * 2 - 1) * TEAR_AMPLITUDE_PX * 0.7;
    offset = Math.max(-TEAR_AMPLITUDE_PX, Math.min(TEAR_AMPLITUDE_PX, offset * 0.6 + step));
    out.push(Math.round(offset));
  }
  return out;
}

function edge(from: number, to: number, fixed: number, rng: () => number, horizontal: boolean) {
  const count = Math.max(2, Math.ceil(Math.abs(to - from) / TEAR_STEP_PX) + 1);
  const offsets = tearOffsets(count, rng);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const along = Math.round(from + ((to - from) * i) / (count - 1));
    const across = fixed + offsets[i];
    points.push(horizontal ? [along, across] : [across, along]);
  }
  return points;
}

/**
 * Plans the diary page (ruled lines, binding holes) and a torn sheet outline inset from the spread.
 * The outline is a closed polygon, clockwise from the top-left, in integer spread px.
 */
export function planPaper(spread: { w: number; h: number }, seed: number, rng: () => number) {
  const left = SHEET_INSET_PX;
  const top = SHEET_INSET_PX;
  const right = spread.w - SHEET_INSET_PX;
  const bottom = spread.h - SHEET_INSET_PX;
  const outline: Point[] = [
    ...edge(left, right, top, rng, true),
    ...edge(top, bottom, right, rng, false),
    ...edge(right, left, bottom, rng, true),
    ...edge(bottom, top, left, rng, false),
  ];
  const holeCount = Math.floor(spread.w / PAGE_HOLE_PITCH_PX);
  const xs = Array.from({ length: holeCount }, (_, i) =>
    Math.round(PAGE_HOLE_PITCH_PX * (i + 0.5)),
  );
  const paper: PaperSpec = {
    seed,
    page: {
      ruleStepPx: PAGE_RULE_STEP_PX,
      ruleFirstYPx: PAGE_RULE_STEP_PX,
      holes: { xs, yPx: PAGE_HOLE_Y_PX, rPx: PAGE_HOLE_RADIUS_PX },
    },
    sheet: { outline },
  };
  return paper;
}

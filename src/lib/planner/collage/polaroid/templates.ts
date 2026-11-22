import { POLAROID_MAX_ROTATION_DEG } from "./defaults";

export const POLAROID_TEMPLATE_IDS = ["scatter", "tidy", "cascade", "spotlight"] as const;
export type PolaroidTemplateId = (typeof POLAROID_TEMPLATE_IDS)[number];
export const DEFAULT_POLAROID_TEMPLATE: PolaroidTemplateId = "scatter";

/** Placement recipe; every entry in `bandCenters` and `scales` is a 0..1 fraction. */
export interface PolaroidTemplateConfig {
  /** Vertical band centres as a fraction of the usable sheet height, cycled per polaroid. */
  bandCenters: readonly number[];
  /** Width multipliers (at most 1, relative to the base width), cycled per polaroid. */
  scales: readonly number[];
  /** Base polaroid width in lattice pitches; templates with closer bands need a smaller span. */
  widthSpan: number;
  maxRotationDeg: number;
  jitterXFraction: number;
  jitterYFraction: number;
}

export const POLAROID_TEMPLATES: Record<PolaroidTemplateId, PolaroidTemplateConfig> = {
  scatter: {
    bandCenters: [0.27, 0.73],
    scales: [1, 1, 0.82, 0.82],
    widthSpan: 2,
    maxRotationDeg: POLAROID_MAX_ROTATION_DEG,
    jitterXFraction: 0.1,
    jitterYFraction: 0.04,
  },
  tidy: {
    bandCenters: [0.3, 0.7],
    scales: [1],
    widthSpan: 2,
    maxRotationDeg: 1.5,
    jitterXFraction: 0.02,
    jitterYFraction: 0.01,
  },
  cascade: {
    bandCenters: [0.22, 0.5, 0.78],
    scales: [1, 0.92, 0.84],
    widthSpan: 1.4,
    maxRotationDeg: POLAROID_MAX_ROTATION_DEG,
    jitterXFraction: 0.05,
    jitterYFraction: 0.02,
  },
  spotlight: {
    bandCenters: [0.5, 0.2, 0.8],
    scales: [1, 0.74, 0.74],
    widthSpan: 1.6,
    maxRotationDeg: 4,
    jitterXFraction: 0.05,
    jitterYFraction: 0.02,
  },
};

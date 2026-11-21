import { LayoutSpec } from "@/lib/schemas/layout";
import { assignImagesToSlots } from "./assign";
import { generateJustifiedSlots } from "./grid/justifiedRows";
import { generateTemplateSlots } from "./grid/templates";
import type { GridPlanInput, Slot } from "./grid/types";

function generateSlots({ canvas, images, style, template }: GridPlanInput): Slot[] {
  if (style === "justified") return generateJustifiedSlots(canvas, images, canvas.gap);
  if (template === undefined) throw new TypeError("template is required with template style");
  return generateTemplateSlots(canvas, images.length, template, canvas.gap);
}

/**
 * Builds a validated grid LayoutSpec with every input image assigned to exactly one cell.
 * Pure and deterministic; canvas and gap are in px.
 */
export function planGridCollage(input: GridPlanInput): LayoutSpec {
  const { canvas, style, images } = input;
  const cells = assignImagesToSlots(images, generateSlots(input));
  return LayoutSpec.parse({ version: 1, canvas, mode: "grid", style, cells });
}

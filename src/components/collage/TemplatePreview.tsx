import { generateDefinitionSlots } from "@/lib/planner/collage/grid/templates";
import type { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

const PREVIEW_LONG_SIDE_PX = 120;
const PREVIEW_GAP_PX = 4;

/** Miniature of a template's slots, drawn with the same planner the renderer uses. */
export function TemplatePreview({
  template,
  aspect,
  className,
}: {
  template: CollageTemplateDefinition;
  /** Canvas width / height, so the preview matches the chosen canvas. */
  aspect: number;
  className?: string;
}) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const w = Math.round(ratio >= 1 ? PREVIEW_LONG_SIDE_PX : PREVIEW_LONG_SIDE_PX * ratio);
  const h = Math.round(ratio >= 1 ? PREVIEW_LONG_SIDE_PX / ratio : PREVIEW_LONG_SIDE_PX);
  let slots: ReturnType<typeof generateDefinitionSlots> = [];
  try {
    slots = generateDefinitionSlots({ w, h }, template, PREVIEW_GAP_PX);
  } catch {
    // Extreme aspect ratios can leave no room for tracks; show an empty frame instead.
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label={`${template.name} layout preview`}
    >
      <rect width={w} height={h} rx={4} className="fill-muted" />
      {slots.map((s) => (
        <rect
          key={s.id}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={2}
          className={s.hero ? "fill-primary/70" : "fill-primary/25"}
        />
      ))}
    </svg>
  );
}

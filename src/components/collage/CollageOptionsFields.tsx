"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { fieldErrorClass, inputClass, legendClass } from "@/components/collage/fieldStyles";
import {
  CANVAS_PRESETS,
  CUSTOM_PRESET,
  TEMPLATE_LABELS,
  compatibleTemplates,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageLimits } from "@/features/collage/limits";

interface Props {
  form: UseFormReturn<CollageFormValues>;
  limits: CollageLimits;
  fileCount: number;
}

function Radio(props: React.ComponentProps<"input"> & { label: string }) {
  const { label, ...input } = props;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        className="size-4 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        {...input}
      />
      {label}
    </label>
  );
}

export function CollageOptionsFields({ form, limits, fileCount }: Props) {
  const { register, control, formState } = form;
  const errors = formState.errors;
  const style = useWatch({ control, name: "style" });
  const preset = useWatch({ control, name: "preset" });
  const templates = compatibleTemplates(fileCount);

  return (
    <>
      <fieldset className="space-y-2">
        <legend className={legendClass}>Layout</legend>
        <Radio label="Justified rows" value="justified" {...register("style")} />
        <Radio label="Template" value="template" {...register("style")} />
        {style === "template" && (
          <div>
            <label htmlFor="collage-template" className="text-sm">
              Template layout
            </label>
            <select
              id="collage-template"
              className={inputClass}
              aria-invalid={errors.template ? true : undefined}
              aria-describedby={errors.template ? "collage-template-error" : undefined}
              {...register("template")}
            >
              {templates.map((id) => (
                <option key={id} value={id}>
                  {TEMPLATE_LABELS[id]}
                </option>
              ))}
            </select>
            {errors.template && (
              <p id="collage-template-error" className={fieldErrorClass}>
                {errors.template.message}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={legendClass}>Canvas size</legend>
        {CANVAS_PRESETS.map((p) => (
          <Radio
            key={p.id}
            label={`${p.label} ${p.w}×${p.h}`}
            value={p.id}
            {...register("preset")}
          />
        ))}
        <Radio label="Custom" value={CUSTOM_PRESET} {...register("preset")} />
        {preset === CUSTOM_PRESET && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="collage-width" className="text-sm">
                Width (px)
              </label>
              <input
                id="collage-width"
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.maxCanvasDimension}
                className={inputClass}
                aria-invalid={errors.width ? true : undefined}
                aria-describedby="collage-canvas-error"
                {...register("width", { valueAsNumber: true })}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="collage-height" className="text-sm">
                Height (px)
              </label>
              <input
                id="collage-height"
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.maxCanvasDimension}
                className={inputClass}
                aria-invalid={errors.height ? true : undefined}
                aria-describedby="collage-canvas-error"
                {...register("height", { valueAsNumber: true })}
              />
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Up to {limits.maxCanvasDimension} px per side and {limits.maxCanvasPixels / 1_000_000}{" "}
          megapixels.
        </p>
        <p id="collage-canvas-error" className={fieldErrorClass}>
          {errors.preset?.message ?? errors.width?.message ?? errors.height?.message}
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={legendClass}>Output format</legend>
        <Radio label="PNG" value="png" {...register("format")} />
        <Radio label="JPEG" value="jpeg" {...register("format")} />
      </fieldset>
    </>
  );
}

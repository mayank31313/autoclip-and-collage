"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { CustomTemplateBuilder, TemplatePicker } from "@/components/collage/CollageTemplateFields";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import {
  CANVAS_PRESETS,
  CUSTOM_PRESET,
  resolveCanvas,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageLimits } from "@/features/collage/limits";
import type { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

interface Props {
  form: UseFormReturn<CollageFormValues>;
  limits: CollageLimits;
  templates: readonly CollageTemplateDefinition[];
  fileCount: number;
}

export function Radio(
  props: React.ComponentProps<"input"> & { label: string; description?: string },
) {
  const { label, description, className, ...input } = props;
  return (
    <label
      className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-ring has-[:checked]:bg-primary/5 ${className ?? ""}`}
    >
      <input
        type="radio"
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        {...input}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}

export function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
        {number}
      </span>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function CollageOptionsFields({ form, limits, templates, fileCount }: Props) {
  const { register, control, formState } = form;
  const errors = formState.errors;
  const style = useWatch({ control, name: "style" });
  const preset = useWatch({ control, name: "preset" });
  const width = useWatch({ control, name: "width" });
  const height = useWatch({ control, name: "height" });
  const canvas = resolveCanvas({ preset, width, height });
  const aspect = canvas.w / canvas.h;

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="03"
          title="Choose your layout"
          description="Pick a flowing arrangement, a ready-made template, or design your own."
        />
        <fieldset>
          <legend className="sr-only">Layout style</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <Radio
              label="Justified rows"
              description="A balanced, flowing arrangement."
              value="justified"
              {...register("style")}
            />
            <Radio
              label="Template"
              description="Choose a ready-made grid of slots."
              value="template"
              {...register("style")}
            />
            <Radio
              label="Create your own"
              description="Build a grid or edit the layout JSON."
              value="custom"
              {...register("style")}
            />
          </div>
        </fieldset>
        {style === "template" && (
          <TemplatePicker form={form} templates={templates} fileCount={fileCount} aspect={aspect} />
        )}
        {style === "custom" && <CustomTemplateBuilder form={form} aspect={aspect} />}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="04"
          title="Choose your canvas"
          description="Start with a preset or enter your own dimensions."
        />
        <fieldset>
          <legend className="sr-only">Canvas size</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CANVAS_PRESETS.map((p) => (
              <Radio
                key={p.id}
                label={`${p.label} ${p.w}×${p.h}`}
                value={p.id}
                {...register("preset")}
              />
            ))}
            <Radio label="Custom dimensions" value={CUSTOM_PRESET} {...register("preset")} />
          </div>
        </fieldset>
        {preset === CUSTOM_PRESET && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="collage-width" className="text-sm font-medium">
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
            <div className="min-w-0">
              <label htmlFor="collage-height" className="text-sm font-medium">
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
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Up to {limits.maxCanvasDimension} px per side and {limits.maxCanvasPixels / 1_000_000}{" "}
          megapixels.
        </p>
        <p id="collage-canvas-error" className={fieldErrorClass}>
          {errors.preset?.message ?? errors.width?.message ?? errors.height?.message}
        </p>
      </section>

      <OutputFormatSection form={form} number="05" />
    </>
  );
}

export function OutputFormatSection({
  form,
  number,
}: {
  form: UseFormReturn<CollageFormValues>;
  number: string;
}) {
  const { register } = form;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <SectionHeading
        number={number}
        title="Set your output"
        description="Choose the file type that works for you."
      />
      <fieldset>
        <legend className="sr-only">Output format</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Radio
            label="PNG"
            description="Crisp quality with transparency support."
            value="png"
            {...register("format")}
          />
          <Radio
            label="JPEG"
            description="Smaller file, great for sharing."
            value="jpeg"
            {...register("format")}
          />
        </div>
      </fieldset>
    </section>
  );
}

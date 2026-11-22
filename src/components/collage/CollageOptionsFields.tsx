"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { CustomTemplateBuilder } from "@/components/collage/CollageTemplateFields";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import { PHOTO_WALL_PRESETS, planPhotoWall } from "@/lib/planner/collage/photoWall";
import type { PhotoWallPreset } from "@/lib/schemas/photoWall";
import {
  CANVAS_PRESETS,
  CUSTOM_PRESET,
  resolveCanvas,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageLimits } from "@/features/collage/limits";

interface Props {
  form: UseFormReturn<CollageFormValues>;
  limits: CollageLimits;
}

const PREVIEW_IMAGES = ["#9aaf9d", "#d4ac97", "#a9b8c5", "#d8c495"].map((color, i) => ({
  assetId: color,
  widthPx: i % 2 ? 800 : 1000,
  heightPx: i % 2 ? 1000 : 800,
  pixelCount: 800_000,
}));

function WallPreview({ preset, aspect }: { preset: PhotoWallPreset; aspect: number }) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.max(0.4, Math.min(2.5, aspect)) : 1;
  const w = Math.round(ratio >= 1 ? 300 : 300 * ratio);
  const h = Math.round(ratio >= 1 ? 300 / ratio : 300);
  const plan = planPhotoWall({
    canvas: { w, h, gap: 12, bg: "#ffffff" },
    images: PREVIEW_IMAGES,
    preset,
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full rounded-lg" aria-hidden="true">
      <rect width={w} height={h} fill={plan.canvas.bg} />
      {plan.items.map((item) => (
        <g
          key={item.image}
          transform={`rotate(${item.rotationDeg} ${item.x + item.w / 2} ${item.y + item.h / 2})`}
        >
          <rect
            x={item.x + 2}
            y={item.y + 3}
            width={item.w}
            height={item.h}
            fill="#30241e"
            opacity=".18"
          />
          <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="#fffdf6" />
          <rect
            x={item.x + item.w * 0.06}
            y={item.y + item.w * 0.06}
            width={item.w * 0.88}
            height={item.h * 0.75}
            fill={item.image}
          />
          <path
            d={`M${item.x + item.w * 0.06} ${item.y + item.h * 0.75} l${item.w * 0.3} -${item.h * 0.3} l${item.w * 0.2} ${item.h * 0.15} l${item.w * 0.2} -${item.h * 0.2} l${item.w * 0.18} ${item.h * 0.35} Z`}
            fill="#526f68"
            opacity=".45"
          />
          <rect
            x={item.x + item.w * 0.375}
            y={item.y - item.w * 0.035}
            width={item.w * 0.25}
            height={item.w * 0.075}
            fill="#e5cfa5"
            opacity=".8"
          />
        </g>
      ))}
    </svg>
  );
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

export function CollageOptionsFields({ form, limits }: Props) {
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
          description="Set the mood with a photo wall, a flowing layout, or a grid of your own."
        />
        <fieldset>
          <legend className="sr-only">Layout style</legend>
          <label className="mb-2 flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-background p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-ring has-[:checked]:bg-primary/5">
            <input
              type="radio"
              value="photo-wall"
              aria-label="Photo wall"
              className="size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
              {...register("style")}
            />
            <svg viewBox="0 0 120 78" aria-hidden="true" className="h-20 w-28 shrink-0 rounded-lg">
              <rect width="120" height="78" rx="8" fill="#e9ded0" />
              <g transform="rotate(-8 31 39)">
                <rect x="12" y="16" width="38" height="47" fill="#fffdf6" />
                <rect x="15" y="19" width="32" height="34" fill="#96a99a" />
                <path d="M15 49 25 36 31 43 37 34 47 49" fill="#6c8578" />
                <rect x="25" y="13" width="13" height="6" fill="#e5cfa5" opacity=".8" />
              </g>
              <g transform="rotate(6 81 39)">
                <rect x="59" y="12" width="42" height="52" fill="#fffdf6" />
                <rect x="62" y="15" width="36" height="38" fill="#ccaa95" />
                <circle cx="87" cy="24" r="5" fill="#f3d9b7" />
                <path d="M62 50 74 34 82 43 89 36 98 50" fill="#a77f71" />
                <rect x="73" y="9" width="14" height="6" fill="#e5cfa5" opacity=".8" />
              </g>
            </svg>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Photo wall</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Framed prints arranged on a wall of your choice.
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Every photo stays in view, in one image.
              </span>
            </span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Radio
              label="Justified rows"
              description="A balanced, flowing arrangement."
              value="justified"
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
        {style === "photo-wall" && (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">Choose a photo wall</legend>
            <p className="mt-1 text-xs text-muted-foreground">
              Each design adapts to your photos and canvas.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {PHOTO_WALL_PRESETS.map((wall) => (
                <label
                  key={wall.id}
                  className="min-w-0 cursor-pointer rounded-xl border border-border bg-background p-2 transition-colors hover:bg-muted/50 has-[:checked]:border-ring has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                >
                  <WallPreview preset={wall.id} aspect={aspect} />
                  <span className="mt-3 flex items-start gap-2">
                    <input
                      type="radio"
                      value={wall.id}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      {...register("photoWallPreset")}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{wall.name}</span>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                        {wall.description}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
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

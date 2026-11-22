"use client";

import type { UseFormReturn } from "react-hook-form";
import {
  OutputFormatSection,
  Radio,
  SectionHeading,
} from "@/components/collage/CollageOptionsFields";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import { PolaroidSlideFields } from "@/components/collage/PolaroidSlideFields";
import type { CollageFormValues } from "@/features/collage/form";
import {
  POLAROID_TEMPLATE_OPTIONS,
  SLIDE_ASPECT_OPTIONS,
  effectiveSlides,
} from "@/features/collage/polaroidForm";
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "@/lib/planner/collage/polaroid/defaults";

type Form = UseFormReturn<CollageFormValues>;

export function ModeSwitch({ form }: { form: Form }) {
  const { register } = form;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <fieldset>
        <legend className="text-base font-semibold">What are you making?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Radio
            label="Collage"
            description="One image with every photo, as a photo wall or a grid."
            value="grid"
            {...register("mode")}
          />
          <Radio
            label="Polaroid carousel"
            description="Polaroids on a torn diary page, sliced into swipeable slides."
            value="polaroid"
            {...register("mode")}
          />
        </div>
      </fieldset>
    </section>
  );
}

export function PolaroidOptionsFields({ form, files }: { form: Form; files: File[] }) {
  const { register, formState } = form;
  const errors = formState.errors;
  const auto = effectiveSlides(Number.NaN, files.length);

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="03"
          title="Shape your carousel"
          description="Choose how many slides to swipe through and their shape."
        />
        <label htmlFor="polaroid-slides" className="text-sm font-medium">
          Slides
        </label>
        <input
          id="polaroid-slides"
          type="number"
          inputMode="numeric"
          min={POLAROID_MIN_SLIDES}
          max={POLAROID_MAX_SLIDES}
          placeholder={`Auto (${auto})`}
          className={inputClass}
          aria-invalid={errors.slides ? true : undefined}
          aria-describedby="polaroid-slides-note polaroid-slides-error"
          {...register("slides", { valueAsNumber: true })}
        />
        <p id="polaroid-slides-note" className="mt-2 text-xs leading-5 text-muted-foreground">
          Leave it empty for about three photos per slide. Polaroids can cross slide edges, so swipe
          through the slides in order.
        </p>
        <p id="polaroid-slides-error" className={fieldErrorClass}>
          {errors.slides?.message}
        </p>
        <fieldset className="mt-5">
          <legend className="sr-only">Slide shape</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SLIDE_ASPECT_OPTIONS.map((option) => (
              <Radio
                key={option.id}
                label={option.label}
                description={option.size}
                value={option.id}
                {...register("slideAspect")}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Layout template</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {POLAROID_TEMPLATE_OPTIONS.map((option) => (
              <Radio
                key={option.id}
                label={option.label}
                description={option.description}
                value={option.id}
                {...register("polaroidTemplate")}
              />
            ))}
          </div>
        </fieldset>
      </section>

      <PolaroidSlideFields form={form} files={files} />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="05"
          title="Add captions"
          description="Optional handwriting on the bottom strip of each polaroid."
        />
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose your images to add captions.</p>
        ) : (
          <ul className="space-y-3">
            {files.map((file, i) => (
              <li key={`${i}-${file.name}`}>
                <label htmlFor={`polaroid-caption-${i}`} className="text-sm font-medium">
                  Caption for {file.name}
                </label>
                <input
                  id={`polaroid-caption-${i}`}
                  type="text"
                  autoComplete="off"
                  maxLength={POLAROID_MAX_CAPTION_CHARS}
                  className={inputClass}
                  aria-invalid={errors.captions?.[i] ? true : undefined}
                  {...register(`captions.${i}` as const)}
                />
                <p className={fieldErrorClass}>{errors.captions?.[i]?.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OutputFormatSection form={form} number="06" />
    </>
  );
}

"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { Radio, SectionHeading } from "@/components/collage/CollageOptionsFields";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import type { CollageFormValues } from "@/features/collage/form";
import {
  SLIDE_LAYOUT_OPTIONS,
  SLIDE_SIZE_OPTIONS,
  effectiveSlides,
  slideCounts,
} from "@/features/collage/polaroidForm";
import {
  DEFAULT_POLAROID_SLIDE_SIZE,
  POLAROID_MAX_IMAGES_PER_SLIDE,
} from "@/lib/planner/collage/polaroid/defaults";
import { evenSlideCounts } from "@/lib/planner/collage/polaroid/slides";

type Form = UseFormReturn<CollageFormValues>;

const photosLabel = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

/** Per-slide photo counts and polaroid sizes for the polaroid carousel. */
export function PolaroidSlideFields({ form, files }: { form: Form; files: File[] }) {
  const { register, setValue, control, formState } = form;
  const values = useWatch({ control }) as CollageFormValues;
  const imageCount = files.length;
  const slides = effectiveSlides(values.slides, imageCount);
  const custom = values.slideLayout === "custom";
  const counts = slideCounts({ ...values, slideLayout: "even" }, imageCount);
  const assigned = custom ? slideCounts(values, imageCount) : counts;
  const total = assigned.reduce((sum, n) => sum + (Number.isNaN(n) ? 0 : n), 0);
  const errors = formState.errors.imagesPerSlide;
  const summaryError = errors?.message ?? errors?.root?.message;

  const resetCounts = () =>
    setValue("imagesPerSlide", evenSlideCounts(imageCount, slides), { shouldValidate: true });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <SectionHeading
        number="04"
        title="Arrange each slide"
        description="Choose how many photos each slide holds and how large its polaroids are."
      />
      <fieldset>
        <legend className="sr-only">Photos per slide</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SLIDE_LAYOUT_OPTIONS.map((option) => (
            <Radio
              key={option.id}
              label={option.label}
              description={option.description}
              value={option.id}
              {...register("slideLayout", {
                onChange: (event) => {
                  if (event.target.value === "custom") resetCounts();
                },
              })}
            />
          ))}
        </div>
      </fieldset>

      {imageCount === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Choose your images to arrange slides.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {Array.from({ length: slides }, (_, i) => (
            <li key={i} className="grid grid-cols-[4.5rem_1fr_1fr] items-end gap-3">
              <span className="pb-2.5 text-sm font-medium">Slide {i + 1}</span>
              <div>
                <label htmlFor={`polaroid-count-${i}`} className="text-xs text-muted-foreground">
                  Photos
                </label>
                {custom ? (
                  <input
                    id={`polaroid-count-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={POLAROID_MAX_IMAGES_PER_SLIDE}
                    className={inputClass}
                    aria-invalid={errors?.[i] ? true : undefined}
                    {...register(`imagesPerSlide.${i}` as const, { valueAsNumber: true })}
                  />
                ) : (
                  <output
                    id={`polaroid-count-${i}`}
                    className="mt-1.5 block rounded-xl border border-transparent px-3 py-2.5 text-sm"
                  >
                    {photosLabel(counts[i] ?? 0)}
                  </output>
                )}
              </div>
              <div>
                <label htmlFor={`polaroid-size-${i}`} className="text-xs text-muted-foreground">
                  Polaroid size
                </label>
                <select
                  id={`polaroid-size-${i}`}
                  className={inputClass}
                  defaultValue={DEFAULT_POLAROID_SLIDE_SIZE}
                  {...register(`slideSizes.${i}` as const)}
                >
                  {SLIDE_SIZE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}

      {custom && imageCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {total} of {imageCount} photos placed
          </p>
          <button
            type="button"
            onClick={resetCounts}
            className="text-sm font-medium underline underline-offset-4"
          >
            Reset to even split
          </button>
        </div>
      )}
      <p className={fieldErrorClass} role={summaryError ? "alert" : undefined}>
        {summaryError}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Up to {POLAROID_MAX_IMAGES_PER_SLIDE} photos fit on a slide. Smaller polaroids leave room
        for more photos; large ones suit one to three.
      </p>
    </section>
  );
}

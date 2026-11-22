"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { SectionHeading } from "@/components/collage/CollageOptionsFields";
import { fieldErrorClass, inputClass, legendClass } from "@/components/collage/fieldStyles";
import type { CollageFormValues } from "@/features/collage/form";
import {
  SLIDESHOW_CANVAS_OPTIONS,
  SLIDESHOW_FIT_OPTIONS,
  SLIDESHOW_FPS_OPTIONS,
  SLIDESHOW_TRANSITION_OPTIONS,
} from "@/features/collage/slideshowForm";

type Form = UseFormReturn<CollageFormValues>;

/** Options for canvas, FPS, transition and per-source timing of the slideshow (mode "slideshow"). */
export function SlideshowOptionsFields({ form, files }: { form: Form; files: File[] }) {
  const { register, control, formState } = form;
  const errors = formState.errors;
  const transition = useWatch({ control, name: "slideshowTransition" });
  const sources = useWatch({ control, name: "slideshowSources" }) ?? [];

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="03"
          title="Shape your slideshow"
          description="Pick the canvas, frame rate and the way slides transition into each other."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="slideshow-canvas" className={legendClass}>
              Canvas
            </label>
            <select id="slideshow-canvas" className={inputClass} {...register("slideshowCanvas")}>
              {SLIDESHOW_CANVAS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="slideshow-fps" className={legendClass}>
              Frame rate
            </label>
            <select
              id="slideshow-fps"
              className={inputClass}
              {...register("slideshowFps", { valueAsNumber: true })}
            >
              {SLIDESHOW_FPS_OPTIONS.map((fps) => (
                <option key={fps} value={fps}>
                  {fps} fps
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="slideshow-transition" className={legendClass}>
              Transition
            </label>
            <select
              id="slideshow-transition"
              className={inputClass}
              {...register("slideshowTransition")}
            >
              {SLIDESHOW_TRANSITION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {transition !== "cut" && (
            <div>
              <label htmlFor="slideshow-transition-sec" className={legendClass}>
                Transition seconds
              </label>
              <input
                id="slideshow-transition-sec"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                className={inputClass}
                aria-invalid={errors.slideshowTransitionSec ? true : undefined}
                {...register("slideshowTransitionSec", { valueAsNumber: true })}
              />
            </div>
          )}
        </div>
        <p className={fieldErrorClass}>{errors.slideshowTransitionSec?.message}</p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="04"
          title="Arrange each slide"
          description="Set how long each photo stays on screen, or trim the video clips you added."
        />
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose photos or video clips to continue.</p>
        ) : (
          <ul className="space-y-3">
            {files.map((file, i) => {
              const source = sources[i];
              const fileErrors = errors.slideshowSources?.[i];
              return (
                <li key={`${i}-${file.name}`} className="rounded-xl border border-border p-3">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {source?.kind === "image" ? (
                      <div>
                        <label
                          htmlFor={`slideshow-duration-${i}`}
                          className="text-xs text-muted-foreground"
                        >
                          Duration (sec)
                        </label>
                        <input
                          id={`slideshow-duration-${i}`}
                          type="number"
                          inputMode="decimal"
                          min={0.1}
                          step={0.1}
                          className={inputClass}
                          aria-invalid={fileErrors?.durationSec ? true : undefined}
                          {...register(`slideshowSources.${i}.durationSec` as const, {
                            valueAsNumber: true,
                          })}
                        />
                        <p className={fieldErrorClass}>{fileErrors?.durationSec?.message}</p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label
                            htmlFor={`slideshow-start-${i}`}
                            className="text-xs text-muted-foreground"
                          >
                            Start (sec)
                          </label>
                          <input
                            id={`slideshow-start-${i}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.1}
                            placeholder="Full clip"
                            className={inputClass}
                            aria-invalid={fileErrors?.startSec ? true : undefined}
                            {...register(`slideshowSources.${i}.startSec` as const, {
                              valueAsNumber: true,
                            })}
                          />
                          <p className={fieldErrorClass}>{fileErrors?.startSec?.message}</p>
                        </div>
                        <div>
                          <label
                            htmlFor={`slideshow-end-${i}`}
                            className="text-xs text-muted-foreground"
                          >
                            End (sec)
                          </label>
                          <input
                            id={`slideshow-end-${i}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.1}
                            placeholder="Full clip"
                            className={inputClass}
                            aria-invalid={fileErrors?.endSec ? true : undefined}
                            {...register(`slideshowSources.${i}.endSec` as const, {
                              valueAsNumber: true,
                            })}
                          />
                          <p className={fieldErrorClass}>{fileErrors?.endSec?.message}</p>
                        </div>
                      </>
                    )}
                    <div>
                      <label
                        htmlFor={`slideshow-fit-${i}`}
                        className="text-xs text-muted-foreground"
                      >
                        Fit
                      </label>
                      <select
                        id={`slideshow-fit-${i}`}
                        className={inputClass}
                        {...register(`slideshowSources.${i}.fit` as const)}
                      >
                        {SLIDESHOW_FIT_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="05"
          title="Output"
          description="Slideshows always export as an MP4 video, alongside a ZIP of the individual slides."
        />
      </section>
    </>
  );
}

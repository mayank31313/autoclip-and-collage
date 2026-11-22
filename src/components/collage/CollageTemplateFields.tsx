"use client";

import { useState } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { TemplatePreview } from "@/components/collage/TemplatePreview";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import {
  CUSTOM_GRID_MAX_TRACKS,
  DEFAULT_CUSTOM_GRID,
  buildGridTemplate,
  parseTemplateJson,
  stringifyTemplate,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

type Form = UseFormReturn<CollageFormValues>;

const cardClass =
  "flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border border-border bg-background p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-ring has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";

function imageCount(n: number) {
  return `${n} ${n === 1 ? "image" : "images"}`;
}

/** Radio cards for the server's file templates plus the any-count rectangular grid. */
export function TemplatePicker({
  form,
  templates,
  fileCount,
  aspect,
}: {
  form: Form;
  templates: readonly CollageTemplateDefinition[];
  fileCount: number;
  aspect: number;
}) {
  const error = form.formState.errors.template?.message;
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium">Template layout</legend>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.map((t) => {
          const count = t.cells.length;
          const fits = fileCount === 0 || fileCount === count;
          return (
            <label key={t.id} className={cardClass} title={t.description}>
              <TemplatePreview template={t} aspect={aspect} className="h-20 w-full" />
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  value={t.id}
                  disabled={!fits}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  {...form.register("template")}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{imageCount(count)}</span>
                </span>
              </span>
            </label>
          );
        })}
        <label className={cardClass}>
          <span className="grid h-20 place-items-center rounded bg-muted text-xs text-muted-foreground">
            Fits any count
          </span>
          <span className="flex items-start gap-2">
            <input
              type="radio"
              value="rectangular"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              {...form.register("template")}
            />
            <span className="block text-sm font-medium">Rectangular (any count)</span>
          </span>
        </label>
      </div>
      {fileCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Templates that don&apos;t match your {imageCount(fileCount)} are disabled.
        </p>
      )}
      {error && <p className={fieldErrorClass}>{error}</p>}
    </fieldset>
  );
}

function clampTracks(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(CUSTOM_GRID_MAX_TRACKS, Math.max(1, Math.round(value)));
}

/** Quick grid builder that writes template JSON, plus a raw JSON editor for full control. */
export function CustomTemplateBuilder({ form, aspect }: { form: Form; aspect: number }) {
  const [grid, setGrid] = useState(DEFAULT_CUSTOM_GRID);
  const text = useWatch({ control: form.control, name: "customTemplate" });
  const parsed = parseTemplateJson(text);
  const error = form.formState.errors.customTemplate?.message;

  function update(next: typeof grid) {
    setGrid(next);
    form.setValue("customTemplate", stringifyTemplate(buildGridTemplate(next)), {
      shouldValidate: form.formState.isSubmitted,
      shouldDirty: true,
    });
  }

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {(["rows", "cols"] as const).map((key) => (
            <div key={key} className="min-w-0">
              <label htmlFor={`collage-custom-${key}`} className="text-sm font-medium">
                {key === "rows" ? "Rows" : "Columns"}
              </label>
              <input
                id={`collage-custom-${key}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={CUSTOM_GRID_MAX_TRACKS}
                className={inputClass}
                value={grid[key]}
                onChange={(e) => update({ ...grid, [key]: clampTracks(e.target.valueAsNumber) })}
              />
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={grid.hero}
            disabled={grid.rows < 2 || grid.cols < 2}
            onChange={(e) => update({ ...grid, hero: e.target.checked })}
          />
          Hero image (top-left 2×2 block)
        </label>
        <details className="rounded-xl border border-border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced: edit JSON</summary>
          <label htmlFor="collage-custom-json" className="sr-only">
            Custom template JSON
          </label>
          <textarea
            id="collage-custom-json"
            rows={10}
            spellCheck={false}
            className={`${inputClass} h-auto font-mono text-xs`}
            aria-invalid={error ? true : undefined}
            aria-describedby="collage-custom-error"
            {...form.register("customTemplate")}
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Track weights in <code>cols</code>/<code>rows</code>; cells use <code>col</code>,{" "}
              <code>row</code>, <code>colSpan</code>, <code>rowSpan</code>, and optional{" "}
              <code>hero</code>.
            </p>
            <button
              type="button"
              onClick={() => update(grid)}
              className="shrink-0 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Reset from grid
            </button>
          </div>
        </details>
      </div>
      <div className="flex flex-col items-center gap-2">
        {parsed.ok ? (
          <TemplatePreview template={parsed.template} aspect={aspect} className="w-full" />
        ) : (
          <div className="grid aspect-square w-full place-items-center rounded bg-muted text-xs text-muted-foreground">
            No preview
          </div>
        )}
        <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {parsed.ok ? `Needs ${imageCount(parsed.template.cells.length)}` : "Invalid layout"}
        </p>
      </div>
      <p id="collage-custom-error" className={`${fieldErrorClass} sm:col-span-2`}>
        {error ?? (parsed.ok ? "" : parsed.message)}
      </p>
    </div>
  );
}

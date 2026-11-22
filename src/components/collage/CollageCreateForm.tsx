"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, FileImage, ImagePlus, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CollageOptionsFields } from "@/components/collage/CollageOptionsFields";
import { CollageFailure, CollageProgress, CollageResult } from "@/components/collage/CollageStatus";
import { fieldErrorClass, inputClass, legendClass } from "@/components/collage/fieldStyles";
import { ModeSwitch, PolaroidOptionsFields } from "@/components/collage/PolaroidOptionsFields";
import { SlideshowOptionsFields } from "@/components/collage/SlideshowOptionsFields";
import { Button } from "@/components/ui/button";
import { createCollage } from "@/features/collage/api";
import {
  COLLAGE_FORM_DEFAULTS,
  IMAGE_TYPES,
  buildCreateBody,
  buildSlideshowSourceDrafts,
  compatibleTemplates,
  createCollageFormSchema,
  formatBytes,
  type CollageFormValues,
} from "@/features/collage/form";
import { isTerminalStatus } from "@/features/collage/job";
import { effectiveSlides } from "@/features/collage/polaroidForm";
import { SLIDESHOW_MAX_SOURCES, SLIDESHOW_TYPES } from "@/features/collage/slideshowForm";
import type { CollageLimits } from "@/features/collage/limits";
import { createSubmissionGuard } from "@/features/collage/submissionGuard";
import { useJob } from "@/features/collage/useJob";
import { useUpload } from "@/features/collage/useUpload";
import { evenSlideCounts } from "@/lib/planner/collage/polaroid/slides";
import type { JobResponse } from "@/lib/schemas/job";
import type { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";

/** Collects every message from an RHF error tree (root, array and per-index entries). */
function messagesOf(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const node = error as { message?: unknown; root?: unknown } & Record<string, unknown>;
  const own = typeof node.message === "string" ? [node.message] : [];
  const children = Object.keys(node)
    .filter((k) => k === "root" || /^\d+$/.test(k))
    .flatMap((k) => messagesOf(node[k]));
  return [...own, ...children];
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong";
}

function collageFailure(
  createError: Error | null,
  jobError: Error | null,
  job: JobResponse | undefined,
): string | null {
  if (createError) return messageOf(createError);
  if (jobError) return messageOf(jobError);
  if (job?.status === "failed") return job.error?.message || "The collage job failed";
  if (job?.status === "cancelled") return "The collage job was cancelled";
  return null;
}

interface Props {
  limits: CollageLimits;
  templates: readonly CollageTemplateDefinition[];
  /** True when the server attaches its configured studio key to same-origin requests. */
  studioKey: boolean;
}

export function CollageCreateForm({ limits, templates, studioKey }: Props) {
  // Credentials and uploaded keys live only in component memory: never stored, logged or in URLs.
  const [apiKey, setApiKey] = useState("");
  const [useStudioKey, setUseStudioKey] = useState(studioKey);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [uploadedKeys, setUploadedKeys] = useState<string[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // null means "no Authorization header": the server falls back to the studio key.
  const key = useStudioKey ? null : apiKey.trim();

  const schema = useMemo(() => createCollageFormSchema(limits, templates), [limits, templates]);
  const form = useForm<CollageFormValues>({
    resolver: zodResolver(schema),
    defaultValues: COLLAGE_FORM_DEFAULTS,
  });
  const files = useWatch({ control: form.control, name: "files" });
  const mode = useWatch({ control: form.control, name: "mode" });
  const slideshowSelected = useWatch({ control: form.control, name: "slideshowSelected" });
  // Picking Collage or Polaroid resets any earlier Slideshow selection.
  useEffect(() => {
    form.setValue("slideshowSelected", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const kind = slideshowSelected ? "slideshow" : mode;
  const { upload, progress, reset: resetUpload } = useUpload(key);
  const { job, error: jobError } = useJob(key, jobId);

  // Inputs are locked while submitting; the guard also drops results of any superseded submission.
  const guard = useState(createSubmissionGuard)[0];

  const create = useMutation({
    mutationFn: async ({ values, token }: { values: CollageFormValues; token: number }) => {
      const keys = uploadedKeys ?? (await upload(values.files));
      if (!guard.isCurrent(token)) return null;
      setUploadedKeys(keys);
      const res = await createCollage(key, buildCreateBody(values, keys));
      return guard.isCurrent(token) ? res : null;
    },
    onMutate: () => setJobId(null),
    onSuccess: (res) => {
      if (res) setJobId(res.jobId);
    },
  });

  const submit = form.handleSubmit((values) => {
    if (key === "") return;
    create.mutate({ values, token: guard.begin() });
  });

  function run() {
    setKeyError(key === "" ? "Enter your API key" : null);
    void submit();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run();
  }

  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    form.setValue("files", selected, { shouldValidate: true, shouldDirty: true });
    form.setValue(
      "captions",
      selected.map(() => ""),
    );
    form.setValue("slideshowSources", buildSlideshowSourceDrafts(selected));
    if (form.getValues("slideLayout") === "custom") {
      const slides = effectiveSlides(form.getValues("slides"), selected.length);
      form.setValue("imagesPerSlide", evenSlideCounts(selected.length, slides));
    }
    if (!compatibleTemplates(templates, selected.length).includes(form.getValues("template"))) {
      form.setValue("template", "rectangular");
    }
    guard.invalidate();
    setUploadedKeys(null);
    setJobId(null);
    resetUpload();
    create.reset();
  }

  function forgetUploads() {
    // Uploaded objects belong to the key's owner, so a different key must upload again.
    guard.invalidate();
    setUploadedKeys(null);
  }

  function onKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setApiKey(event.target.value);
    setKeyError(null);
    forgetUploads();
  }

  function toggleStudioKey() {
    setUseStudioKey((v) => !v);
    setKeyError(null);
    forgetUploads();
  }

  function selectSlideshowMode() {
    form.setValue("slideshowSelected", true, { shouldValidate: true, shouldDirty: true });
  }

  const uploading = create.isPending && uploadedKeys === null;
  const polling = jobId !== null && !jobError && !(job && isTerminalStatus(job.status));
  const failure = collageFailure(create.error, jobError, job);
  const fileErrors = messagesOf(form.formState.errors.files);
  const uploadPercent = progress.length
    ? Math.round(progress.reduce((a, b) => a + b, 0) / progress.length)
    : 0;
  const fileAccept = kind === "slideshow" ? SLIDESHOW_TYPES.join(",") : IMAGE_TYPES.join(",");
  const fileHint =
    kind === "slideshow"
      ? `1 to ${SLIDESHOW_MAX_SOURCES} photos and video clips.`
      : `1 to ${limits.maxImages} images, up to ${formatBytes(limits.maxImageUploadBytes)} each.`;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <fieldset disabled={create.isPending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
              01
            </span>
            <div>
              <h2 className="text-base font-semibold">Connect your studio</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use your API key to create a collage.
              </p>
            </div>
          </div>
          <label htmlFor="collage-api-key" className={legendClass}>
            API key
          </label>
          {useStudioKey ? (
            <input
              id="collage-api-key"
              type="text"
              readOnly
              className={`${inputClass} bg-muted/50 text-muted-foreground`}
              value="Studio key · managed by the server"
              aria-describedby="collage-api-key-note"
            />
          ) : (
            <input
              id="collage-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
              value={apiKey}
              onChange={onKeyChange}
              aria-invalid={keyError ? true : undefined}
              aria-describedby="collage-api-key-note"
            />
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p
              id="collage-api-key-note"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              {useStudioKey
                ? "Filled in by the server; the key never reaches your browser."
                : "Kept in this page's memory only; it is never stored."}
            </p>
            {studioKey && (
              <button
                type="button"
                onClick={toggleStudioKey}
                className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <KeyRound className="size-3.5" aria-hidden="true" />
                {useStudioKey ? "Use a different key" : "Use the studio key"}
              </button>
            )}
          </div>
          {keyError && <p className={fieldErrorClass}>{keyError}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
              02
            </span>
            <div>
              <h2 className="text-base font-semibold">Add your images</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick the moments you want to bring together.
              </p>
            </div>
          </div>
          <label htmlFor="collage-images" className={legendClass}>
            Images
          </label>
          <div className="mt-2 rounded-xl border border-dashed border-input bg-muted/30 p-3 transition-colors focus-within:border-ring focus-within:bg-muted/50 sm:p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-lg bg-background text-muted-foreground">
                <ImagePlus className="size-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-medium">Choose images from your device</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {kind === "slideshow"
                    ? "JPEG, PNG, WebP, MP4, MOV, WebM, or MKV"
                    : "JPEG, PNG, or WebP"}
                </span>
              </span>
            </div>
            <input
              id="collage-images"
              type="file"
              multiple
              accept={fileAccept}
              className="block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onChange={onFilesChange}
              aria-invalid={fileErrors.length ? true : undefined}
              aria-describedby="collage-images-note collage-images-errors"
            />
          </div>
          <p id="collage-images-note" className="mt-2 text-xs leading-5 text-muted-foreground">
            {fileHint}
          </p>
          <ul id="collage-images-errors" className={fieldErrorClass}>
            {fileErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          {files.length > 0 && (
            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                {files.length} {files.length === 1 ? "image" : "images"} selected
              </p>
              <ul aria-label="Selected images" className="space-y-2">
                {files.map((file, i) => (
                  <li key={`${i}-${file.name}`} className="flex min-w-0 items-center gap-2 text-sm">
                    <FileImage
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                      {uploading && progress[i] !== undefined ? ` | ${progress[i]}%` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <ModeSwitch form={form} />
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <button
            type="button"
            aria-pressed={kind === "slideshow"}
            onClick={selectSlideshowMode}
            className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/50 aria-pressed:border-ring aria-pressed:bg-primary/5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Slideshow</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Mix photos and video clips into a narrated MP4, with transitions between slides.
              </span>
            </span>
          </button>
        </section>
        {kind === "slideshow" ? (
          <SlideshowOptionsFields form={form} files={files} />
        ) : mode === "polaroid" ? (
          <PolaroidOptionsFields form={form} files={files} />
        ) : (
          <CollageOptionsFields form={form} limits={limits} />
        )}
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          className="h-11 w-full justify-center rounded-xl px-5 sm:w-auto"
          disabled={create.isPending || polling}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Create collage
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
        <p className="text-center text-xs text-muted-foreground sm:text-left">
          You can preview it before downloading.
        </p>
      </div>

      <div aria-live="polite" className="space-y-4">
        {uploading && <CollageProgress label="Uploading images" value={uploadPercent} />}
        {create.isPending && !uploading && <CollageProgress label="Submitting collage" />}
        {polling && !create.isPending && (
          <CollageProgress
            label={job?.status === "running" ? "Building collage" : "Waiting to build collage"}
            value={job?.progress}
          />
        )}
        {job?.status === "succeeded" && <CollageResult job={job} />}
      </div>
      {failure && !create.isPending && <CollageFailure message={failure} onRetry={run} />}
    </form>
  );
}

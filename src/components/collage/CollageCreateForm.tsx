"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CollageOptionsFields } from "@/components/collage/CollageOptionsFields";
import { CollageFailure, CollageProgress, CollageResult } from "@/components/collage/CollageStatus";
import { fieldErrorClass, inputClass, legendClass } from "@/components/collage/fieldStyles";
import { Button } from "@/components/ui/button";
import { createCollage } from "@/features/collage/api";
import {
  COLLAGE_FORM_DEFAULTS,
  IMAGE_TYPES,
  buildCreateBody,
  compatibleTemplates,
  createCollageFormSchema,
  formatBytes,
  type CollageFormValues,
} from "@/features/collage/form";
import { isTerminalStatus } from "@/features/collage/job";
import type { CollageLimits } from "@/features/collage/limits";
import { useJob } from "@/features/collage/useJob";
import { useUpload } from "@/features/collage/useUpload";
import type { JobResponse } from "@/lib/schemas/job";

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

export function CollageCreateForm({ limits }: { limits: CollageLimits }) {
  // Credentials and uploaded keys live only in component memory: never stored, logged or in URLs.
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [uploadedKeys, setUploadedKeys] = useState<string[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const key = apiKey.trim();

  const schema = useMemo(() => createCollageFormSchema(limits), [limits]);
  const form = useForm<CollageFormValues>({
    resolver: zodResolver(schema),
    defaultValues: COLLAGE_FORM_DEFAULTS,
  });
  const files = useWatch({ control: form.control, name: "files" });
  const { upload, progress, reset: resetUpload } = useUpload(key);
  const { job, error: jobError } = useJob(key, jobId);

  const create = useMutation({
    mutationFn: async (values: CollageFormValues) => {
      const keys = uploadedKeys ?? (await upload(values.files));
      setUploadedKeys(keys);
      return createCollage(key, buildCreateBody(values, keys));
    },
    onMutate: () => setJobId(null),
    onSuccess: (res) => setJobId(res.jobId),
  });

  const submit = form.handleSubmit((values) => {
    if (!key) return;
    create.mutate(values);
  });

  function run() {
    setKeyError(key ? null : "Enter your API key");
    void submit();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run();
  }

  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    form.setValue("files", selected, { shouldValidate: true, shouldDirty: true });
    if (!compatibleTemplates(selected.length).includes(form.getValues("template"))) {
      form.setValue("template", "rectangular");
    }
    setUploadedKeys(null);
    setJobId(null);
    resetUpload();
    create.reset();
  }

  function onKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setApiKey(event.target.value);
    setKeyError(null);
    // Uploaded objects belong to the key's owner, so a different key must upload again.
    setUploadedKeys(null);
  }

  const uploading = create.isPending && uploadedKeys === null;
  const polling = jobId !== null && !jobError && !(job && isTerminalStatus(job.status));
  const failure = collageFailure(create.error, jobError, job);
  const fileErrors = messagesOf(form.formState.errors.files);
  const uploadPercent = progress.length
    ? Math.round(progress.reduce((a, b) => a + b, 0) / progress.length)
    : 0;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <label htmlFor="collage-api-key" className={legendClass}>
          API key
        </label>
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
        <p id="collage-api-key-note" className="mt-1 text-xs text-muted-foreground">
          Kept in this page&apos;s memory only; it is never stored.
        </p>
        {keyError && <p className={fieldErrorClass}>{keyError}</p>}
      </div>

      <div>
        <label htmlFor="collage-images" className={legendClass}>
          Images
        </label>
        <input
          id="collage-images"
          type="file"
          multiple
          accept={IMAGE_TYPES.join(",")}
          className={inputClass}
          onChange={onFilesChange}
          aria-invalid={fileErrors.length ? true : undefined}
          aria-describedby="collage-images-note collage-images-errors"
        />
        <p id="collage-images-note" className="mt-1 text-xs text-muted-foreground">
          1 to {limits.maxImages} JPEG, PNG, or WebP files, up to{" "}
          {formatBytes(limits.maxImageUploadBytes)} each.
        </p>
        <ul id="collage-images-errors" className={fieldErrorClass}>
          {fileErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((file, i) => (
              <li key={`${i}-${file.name}`}>
                {file.name} ({formatBytes(file.size)})
                {uploading && progress[i] !== undefined ? ` – ${progress[i]}% uploaded` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CollageOptionsFields form={form} limits={limits} fileCount={files.length} />

      <Button type="submit" disabled={create.isPending || polling}>
        Create collage
      </Button>

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

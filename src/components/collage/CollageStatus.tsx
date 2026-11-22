import { Button } from "@/components/ui/button";
import { CollageJobResult, PolaroidJobResult } from "@/lib/schemas/api";
import type { JobResponse } from "@/lib/schemas/job";
import { PolaroidResult } from "@/components/collage/PolaroidResult";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";

interface ProgressProps {
  label: string;
  /** Percent 0..100, or undefined while the amount of work is not yet known. */
  value?: number;
}

export function CollageProgress({ label, value }: ProgressProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value === undefined ? "In progress" : `${value}%`}
        </span>
      </div>
      <progress
        className="h-2 w-full overflow-hidden rounded-full accent-primary"
        aria-label={label}
        max={100}
        value={value}
      />
    </div>
  );
}

export function CollageFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={onRetry}>
        Retry collage
      </Button>
    </div>
  );
}

function ResultUnreadable() {
  return (
    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">
        The collage finished, but its result could not be read.
      </p>
    </div>
  );
}

export function CollageResult({ job }: { job: JobResponse }) {
  if (job.type === POLAROID_JOB_TYPE) {
    const polaroid = PolaroidJobResult.safeParse(job.result);
    return polaroid.success ? (
      <PolaroidResult output={polaroid.data.output} />
    ) : (
      <ResultUnreadable />
    );
  }
  const parsed = CollageJobResult.safeParse(job.result);
  if (!parsed.success) return <ResultUnreadable />;
  const { downloadUrl, width, height, format } = parsed.data.output;
  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
      aria-labelledby="collage-result-heading"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ready to take with you
        </p>
        <h2 id="collage-result-heading" className="mt-1 text-lg font-semibold">
          Your collage
        </h2>
      </div>
      {/* Signed, short-lived object-store URL: next/image would need a remote host allow-list. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={downloadUrl}
        alt="Generated collage"
        width={width}
        height={height}
        className="h-auto max-h-[34rem] w-full rounded-xl border border-border bg-muted object-contain"
      />
      <a
        href={downloadUrl}
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
      >
        Download collage
      </a>
      <p className="text-xs text-muted-foreground">
        {width}×{height} {format.toUpperCase()}. The link expires, so download it soon.
      </p>
    </section>
  );
}

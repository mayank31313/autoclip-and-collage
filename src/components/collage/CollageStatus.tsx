import { Button } from "@/components/ui/button";
import { CollageJobResult } from "@/lib/schemas/api";
import type { JobResponse } from "@/lib/schemas/job";

interface ProgressProps {
  label: string;
  /** Percent 0..100, or undefined while the amount of work is not yet known. */
  value?: number;
}

export function CollageProgress({ label, value }: ProgressProps) {
  return (
    <div className="space-y-1">
      <p className="text-sm">
        {label}
        {value === undefined ? "…" : ` ${value}%`}
      </p>
      <progress className="h-2 w-full" aria-label={label} max={100} value={value} />
    </div>
  );
}

export function CollageFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        Retry collage
      </Button>
    </div>
  );
}

export function CollageResult({ job }: { job: JobResponse }) {
  const parsed = CollageJobResult.safeParse(job.result);
  if (!parsed.success) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The collage finished, but its result could not be read.
      </p>
    );
  }
  const { downloadUrl, width, height, format } = parsed.data.output;
  return (
    <section className="space-y-3" aria-labelledby="collage-result-heading">
      <h2 id="collage-result-heading" className="text-lg font-medium">
        Your collage
      </h2>
      {/* Signed, short-lived object-store URL: next/image would need a remote host allow-list. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={downloadUrl}
        alt="Generated collage"
        width={width}
        height={height}
        className="h-auto max-w-full rounded-lg border"
      />
      <a
        href={downloadUrl}
        rel="noopener noreferrer"
        className="inline-block rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Download collage
      </a>
      <p className="text-xs text-muted-foreground">
        {width}×{height} {format.toUpperCase()}. The link expires, so download it soon.
      </p>
    </section>
  );
}

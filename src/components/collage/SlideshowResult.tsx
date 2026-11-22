import type { SlideshowJobResult } from "@/lib/schemas/slideshow";

type Output = SlideshowJobResult["output"];

const primaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";
const secondaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";

export function SlideshowResult({ output }: { output: Output }) {
  const { width, height, fps, durationSec, masterUrl, zipUrl, slides } = output;

  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
      aria-labelledby="slideshow-result-heading"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ready to take with you
        </p>
        <h2 id="slideshow-result-heading" className="mt-1 text-lg font-semibold">
          Your slideshow
        </h2>
      </div>
      <video
        controls
        src={masterUrl}
        width={width}
        height={height}
        className="mx-auto h-auto max-h-[34rem] w-full rounded-xl border border-border bg-muted"
      />
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {width}×{height}, {fps} fps, {durationSec.toFixed(1)}s.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={zipUrl} rel="noopener noreferrer" className={primaryLink}>
          Download all slides (ZIP)
        </a>
        <a href={masterUrl} rel="noopener noreferrer" className={secondaryLink}>
          Download video
        </a>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground">Individual slides</p>
        <ul className="mt-2 space-y-1">
          {slides.map((slide) => (
            <li key={slide.index}>
              <a
                href={slide.url}
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Slide {slide.index + 1} ({slide.durationSec.toFixed(1)}s)
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">The links expire, so download them soon.</p>
    </section>
  );
}

"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { PolaroidJobResult } from "@/lib/schemas/api";

type Output = PolaroidJobResult["output"];

const primaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";
const secondaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";

export function PolaroidResult({ output }: { output: Output }) {
  const [index, setIndex] = useState(0);
  const { slides, slideCount, slideWidth, slideHeight, slideFormat, zipUrl } = output;
  const slide = slides[index];
  const go = (next: number) => setIndex(Math.min(slides.length - 1, Math.max(0, next)));

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  }

  if (!slide) return null;
  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
      aria-labelledby="polaroid-result-heading"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ready to take with you
        </p>
        <h2 id="polaroid-result-heading" className="mt-1 text-lg font-semibold">
          Your polaroid carousel
        </h2>
      </div>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="Carousel preview"
        onKeyDown={onKeyDown}
        className="space-y-3"
      >
        {/* Signed, short-lived object-store URL: next/image would need a remote host allow-list. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.url}
          alt={`Slide ${index + 1} of ${slideCount}`}
          width={slideWidth}
          height={slideHeight}
          className="mx-auto h-auto max-h-[34rem] w-auto max-w-full rounded-xl border border-border bg-muted object-contain"
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            aria-label="Previous slide"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
            Slide {index + 1} of {slideCount}
          </p>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            aria-label="Next slide"
            disabled={index === slides.length - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={zipUrl} rel="noopener noreferrer" className={primaryLink}>
          Download all slides (ZIP)
        </a>
        <a href={slide.url} rel="noopener noreferrer" className={secondaryLink}>
          Open this slide
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        {slideCount} slides, {slideWidth}×{slideHeight} {slideFormat.toUpperCase()}. The links
        expire, so download them soon.
      </p>
    </section>
  );
}

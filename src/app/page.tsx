import { ArrowDown, ArrowRight, ArrowUpRight, Layers, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Bring your photos",
    description: "Choose the images you want to tell a story with.",
  },
  {
    number: "02",
    title: "Find your layout",
    description: "Pick a considered grid and canvas size in seconds.",
  },
  {
    number: "03",
    title: "Take it with you",
    description: "Download a crisp PNG or a share-ready JPEG.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Layers className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            AutoClip &amp; Collage Studio
          </span>
        </Link>
        <Link
          href="/api/health"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm"
        >
          Service health
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>

      <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-12 lg:pb-28">
        <div className="max-w-2xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />A little more room to
            create
          </p>
          <h1 className="text-5xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Make something
            <span className="mt-1 block text-muted-foreground">worth sharing.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Turn a handful of photos into a thoughtful collage. Choose your images, find a layout,
            and make it yours.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/collages"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Create a collage
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              See how it works
              <ArrowDown className="size-4" aria-hidden="true" />
            </a>
          </div>
          <p className="mt-7 flex items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Your API key stays in this page&apos;s memory.
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div
            className="absolute -right-8 -top-8 size-32 rounded-full bg-primary/5 blur-2xl sm:size-48"
            aria-hidden="true"
          />
          <div className="relative rounded-[2rem] border border-border bg-card p-3 shadow-xl shadow-foreground/[0.04] sm:p-4">
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  A study in little moments
                </p>
                <p className="mt-1 text-sm font-semibold tracking-tight">The weekend, collected</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                04 frames
              </span>
            </div>
            <div className="grid aspect-[1.05] grid-cols-5 grid-rows-5 gap-2 overflow-hidden rounded-2xl bg-muted p-2">
              <div className="col-span-3 row-span-3 rounded-xl bg-gradient-to-br from-amber-200 via-orange-200 to-rose-300" />
              <div className="col-span-2 row-span-2 rounded-xl bg-gradient-to-br from-sky-200 via-cyan-100 to-emerald-200" />
              <div className="col-span-2 row-span-3 rounded-xl bg-gradient-to-br from-rose-200 via-pink-100 to-violet-200" />
              <div className="col-span-3 row-span-2 rounded-xl bg-gradient-to-br from-lime-200 via-emerald-100 to-teal-200" />
            </div>
            <div className="flex items-center justify-between px-3 pb-1 pt-4">
              <p className="text-xs text-muted-foreground">A little structure. A lot of you.</p>
              <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </span>
            </div>
          </div>
          <div className="absolute -bottom-5 -left-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 shadow-lg shadow-foreground/[0.06] sm:-left-7">
            <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-semibold">Made by you</span>
              <span className="block text-[10px] text-muted-foreground">Ready to share</span>
            </span>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-border bg-muted/35">
        <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-12">
          <div className="mb-8 flex flex-col justify-between gap-3 sm:mb-10 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                A simple little flow
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                From camera roll to keepsake.
              </h2>
            </div>
            <Link
              href="/collages"
              className="inline-flex items-center gap-2 text-sm font-semibold transition hover:gap-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Start creating <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ol className="grid gap-3 md:grid-cols-3">
            {steps.map((step) => (
              <li key={step.number} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <span className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">
                  {step.number}
                </span>
                <h3 className="mt-5 text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

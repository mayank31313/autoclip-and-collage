import type { Metadata } from "next";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { CollageCreateForm } from "@/components/collage/CollageCreateForm";
import { getConfig } from "@/server/config";
import { getCollageTemplates } from "@/server/templates/collageTemplates";

export const metadata: Metadata = {
  title: "Create collage",
  description: "Choose your images, shape a layout, and export a collage.",
};
// Limits come from runtime env, so the page must not be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function CollagesPage() {
  const config = getConfig();
  const templates = await getCollageTemplates();
  return (
    <main className="min-h-screen bg-muted/35">
      <div className="mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24 lg:px-12">
        <header className="flex items-center justify-between border-b border-border/70 py-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to studio
          </Link>
          <span className="text-xs font-medium text-muted-foreground">COLLAGE STUDIO</span>
        </header>

        <div className="mx-auto max-w-6xl pt-9 sm:pt-12">
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              A few steps to something lovely
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Create a collage
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Start with your images. We&apos;ll arrange them into a layout you can download and
              share.
            </p>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)] lg:gap-8">
            <CollageCreateForm
              limits={{
                maxImages: config.collageMaxImages,
                maxImageUploadBytes: config.maxImageUploadBytes,
                maxCanvasPixels: config.collageMaxCanvasPixels,
                maxCanvasDimension: config.collageMaxDimension,
              }}
              templates={templates}
              studioKey={Boolean(config.studioApiKey)}
            />

            <aside className="space-y-4 lg:sticky lg:top-6">
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-base font-semibold">A little privacy, built in.</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Your API key stays in this page&apos;s memory. Images upload directly to your
                  configured storage.
                </p>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <h2 className="text-sm font-semibold">What happens next</h2>
                <ol className="mt-4 space-y-4">
                  {[
                    ["01", "Choose images and a layout"],
                    ["02", "We build your collage"],
                    ["03", "Preview and download"],
                  ].map(([number, label]) => (
                    <li key={number} className="flex items-center gap-3 text-sm">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                        {number}
                      </span>
                      <span className="text-muted-foreground">{label}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

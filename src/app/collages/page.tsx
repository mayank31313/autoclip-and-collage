import type { Metadata } from "next";
import { CollageCreateForm } from "@/components/collage/CollageCreateForm";
import { getConfig } from "@/server/config";

export const metadata: Metadata = { title: "Create collage" };
// Limits come from runtime env, so the page must not be prerendered at build time.
export const dynamic = "force-dynamic";

export default function CollagesPage() {
  const config = getConfig();
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Create a collage</h1>
      <p className="mt-2 mb-6 text-muted-foreground">
        Upload images, choose a layout, and download the result.
      </p>
      <CollageCreateForm
        limits={{
          maxImages: config.collageMaxImages,
          maxImageUploadBytes: config.maxImageUploadBytes,
          maxCanvasPixels: config.collageMaxCanvasPixels,
          maxCanvasDimension: config.collageMaxDimension,
        }}
      />
    </main>
  );
}

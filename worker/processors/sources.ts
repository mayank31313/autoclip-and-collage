import path from "node:path";
import type { ImageStats } from "@/lib/planner/collage/grid/types";
import { isSupportedImageMime, type inspectImage } from "@/server/analyzers/image/metadata";
import type { Config } from "@/server/config";
import type { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import type { downloadObjectToFile } from "@/server/storage/objects";

const PROGRESS_AFTER_DOWNLOADS = 70;

export type Progress = (progress: number) => Promise<void>;

export interface SourceDeps {
  assetsRepo: Pick<typeof assetsRepo, "getForOwner">;
  downloadObjectToFile: typeof downloadObjectToFile;
  inspectImage: typeof inspectImage;
}

type SourceAsset = NonNullable<Awaited<ReturnType<SourceDeps["assetsRepo"]["getForOwner"]>>>;

export function userError(code: "VALIDATION_FAILED" | "NOT_FOUND", message: string): AppError {
  return new AppError(code, code === "NOT_FOUND" ? 404 : 400, message);
}

async function resolveSource(
  deps: SourceDeps,
  assetId: string,
  ownerId: string,
): Promise<SourceAsset> {
  const asset = await deps.assetsRepo.getForOwner(assetId, ownerId);
  if (!asset) throw userError("NOT_FOUND", "Source image not found");
  if (asset.kind !== "image" || !isSupportedImageMime(asset.contentType)) {
    throw userError("VALIDATION_FAILED", "Source asset is not a supported image");
  }
  return asset;
}

export interface Downloaded {
  stats: ImageStats[];
  sourcePaths: Map<string, string>;
}

/** Sequential on purpose: decoding is memory-heavy and collage concurrency is bounded per worker. */
export async function downloadSources(
  deps: SourceDeps,
  args: { ids: readonly string[]; ownerId: string; dir: string; config: Config },
  progress: Progress,
): Promise<Downloaded> {
  const { maxImageUploadBytes, collageMaxInputPixels } = args.config;
  const out: Downloaded = { stats: [], sourcePaths: new Map() };
  for (const [index, id] of args.ids.entries()) {
    const asset = await resolveSource(deps, id, args.ownerId);
    const file = path.join(args.dir, `source-${index}`);
    await deps.downloadObjectToFile(asset.key, file, maxImageUploadBytes);
    out.stats.push(await deps.inspectImage(file, asset.id, collageMaxInputPixels));
    out.sourcePaths.set(asset.id, file);
    await progress(Math.round(((index + 1) / args.ids.length) * PROGRESS_AFTER_DOWNLOADS));
  }
  return out;
}

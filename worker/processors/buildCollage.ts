import { mkdtemp as fsMkdtemp, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Job } from "bullmq";
import type { ImageStats } from "@/lib/planner/collage/grid/types";
import { planGridCollage as defaultPlan } from "@/lib/planner/collage/plan";
import { CollageWorkerInput, type CollageWorkerResult } from "@/lib/schemas/collage";
import type { JobData } from "@/lib/schemas/job";
import {
  inspectImage as defaultInspect,
  isSupportedImageMime,
} from "@/server/analyzers/image/metadata";
import { getConfig, type Config } from "@/server/config";
import { assetsRepo as defaultAssetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import { renderCollage as defaultRender } from "@/server/renderers/collage";
import {
  downloadObjectToFile as defaultDownload,
  uploadFile as defaultUpload,
} from "@/server/storage/objects";
import { runJob as defaultRunJob, type RunJobDeps } from "../runJob";

export interface BuildCollageDeps {
  assetsRepo: Pick<typeof defaultAssetsRepo, "getForOwner" | "register">;
  downloadObjectToFile: typeof defaultDownload;
  uploadFile: typeof defaultUpload;
  inspectImage: typeof defaultInspect;
  planGridCollage: typeof defaultPlan;
  renderCollage: typeof defaultRender;
  mkdtemp: typeof fsMkdtemp;
  rm: typeof fsRm;
  runJob: typeof defaultRunJob;
  runJobDeps?: RunJobDeps;
}

const defaultDeps: BuildCollageDeps = {
  assetsRepo: defaultAssetsRepo,
  downloadObjectToFile: defaultDownload,
  uploadFile: defaultUpload,
  inspectImage: defaultInspect,
  planGridCollage: defaultPlan,
  renderCollage: defaultRender,
  mkdtemp: fsMkdtemp,
  rm: fsRm,
  runJob: defaultRunJob,
};

const TEMP_PREFIX = "collage-";
const PROGRESS_AFTER_DOWNLOADS = 70;
const PROGRESS_AFTER_PLAN = 75;
const PROGRESS_AFTER_RENDER = 90;
const CONTENT_TYPES = { png: "image/png", jpeg: "image/jpeg" } as const;

type Progress = (progress: number) => Promise<void>;
type SourceAsset = NonNullable<Awaited<ReturnType<BuildCollageDeps["assetsRepo"]["getForOwner"]>>>;

function userError(code: "VALIDATION_FAILED" | "NOT_FOUND", message: string): AppError {
  return new AppError(code, code === "NOT_FOUND" ? 404 : 400, message);
}

function parseInput(raw: unknown): CollageWorkerInput {
  const parsed = CollageWorkerInput.safeParse(raw);
  if (!parsed.success) throw userError("VALIDATION_FAILED", "Collage job input is invalid");
  return parsed.data;
}

// Limits were checked at creation; re-checking here guards against config changes and tampering.
function checkCanvas(canvas: CollageWorkerInput["canvas"], config: Config): void {
  const { collageMaxDimension, collageMaxCanvasPixels } = config;
  if (
    canvas.w > collageMaxDimension ||
    canvas.h > collageMaxDimension ||
    canvas.w * canvas.h > collageMaxCanvasPixels
  ) {
    throw userError("VALIDATION_FAILED", "Canvas exceeds the configured size limits");
  }
}

async function resolveSource(
  deps: BuildCollageDeps,
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

interface Downloaded {
  stats: ImageStats[];
  sourcePaths: Map<string, string>;
}

/** Sequential on purpose: decoding is memory-heavy and collage concurrency is bounded per worker. */
async function downloadSources(
  deps: BuildCollageDeps,
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

function plan(deps: BuildCollageDeps, input: CollageWorkerInput, images: readonly ImageStats[]) {
  try {
    return deps.planGridCollage({
      canvas: input.canvas,
      images,
      style: input.style,
      ...(input.template !== undefined && { template: input.template }),
    });
  } catch (err) {
    // The planner rejects degenerate geometry (e.g. a gap wider than the canvas) with RangeError.
    if (err instanceof RangeError) {
      throw userError(
        "VALIDATION_FAILED",
        "The images cannot be laid out on this canvas; reduce the gap or image count",
      );
    }
    throw err;
  }
}

async function buildCollage(
  deps: BuildCollageDeps,
  ctx: { job: { id: string; ownerId: string; input: unknown }; progress: Progress },
): Promise<CollageWorkerResult> {
  const input = parseInput(ctx.job.input);
  const config = getConfig();
  checkCanvas(input.canvas, config);
  const dir = await deps.mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const { stats, sourcePaths } = await downloadSources(
      deps,
      { ids: input.sourceAssetIds, ownerId: ctx.job.ownerId, dir, config },
      ctx.progress,
    );
    const layout = plan(deps, input, stats);
    await ctx.progress(PROGRESS_AFTER_PLAN);

    const outputPath = path.join(dir, `collage.${input.format}`);
    await deps.renderCollage({ layout, sourcePaths, outputPath, format: input.format });
    await ctx.progress(PROGRESS_AFTER_RENDER);

    // Fixed key per job: a retry overwrites the object and re-registers the same asset.
    const key = `outputs/${ctx.job.id}/collage.${input.format}`;
    const contentType = CONTENT_TYPES[input.format];
    const sizeBytes = await deps.uploadFile(key, outputPath, contentType);
    const { w: width, h: height } = layout.canvas;
    const asset = await deps.assetsRepo.register({
      ownerId: ctx.job.ownerId,
      key,
      kind: "output",
      contentType,
      sizeBytes,
      metadata: { width, height, format: input.format },
    });
    return { outputAssetId: asset.id, width, height, format: input.format };
  } finally {
    await deps.rm(dir, { recursive: true, force: true });
  }
}

export function createBuildCollageProcessor(
  overrides: Partial<BuildCollageDeps> = {},
): (job: Job<JobData>) => Promise<void> {
  const deps: BuildCollageDeps = { ...defaultDeps, ...overrides };
  return async (job) => {
    await deps.runJob(
      {
        jobId: job.data.jobId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      },
      (ctx) => buildCollage(deps, ctx),
      deps.runJobDeps,
    );
  };
}

export const buildCollageProcessor = createBuildCollageProcessor();

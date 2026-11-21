import { mkdtemp as fsMkdtemp, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Job } from "bullmq";
import {
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
} from "@/lib/planner/collage/polaroid/defaults";
import { planPolaroidCarousel as defaultPlan } from "@/lib/planner/collage/polaroid/plan";
import type { JobData } from "@/lib/schemas/job";
import { PolaroidWorkerInput, type PolaroidWorkerResult } from "@/lib/schemas/polaroid";
import { inspectImage as defaultInspect } from "@/server/analyzers/image/metadata";
import { getConfig } from "@/server/config";
import { assetsRepo as defaultAssetsRepo } from "@/server/db/repositories/assets";
import { renderPolaroidSlides as defaultRender } from "@/server/renderers/polaroid";
import { writeZip as defaultWriteZip } from "@/server/renderers/zip";
import {
  downloadObjectToFile as defaultDownload,
  uploadFile as defaultUpload,
} from "@/server/storage/objects";
import { runJob as defaultRunJob, type RunJobDeps } from "../runJob";
import { downloadSources, userError } from "./sources";

export interface BuildPolaroidDeps {
  assetsRepo: Pick<typeof defaultAssetsRepo, "getForOwner" | "register">;
  downloadObjectToFile: typeof defaultDownload;
  uploadFile: typeof defaultUpload;
  inspectImage: typeof defaultInspect;
  planPolaroidCarousel: typeof defaultPlan;
  renderPolaroidSlides: typeof defaultRender;
  writeZip: typeof defaultWriteZip;
  mkdtemp: typeof fsMkdtemp;
  rm: typeof fsRm;
  runJob: typeof defaultRunJob;
  runJobDeps?: RunJobDeps;
}

const defaultDeps: BuildPolaroidDeps = {
  assetsRepo: defaultAssetsRepo,
  downloadObjectToFile: defaultDownload,
  uploadFile: defaultUpload,
  inspectImage: defaultInspect,
  planPolaroidCarousel: defaultPlan,
  renderPolaroidSlides: defaultRender,
  writeZip: defaultWriteZip,
  mkdtemp: fsMkdtemp,
  rm: fsRm,
  runJob: defaultRunJob,
};

const TEMP_PREFIX = "polaroid-";
const PROGRESS_AFTER_PLAN = 72;
const PROGRESS_AFTER_RENDER = 90;
const CONTENT_TYPES = { png: "image/png", jpeg: "image/jpeg" } as const;
const ZIP_CONTENT_TYPE = "application/zip";

function parseInput(raw: unknown): PolaroidWorkerInput {
  const parsed = PolaroidWorkerInput.safeParse(raw);
  if (!parsed.success) throw userError("VALIDATION_FAILED", "Polaroid job input is invalid");
  return parsed.data;
}

// Limits were checked at creation; re-checking here guards against config changes and tampering.
function checkSpread(input: PolaroidWorkerInput, maxPixels: number): void {
  const height = POLAROID_SLIDE_HEIGHT_PX[input.slideAspect];
  if (POLAROID_SLIDE_WIDTH_PX * input.slides * height > maxPixels) {
    throw userError("VALIDATION_FAILED", "Carousel exceeds the configured size limit");
  }
}

interface StoreArgs {
  ownerId: string;
  key: string;
  filePath: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

/** Fixed keys per job: a retry overwrites the object and re-registers the same asset. */
async function storeOutput(deps: BuildPolaroidDeps, args: StoreArgs): Promise<string> {
  const sizeBytes = await deps.uploadFile(args.key, args.filePath, args.contentType);
  const asset = await deps.assetsRepo.register({
    ownerId: args.ownerId,
    key: args.key,
    kind: "output",
    contentType: args.contentType,
    sizeBytes,
    metadata: args.metadata,
  });
  return asset.id;
}

async function storeOutputs(
  deps: BuildPolaroidDeps,
  args: {
    jobId: string;
    ownerId: string;
    slidePaths: readonly string[];
    zipPath: string;
    format: PolaroidWorkerInput["format"];
    slideWidth: number;
    slideHeight: number;
  },
): Promise<PolaroidWorkerResult> {
  const { jobId, ownerId, format, slideWidth, slideHeight } = args;
  const slideAssetIds: string[] = [];
  for (const [index, filePath] of args.slidePaths.entries()) {
    slideAssetIds.push(
      await storeOutput(deps, {
        ownerId,
        key: `outputs/${jobId}/${path.basename(filePath)}`,
        filePath,
        contentType: CONTENT_TYPES[format],
        metadata: { index, width: slideWidth, height: slideHeight, format },
      }),
    );
  }
  const zipAssetId = await storeOutput(deps, {
    ownerId,
    key: `outputs/${jobId}/polaroid.zip`,
    filePath: args.zipPath,
    contentType: ZIP_CONTENT_TYPE,
    metadata: { slideCount: args.slidePaths.length, format },
  });
  return { zipAssetId, slideAssetIds, slideWidth, slideHeight, format };
}

async function buildPolaroid(
  deps: BuildPolaroidDeps,
  ctx: {
    job: { id: string; ownerId: string; input: unknown };
    progress: (progress: number) => Promise<void>;
  },
): Promise<PolaroidWorkerResult> {
  const input = parseInput(ctx.job.input);
  const config = getConfig();
  checkSpread(input, config.polaroidMaxSpreadPixels);
  const dir = await deps.mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const { stats, sourcePaths } = await downloadSources(
      deps,
      { ids: input.sourceAssetIds, ownerId: ctx.job.ownerId, dir, config },
      ctx.progress,
    );
    const spec = deps.planPolaroidCarousel({
      images: stats.map((s, i) => ({ assetId: s.assetId, caption: input.captions[i] ?? "" })),
      slideCount: input.slides,
      slideAspect: input.slideAspect,
    });
    await ctx.progress(PROGRESS_AFTER_PLAN);

    const slidePaths = await deps.renderPolaroidSlides({
      spec,
      sourcePaths,
      fontPath: path.resolve(config.polaroidFontPath),
      outputDir: dir,
      format: input.format,
    });
    const zipPath = path.join(dir, "polaroid.zip");
    await deps.writeZip(slidePaths, zipPath);
    await ctx.progress(PROGRESS_AFTER_RENDER);

    return await storeOutputs(deps, {
      jobId: ctx.job.id,
      ownerId: ctx.job.ownerId,
      slidePaths,
      zipPath,
      format: input.format,
      slideWidth: spec.slide.w,
      slideHeight: spec.slide.h,
    });
  } finally {
    await deps.rm(dir, { recursive: true, force: true });
  }
}

export function createBuildPolaroidProcessor(
  overrides: Partial<BuildPolaroidDeps> = {},
): (job: Job<JobData>) => Promise<void> {
  const deps: BuildPolaroidDeps = { ...defaultDeps, ...overrides };
  return async (job) => {
    await deps.runJob(
      {
        jobId: job.data.jobId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      },
      (ctx) => buildPolaroid(deps, ctx),
      deps.runJobDeps,
    );
  };
}

export const buildPolaroidProcessor = createBuildPolaroidProcessor();

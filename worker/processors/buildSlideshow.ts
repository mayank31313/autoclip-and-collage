import { mkdtemp as fsMkdtemp, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Job } from "bullmq";
import { planSlideshowTimeline } from "@/lib/planner/slideshow/plan";
import type { JobData } from "@/lib/schemas/job";
import {
  SlideshowSpec,
  SlideshowWorkerInput,
  type SlideshowWorkerResult,
} from "@/lib/schemas/slideshow";
import { getConfig } from "@/server/config";
import { assetsRepo as defaultAssetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import {
  renderPerSlideVideos as defaultRenderPerSlide,
  renderSlideshowMaster as defaultRenderMaster,
} from "@/server/renderers/slideshow";
import { writeZip as defaultWriteZip } from "@/server/renderers/zip";
import {
  downloadObjectToFile as defaultDownload,
  uploadFile as defaultUpload,
} from "@/server/storage/objects";
import { runJob as defaultRunJob, type RunJobDeps } from "../runJob";

export interface BuildSlideshowDeps {
  assetsRepo: Pick<typeof defaultAssetsRepo, "getForOwner" | "register">;
  downloadObjectToFile: typeof defaultDownload;
  uploadFile: typeof defaultUpload;
  renderPerSlide: typeof defaultRenderPerSlide;
  renderMaster: typeof defaultRenderMaster;
  writeZip: typeof defaultWriteZip;
  mkdtemp: typeof fsMkdtemp;
  rm: typeof fsRm;
  runJob: typeof defaultRunJob;
  runJobDeps?: RunJobDeps;
}

const defaultDeps: BuildSlideshowDeps = {
  assetsRepo: defaultAssetsRepo,
  downloadObjectToFile: defaultDownload,
  uploadFile: defaultUpload,
  renderPerSlide: defaultRenderPerSlide,
  renderMaster: defaultRenderMaster,
  writeZip: defaultWriteZip,
  mkdtemp: fsMkdtemp,
  rm: fsRm,
  runJob: defaultRunJob,
};

const TEMP_PREFIX = "slideshow-";
const PROGRESS_AFTER_DOWNLOADS = 40;
const PROGRESS_AFTER_SLIDES = 80;
const PROGRESS_AFTER_MASTER = 92;
const MP4_CONTENT_TYPE = "video/mp4";
const ZIP_CONTENT_TYPE = "application/zip";

function userError(code: "VALIDATION_FAILED" | "NOT_FOUND", message: string): AppError {
  return new AppError(code, code === "NOT_FOUND" ? 404 : 400, message);
}

function parseInput(raw: unknown): SlideshowWorkerInput {
  const parsed = SlideshowWorkerInput.safeParse(raw);
  if (!parsed.success) {
    throw userError("VALIDATION_FAILED", "Slideshow job input is invalid");
  }
  return parsed.data;
}

/**
 * The API route checked these bounds at creation time, but a persisted job row can be tampered
 * with directly (or Config can change between enqueue and execution), so every runtime limit is
 * re-checked here from the current Config before any FFmpeg work starts.
 */
function checkLimits(input: SlideshowWorkerInput, spec: SlideshowSpec): void {
  const {
    slideshowMaxSlides,
    slideshowMaxSlideSec,
    slideshowMaxDurationSec,
    slideshowMaxTransitionSec,
  } = getConfig();
  if (input.sources.length > slideshowMaxSlides) {
    throw userError(
      "VALIDATION_FAILED",
      `A slideshow accepts at most ${slideshowMaxSlides} sources`,
    );
  }
  for (const source of input.sources) {
    if (source.durationSec > slideshowMaxSlideSec) {
      throw userError("VALIDATION_FAILED", `durationSec must not exceed ${slideshowMaxSlideSec}s`);
    }
  }
  if (input.slideshow.transitionSec > slideshowMaxTransitionSec) {
    throw userError(
      "VALIDATION_FAILED",
      `transitionSec must not exceed ${slideshowMaxTransitionSec}s`,
    );
  }
  if (spec.masterDurationSec > slideshowMaxDurationSec) {
    throw userError(
      "VALIDATION_FAILED",
      `masterDurationSec must not exceed ${slideshowMaxDurationSec}s`,
    );
  }
}

function buildSpec(input: SlideshowWorkerInput): SlideshowSpec {
  const raw = planSlideshowTimeline({
    canvas: input.slideshow.canvas,
    fps: input.slideshow.fps,
    transition: input.slideshow.transition,
    transitionSec: input.slideshow.transitionSec,
    sources: input.sources.map((source) => ({
      assetId: source.assetId,
      kind: source.kind,
      durationSec: source.durationSec,
      startSec: source.startSec,
      endSec: source.endSec,
      fit: source.fit,
    })),
  });
  const parsed = SlideshowSpec.safeParse(raw);
  if (!parsed.success) {
    throw userError(
      "VALIDATION_FAILED",
      parsed.error.issues[0]?.message ?? "Invalid slideshow timeline",
    );
  }
  return parsed.data;
}

async function resolveSourceAsset(
  deps: BuildSlideshowDeps,
  assetId: string,
  ownerId: string,
  expectedKind: "image" | "video",
) {
  const asset = await deps.assetsRepo.getForOwner(assetId, ownerId);
  if (!asset) throw userError("NOT_FOUND", "Source asset not found");
  if (asset.kind !== expectedKind) {
    throw userError("VALIDATION_FAILED", "Source asset kind does not match the request");
  }
  return asset;
}

/** Sequential on purpose: FFmpeg normalization downstream is CPU-heavy and already bounded per worker. */
async function downloadSources(
  deps: BuildSlideshowDeps,
  args: { input: SlideshowWorkerInput; ownerId: string; dir: string },
  progress: (progress: number) => Promise<void>,
): Promise<Map<string, string>> {
  const { maxImageUploadBytes, maxUploadBytes } = getConfig();
  const sourcePaths = new Map<string, string>();
  const { sources } = args.input;
  for (const [index, source] of sources.entries()) {
    const asset = await resolveSourceAsset(deps, source.assetId, args.ownerId, source.kind);
    const file = path.join(args.dir, `source-${index}`);
    const maxBytes = source.kind === "image" ? maxImageUploadBytes : maxUploadBytes;
    await deps.downloadObjectToFile(asset.key, file, maxBytes);
    sourcePaths.set(source.assetId, file);
    await progress(Math.round(((index + 1) / sources.length) * PROGRESS_AFTER_DOWNLOADS));
  }
  return sourcePaths;
}

interface StoreArgs {
  ownerId: string;
  key: string;
  filePath: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

/** Fixed keys per job: a retry overwrites the object and re-registers the same asset. */
async function storeOutput(deps: BuildSlideshowDeps, args: StoreArgs): Promise<string> {
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
  deps: BuildSlideshowDeps,
  args: {
    jobId: string;
    ownerId: string;
    masterPath: string;
    slidePaths: readonly string[];
    zipPath: string;
    spec: SlideshowSpec;
  },
): Promise<SlideshowWorkerResult> {
  const { jobId, ownerId, spec } = args;
  const masterAssetId = await storeOutput(deps, {
    ownerId,
    key: `outputs/${jobId}/master.mp4`,
    filePath: args.masterPath,
    contentType: MP4_CONTENT_TYPE,
    metadata: {
      width: spec.canvas.w,
      height: spec.canvas.h,
      fps: spec.fps,
      durationSec: spec.masterDurationSec,
    },
  });
  const slideAssetIds: string[] = [];
  for (const [index, filePath] of args.slidePaths.entries()) {
    slideAssetIds.push(
      await storeOutput(deps, {
        ownerId,
        key: `outputs/${jobId}/slide-${index}.mp4`,
        filePath,
        contentType: MP4_CONTENT_TYPE,
        metadata: { index, durationSec: spec.slides[index]?.durationSec },
      }),
    );
  }
  const zipAssetId = await storeOutput(deps, {
    ownerId,
    key: `outputs/${jobId}/slideshow.zip`,
    filePath: args.zipPath,
    contentType: ZIP_CONTENT_TYPE,
    metadata: { slideCount: args.slidePaths.length },
  });
  return {
    masterAssetId,
    zipAssetId,
    slideAssetIds,
    width: spec.canvas.w,
    height: spec.canvas.h,
    fps: spec.fps,
    durationSec: spec.masterDurationSec,
  };
}

async function buildSlideshow(
  deps: BuildSlideshowDeps,
  ctx: {
    job: { id: string; ownerId: string; input: unknown };
    progress: (progress: number) => Promise<void>;
  },
): Promise<SlideshowWorkerResult> {
  const input = parseInput(ctx.job.input);
  const spec = buildSpec(input);
  checkLimits(input, spec);

  const dir = await deps.mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const sourcePaths = await downloadSources(
      deps,
      { input, ownerId: ctx.job.ownerId, dir },
      ctx.progress,
    );

    const slidePaths = await deps.renderPerSlide({ spec, sourcePaths, dir });
    await ctx.progress(PROGRESS_AFTER_SLIDES);

    const masterPath = path.join(dir, "master.mp4");
    await deps.renderMaster({ slidePaths, spec, outputPath: masterPath });
    await ctx.progress(PROGRESS_AFTER_MASTER);

    const zipPath = path.join(dir, "slideshow.zip");
    await deps.writeZip([masterPath, ...slidePaths], zipPath);

    return await storeOutputs(deps, {
      jobId: ctx.job.id,
      ownerId: ctx.job.ownerId,
      masterPath,
      slidePaths,
      zipPath,
      spec,
    });
  } finally {
    await deps.rm(dir, { recursive: true, force: true });
  }
}

export function createBuildSlideshowProcessor(
  overrides: Partial<BuildSlideshowDeps> = {},
): (job: Job<JobData>) => Promise<void> {
  const deps: BuildSlideshowDeps = { ...defaultDeps, ...overrides };
  return async (job) => {
    await deps.runJob(
      {
        jobId: job.data.jobId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      },
      (ctx) => buildSlideshow(deps, ctx),
      deps.runJobDeps,
    );
  };
}

export const buildSlideshowProcessor = createBuildSlideshowProcessor();

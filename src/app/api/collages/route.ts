import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CollageTemplateSpec, CollageWorkerInput } from "@/lib/schemas/collage";
import { CreateCollageBody, type CreateCollageResponse } from "@/lib/schemas/api";
import { RECTANGULAR_TEMPLATE_ID } from "@/lib/schemas/collageTemplate";
import {
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
} from "@/lib/planner/collage/polaroid/defaults";
import {
  resolvePolaroidOptions,
  type ResolvedPolaroidOptions,
} from "@/lib/planner/collage/polaroid/options";
import { planSlideshowTimeline } from "@/lib/planner/slideshow/plan";
import { POLAROID_JOB_TYPE, type PolaroidWorkerInput } from "@/lib/schemas/polaroid";
import {
  SLIDESHOW_JOB_TYPE,
  SlideshowSpec,
  type SlideshowWorkerInput,
} from "@/lib/schemas/slideshow";
import { isSupportedImageMime } from "@/server/analyzers/image/metadata";
import { inspectVideo } from "@/server/analyzers/video/metadata";
import { getConfig } from "@/server/config";
import { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { enqueueJob } from "@/server/queue/queues";
import { downloadObjectToFile, headObject } from "@/server/storage/objects";
import { findCollageTemplate } from "@/server/templates/collageTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_MIME_EXTENSIONS: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
]);
const DURATION_EPSILON_SEC = 1e-6;
const SLIDESHOW_TEMP_PREFIX = "slideshow-probe-";

function invalid(message: string, details?: unknown): AppError {
  return new AppError("VALIDATION_FAILED", 400, message, details);
}

// One error for foreign and missing keys so another owner's uploads are never confirmed.
function imageNotFound(): AppError {
  return new AppError("NOT_FOUND", 404, "Image upload not found");
}

function isMissingObject(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, $metadata } = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return name === "NotFound" || name === "NoSuchKey" || $metadata?.httpStatusCode === 404;
}

type GridBody = Extract<CreateCollageBody, { mode: "grid" }>;
type PolaroidBody = Extract<CreateCollageBody, { mode: "polaroid" }>;

function checkImageCount(count: number): void {
  const { collageMaxImages } = getConfig();
  if (count > collageMaxImages) {
    throw invalid(`A collage accepts at most ${collageMaxImages} images`, { collageMaxImages });
  }
}

function checkCanvasLimits(canvas: GridBody["canvas"]): void {
  const { collageMaxCanvasPixels, collageMaxDimension } = getConfig();
  const { w, h } = canvas;
  if (w > collageMaxDimension || h > collageMaxDimension) {
    throw invalid(`Canvas sides must not exceed ${collageMaxDimension} px`, {
      collageMaxDimension,
    });
  }
  if (w * h > collageMaxCanvasPixels) {
    throw invalid(`Canvas must not exceed ${collageMaxCanvasPixels} pixels`, {
      collageMaxCanvasPixels,
    });
  }
}

function checkSpreadLimit(options: ResolvedPolaroidOptions): void {
  const { polaroidMaxSpreadPixels } = getConfig();
  const height = POLAROID_SLIDE_HEIGHT_PX[options.slideAspect];
  if (POLAROID_SLIDE_WIDTH_PX * options.slides * height > polaroidMaxSpreadPixels) {
    throw invalid(`Carousel must not exceed ${polaroidMaxSpreadPixels} pixels`, {
      polaroidMaxSpreadPixels,
    });
  }
}

function checkOwnedKey(key: string, ownerId: string): void {
  const owned = key.startsWith(`uploads/${ownerId}/`) && !key.split("/").includes("..");
  if (!owned) throw imageNotFound();
}

function extensionOf(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

interface VerifiedImage {
  key: string;
  contentType: string;
  sizeBytes: number;
}

async function verifyImage(key: string): Promise<VerifiedImage> {
  if (!IMAGE_EXTENSIONS.has(extensionOf(key))) throw invalid("Unsupported image extension");
  let head: Awaited<ReturnType<typeof headObject>>;
  try {
    head = await headObject(key);
  } catch (err) {
    if (isMissingObject(err)) throw imageNotFound();
    throw err;
  }
  const contentType = head.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isSupportedImageMime(contentType)) throw invalid("Unsupported image content type");
  const sizeBytes = head.sizeBytes;
  if (sizeBytes === undefined || sizeBytes <= 0) throw invalid("Image size is unavailable");
  const { maxImageUploadBytes } = getConfig();
  if (sizeBytes > maxImageUploadBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", 413, "Image exceeds the maximum upload size", {
      maxBytes: maxImageUploadBytes,
    });
  }
  return { key, contentType, sizeBytes };
}

/** Resolves the request's template to a full spec so the worker never reads template files. */
async function resolveTemplate(body: GridBody): Promise<CollageTemplateSpec | undefined> {
  if (body.customTemplate !== undefined) return body.customTemplate;
  if (body.template === undefined) return undefined;
  if (body.template === RECTANGULAR_TEMPLATE_ID) return RECTANGULAR_TEMPLATE_ID;
  const found = await findCollageTemplate(body.template);
  if (!found) throw invalid(`Unknown template ${body.template}`, { template: body.template });
  if (found.cells.length !== body.images.length) {
    throw invalid(`${found.id} requires exactly ${found.cells.length} images`, {
      template: found.id,
      imageCount: found.cells.length,
    });
  }
  return found;
}

async function registerImages(images: readonly string[], ownerId: string): Promise<string[]> {
  for (const key of images) checkOwnedKey(key, ownerId);
  const verified = await Promise.all(images.map(verifyImage));
  const sourceAssetIds: string[] = [];
  for (const image of verified) {
    const asset = await assetsRepo.register({ ownerId, kind: "image", ...image });
    sourceAssetIds.push(asset.id);
  }
  return sourceAssetIds;
}

async function createGridJob(body: GridBody, ownerId: string) {
  checkImageCount(body.images.length);
  checkCanvasLimits(body.canvas);
  const template = await resolveTemplate(body);
  const sourceAssetIds = await registerImages(body.images, ownerId);
  const input: CollageWorkerInput = {
    sourceAssetIds,
    style: body.style,
    ...(template !== undefined && { template }),
    ...(body.photoWallPreset !== undefined && { photoWallPreset: body.photoWallPreset }),
    canvas: body.canvas,
    format: body.format,
  };
  return enqueueJob({
    queue: "collage",
    type: "collage.build",
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
}

async function createPolaroidJob(body: PolaroidBody, ownerId: string) {
  checkImageCount(body.images.length);
  const options = resolvePolaroidOptions(body.polaroid, body.images.length);
  checkSpreadLimit(options);
  const sourceAssetIds = await registerImages(body.images, ownerId);
  const input: PolaroidWorkerInput = { sourceAssetIds, ...options, format: body.format };
  return enqueueJob({
    queue: "collage",
    type: POLAROID_JOB_TYPE,
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
}

type SlideshowBody = Extract<CreateCollageBody, { mode: "slideshow" }>;
type SlideshowSource = SlideshowBody["sources"][number];

interface VerifiedMedia {
  key: string;
  kind: "image" | "video";
  contentType: string;
  sizeBytes: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  width?: number;
  height?: number;
}

function checkSourceCount(count: number): void {
  const { slideshowMaxSlides } = getConfig();
  if (count > slideshowMaxSlides) {
    throw invalid(`A slideshow accepts at most ${slideshowMaxSlides} sources`, {
      slideshowMaxSlides,
    });
  }
}

/** Downloads a video source to a temp file only long enough to probe it with ffprobe. */
async function probeVideoDuration(key: string, maxBytes: number) {
  const dir = await mkdtemp(path.join(tmpdir(), SLIDESHOW_TEMP_PREFIX));
  try {
    const filePath = path.join(dir, "source");
    await downloadObjectToFile(key, filePath, maxBytes);
    return await inspectVideo(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifySlideshowSource(
  source: SlideshowSource,
  ownerId: string,
): Promise<VerifiedMedia> {
  checkOwnedKey(source.key, ownerId);
  let head: Awaited<ReturnType<typeof headObject>>;
  try {
    head = await headObject(source.key);
  } catch (err) {
    if (isMissingObject(err)) throw imageNotFound();
    throw err;
  }
  const sizeBytes = head.sizeBytes;
  if (sizeBytes === undefined || sizeBytes <= 0) throw invalid("Source size is unavailable");
  const contentType = head.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const { slideshowMaxSlideSec, maxImageUploadBytes, maxUploadBytes } = getConfig();

  if (source.kind === "image") {
    if (!isSupportedImageMime(contentType)) throw invalid("Unsupported image content type");
    if (sizeBytes > maxImageUploadBytes) {
      throw new AppError("PAYLOAD_TOO_LARGE", 413, "Image exceeds the maximum upload size", {
        maxBytes: maxImageUploadBytes,
      });
    }
    // durationSec is required for images by SlideshowSourceSchema's refinement.
    const durationSec = source.durationSec as number;
    if (durationSec > slideshowMaxSlideSec) {
      throw invalid(`durationSec must not exceed ${slideshowMaxSlideSec}s`);
    }
    return { key: source.key, kind: "image", contentType, sizeBytes, startSec: 0, endSec: durationSec, durationSec };
  }

  if (!VIDEO_MIME_EXTENSIONS.has(contentType)) throw invalid("Unsupported video content type");
  if (sizeBytes > maxUploadBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", 413, "Video exceeds the maximum upload size", {
      maxBytes: maxUploadBytes,
    });
  }
  const info = await probeVideoDuration(source.key, maxUploadBytes);
  const startSec = source.startSec ?? 0;
  const endSec = source.endSec ?? Math.min(info.durationSec, slideshowMaxSlideSec);
  if (startSec >= info.durationSec) throw invalid("startSec exceeds the probed video duration");
  if (endSec > info.durationSec + DURATION_EPSILON_SEC) {
    throw invalid("endSec exceeds the probed video duration");
  }
  const trimDurationSec = endSec - startSec;
  if (
    source.durationSec !== undefined &&
    Math.abs(source.durationSec - trimDurationSec) > DURATION_EPSILON_SEC
  ) {
    throw invalid("durationSec must equal endSec minus startSec");
  }
  if (trimDurationSec > slideshowMaxSlideSec) {
    throw invalid(`durationSec must not exceed ${slideshowMaxSlideSec}s`);
  }
  return {
    key: source.key,
    kind: "video",
    contentType,
    sizeBytes,
    startSec,
    endSec,
    durationSec: trimDurationSec,
    width: info.width,
    height: info.height,
  };
}

/** Validates the full timeline (durations, transitions, master length) before any asset is registered. */
function checkTimeline(
  slideshow: SlideshowBody["slideshow"],
  verified: readonly VerifiedMedia[],
  sources: readonly SlideshowSource[],
): void {
  const spec = planSlideshowTimeline({
    canvas: slideshow.canvas,
    fps: slideshow.fps,
    transition: slideshow.transition,
    transitionSec: slideshow.transitionSec,
    // The key stands in for the not-yet-registered asset id: still unique per source.
    sources: verified.map((media, index) => ({
      assetId: media.key,
      kind: media.kind,
      durationSec: media.durationSec,
      startSec: media.startSec,
      endSec: media.endSec,
      fit: sources[index].fit,
    })),
  });
  const parsed = SlideshowSpec.safeParse(spec);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? "Invalid slideshow timeline", {
      issues: parsed.error.issues,
    });
  }
}

async function registerSlideshowSources(
  verified: readonly VerifiedMedia[],
  sources: readonly SlideshowSource[],
  ownerId: string,
): Promise<SlideshowWorkerInput["sources"]> {
  const workerSources: SlideshowWorkerInput["sources"] = [];
  for (const [index, media] of verified.entries()) {
    const asset = await assetsRepo.register({
      ownerId,
      kind: media.kind,
      key: media.key,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      ...((media.width !== undefined || media.height !== undefined) && {
        metadata: { width: media.width, height: media.height, durationSec: media.durationSec },
      }),
    });
    workerSources.push({
      assetId: asset.id,
      kind: media.kind,
      durationSec: media.durationSec,
      startSec: media.startSec,
      endSec: media.endSec,
      fit: sources[index].fit,
    });
  }
  return workerSources;
}

async function createSlideshowJob(body: SlideshowBody, ownerId: string) {
  checkSourceCount(body.sources.length);
  const verified: VerifiedMedia[] = [];
  for (const source of body.sources) verified.push(await verifySlideshowSource(source, ownerId));
  checkTimeline(body.slideshow, verified, body.sources);
  const sources = await registerSlideshowSources(verified, body.sources, ownerId);
  const input: SlideshowWorkerInput = { sources, slideshow: body.slideshow };
  return enqueueJob({
    queue: "collage",
    type: SLIDESHOW_JOB_TYPE,
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
}

export const POST = withApi({ auth: "apiKey", body: CreateCollageBody }, async ({ body, ctx }) => {
  const ownerId = requirePrincipal(ctx).id;
  const job =
    body.mode === "polaroid"
      ? await createPolaroidJob(body, ownerId)
      : body.mode === "slideshow"
        ? await createSlideshowJob(body, ownerId)
        : await createGridJob(body, ownerId);
  const json: CreateCollageResponse = { jobId: job.id };
  return { status: 202, json };
});

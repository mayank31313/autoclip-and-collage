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
import { POLAROID_JOB_TYPE, type PolaroidWorkerInput } from "@/lib/schemas/polaroid";
import { isSupportedImageMime } from "@/server/analyzers/image/metadata";
import { getConfig } from "@/server/config";
import { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { enqueueJob } from "@/server/queue/queues";
import { headObject } from "@/server/storage/objects";
import { findCollageTemplate } from "@/server/templates/collageTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "webp"]);

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

export const POST = withApi({ auth: "apiKey", body: CreateCollageBody }, async ({ body, ctx }) => {
  const ownerId = requirePrincipal(ctx).id;
  const job =
    body.mode === "polaroid"
      ? await createPolaroidJob(body, ownerId)
      : await createGridJob(body, ownerId);
  const json: CreateCollageResponse = { jobId: job.id };
  return { status: 202, json };
});

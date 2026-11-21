import type { CollageWorkerInput } from "@/lib/schemas/collage";
import { CreateCollageBody, type CreateCollageResponse } from "@/lib/schemas/api";
import { isSupportedImageMime } from "@/server/analyzers/image/metadata";
import { getConfig } from "@/server/config";
import { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { enqueueJob } from "@/server/queue/queues";
import { headObject } from "@/server/storage/objects";

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

function checkLimits(body: CreateCollageBody): void {
  const { collageMaxImages, collageMaxCanvasPixels, collageMaxDimension } = getConfig();
  if (body.images.length > collageMaxImages) {
    throw invalid(`A collage accepts at most ${collageMaxImages} images`, { collageMaxImages });
  }
  const { w, h } = body.canvas;
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

export const POST = withApi({ auth: "apiKey", body: CreateCollageBody }, async ({ body, ctx }) => {
  const ownerId = requirePrincipal(ctx).id;
  checkLimits(body);
  for (const key of body.images) checkOwnedKey(key, ownerId);
  const verified = await Promise.all(body.images.map(verifyImage));

  const sourceAssetIds: string[] = [];
  for (const image of verified) {
    const asset = await assetsRepo.register({ ownerId, kind: "image", ...image });
    sourceAssetIds.push(asset.id);
  }

  const input: CollageWorkerInput = {
    sourceAssetIds,
    style: body.style,
    ...(body.template !== undefined && { template: body.template }),
    canvas: body.canvas,
    format: body.format,
  };
  const job = await enqueueJob({
    queue: "collage",
    type: "collage.build",
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
  const json: CreateCollageResponse = { jobId: job.id };
  return { status: 202, json };
});

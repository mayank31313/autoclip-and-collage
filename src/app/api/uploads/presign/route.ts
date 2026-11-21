import { randomUUID } from "node:crypto";
import { PresignBody, type PresignResponse } from "@/lib/schemas/api";
import { getConfig } from "@/server/config";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { buildUploadKey } from "@/server/storage/keys";
import { presignPut } from "@/server/storage/presign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ auth: "apiKey", body: PresignBody }, async ({ body, ctx }) => {
  const { maxUploadBytes, maxImageUploadBytes } = getConfig();
  const maxBytes = body.contentType.startsWith("image/") ? maxImageUploadBytes : maxUploadBytes;
  if (body.sizeBytes > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", 413, "File exceeds the maximum upload size", {
      maxBytes,
    });
  }
  const key = buildUploadKey({
    ownerId: requirePrincipal(ctx).id,
    uploadId: randomUUID(),
    filename: body.filename,
  });
  const { url, expiresInSec } = await presignPut({
    key,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
  });
  const json: PresignResponse = { url, key, expiresInSec };
  return { json };
});

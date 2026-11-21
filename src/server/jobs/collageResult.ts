import { CollageJobResult } from "@/lib/schemas/api";
import { CollageWorkerResult } from "@/lib/schemas/collage";
import { getConfig } from "@/server/config";
import { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import { presignGet } from "@/server/storage/presign";

export const COLLAGE_JOB_TYPE = "collage.build";

export interface CollageResultIo {
  getAsset(id: string, ownerId: string): Promise<{ key: string; kind: string } | undefined>;
  presign(key: string): Promise<string>;
  expiresInSec: number;
}

function defaultIo(): CollageResultIo {
  return {
    getAsset: (id, ownerId) => assetsRepo.getForOwner(id, ownerId),
    presign: presignGet,
    expiresInSec: getConfig().presignTtlSec,
  };
}

function unavailable(): AppError {
  return new AppError("INTERNAL", 500, "Job result is unavailable");
}

/**
 * Turns a succeeded collage job's stored result (asset reference) into the public result with a
 * freshly signed URL. The asset must belong to the job owner, so a tampered result cannot leak
 * another owner's object. Never exposes the asset ID or key.
 */
export async function resolveCollageResult(
  job: { ownerId: string; result: unknown },
  io: CollageResultIo = defaultIo(),
): Promise<CollageJobResult> {
  const stored = CollageWorkerResult.safeParse(job.result);
  if (!stored.success) throw unavailable();
  const asset = await io.getAsset(stored.data.outputAssetId, job.ownerId);
  if (!asset || asset.kind !== "output") throw unavailable();
  const { width, height, format } = stored.data;
  const downloadUrl = await io.presign(asset.key);
  return CollageJobResult.parse({
    output: { width, height, format, downloadUrl, expiresInSec: io.expiresInSec },
  });
}

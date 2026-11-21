import { PolaroidJobResult } from "@/lib/schemas/api";
import { PolaroidWorkerResult } from "@/lib/schemas/polaroid";
import { defaultIo, unavailable, type CollageResultIo } from "./collageResult";

/**
 * Turns a succeeded polaroid job's stored result (asset references) into the public result with
 * freshly signed URLs. Every asset must be an output owned by the job owner, so a tampered result
 * cannot leak another owner's object. Never exposes asset IDs or keys.
 */
export async function resolvePolaroidResult(
  job: { ownerId: string; result: unknown },
  io: CollageResultIo = defaultIo(),
): Promise<PolaroidJobResult> {
  const stored = PolaroidWorkerResult.safeParse(job.result);
  if (!stored.success) throw unavailable();
  const { zipAssetId, slideAssetIds, slideWidth, slideHeight, format } = stored.data;
  const assets = await Promise.all(
    [zipAssetId, ...slideAssetIds].map((id) => io.getAsset(id, job.ownerId)),
  );
  const keys: string[] = [];
  for (const asset of assets) {
    if (!asset || asset.kind !== "output") throw unavailable();
    keys.push(asset.key);
  }
  const [zipUrl, ...slideUrls] = await Promise.all(keys.map((key) => io.presign(key)));
  return PolaroidJobResult.parse({
    output: {
      slideCount: slideUrls.length,
      slideWidth,
      slideHeight,
      slideFormat: format,
      zipUrl,
      slides: slideUrls.map((url, index) => ({ index, url })),
      expiresInSec: io.expiresInSec,
    },
  });
}

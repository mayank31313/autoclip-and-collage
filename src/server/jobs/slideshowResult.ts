import { SlideshowJobResult } from "@/lib/schemas/api";
import {
  SLIDESHOW_JOB_TYPE,
  SlideshowWorkerInput,
  SlideshowWorkerResult,
} from "@/lib/schemas/slideshow";
import { defaultIo, unavailable, type CollageResultIo } from "./collageResult";

export { SLIDESHOW_JOB_TYPE };

/**
 * Turns a succeeded slideshow job's stored result (asset references) into the public result with
 * freshly signed URLs. Every asset must be an output owned by the job owner, so a tampered result
 * cannot leak another owner's object. Never exposes asset IDs or keys.
 *
 * Per-slide durations are not stored on the result (the worker only persists asset references and
 * aggregate dimensions/duration), so they are read back from the job's own validated input, in the
 * same order the worker registered `slideAssetIds`.
 */
export async function resolveSlideshowResult(
  job: { ownerId: string; result: unknown; input: unknown },
  io: CollageResultIo = defaultIo(),
): Promise<SlideshowJobResult> {
  const stored = SlideshowWorkerResult.safeParse(job.result);
  if (!stored.success) throw unavailable();
  const { masterAssetId, zipAssetId, slideAssetIds, width, height, fps, durationSec } =
    stored.data;

  const input = SlideshowWorkerInput.safeParse(job.input);
  if (!input.success || input.data.sources.length !== slideAssetIds.length) throw unavailable();
  const slideDurations = input.data.sources.map((source) => source.durationSec);

  const assets = await Promise.all(
    [masterAssetId, zipAssetId, ...slideAssetIds].map((id) => io.getAsset(id, job.ownerId)),
  );
  const keys: string[] = [];
  for (const asset of assets) {
    if (!asset || asset.kind !== "output") throw unavailable();
    keys.push(asset.key);
  }
  const [masterUrl, zipUrl, ...slideUrls] = await Promise.all(keys.map((key) => io.presign(key)));
  return SlideshowJobResult.parse({
    output: {
      width,
      height,
      fps,
      durationSec,
      format: "mp4",
      masterUrl,
      zipUrl,
      slides: slideUrls.map((url, index) => ({
        index,
        durationSec: slideDurations[index],
        url,
      })),
      expiresInSec: io.expiresInSec,
    },
  });
}
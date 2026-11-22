import { AppError } from "@/server/http/errors";
import { type MediaInfo, probeMedia } from "@/server/renderers/ffprobe";

function invalid(message: string): AppError {
  return new AppError("VALIDATION_FAILED", 400, message);
}

/**
 * Probes a downloaded video file with `ffprobe` and validates it has a usable video stream and a
 * positive duration. Audio-only or unprobeable files are rejected before any further processing.
 */
export async function inspectVideo(path: string): Promise<MediaInfo> {
  let info: MediaInfo;
  try {
    info = await probeMedia(path);
  } catch {
    throw invalid("Video is corrupt or could not be probed");
  }
  if (!info.hasVideo) throw invalid("Source has no video stream");
  if (info.durationSec <= 0) throw invalid("Video duration is unavailable");
  return info;
}
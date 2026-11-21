import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const ProbeSchema = z.object({
  format: z.object({ duration: z.string().optional() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
    }),
  ),
});

export interface MediaInfo {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

function parseFps(rate?: string): number | undefined {
  const [n, d] = (rate ?? "").split("/").map(Number);
  return n > 0 && d > 0 ? n / d : undefined;
}

export function parseProbe(json: unknown): MediaInfo {
  const p = ProbeSchema.parse(json);
  const durationSec = z
    .number()
    .finite()
    .nonnegative()
    .parse(p.format.duration === undefined ? 0 : Number(p.format.duration));
  const video = p.streams.find((s) => s.codec_type === "video");
  return {
    durationSec,
    hasVideo: Boolean(video),
    hasAudio: p.streams.some((s) => s.codec_type === "audio"),
    width: video?.width,
    height: video?.height,
    fps: parseFps(video?.avg_frame_rate),
  };
}

/** `execFile` passes args as an array with no shell, so paths cannot inject options after `--`. */
export async function probeMedia(
  path: string,
  opts: { timeoutMs?: number } = {},
): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", path],
    { timeout: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
  );
  return parseProbe(JSON.parse(stdout));
}

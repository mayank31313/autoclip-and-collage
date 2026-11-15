import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFfmpeg } from "@/server/renderers/ffmpeg";
import { probeMedia } from "@/server/renderers/ffprobe";

describe("ffmpeg integration", () => {
  it("renders a tiny clip and probes it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ffmpeg-test-"));
    try {
      const out = path.join(dir, "t.mp4");
      await runFfmpeg(
        [
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=160x120:rate=10:duration=1",
          "-pix_fmt",
          "yuv420p",
          out,
        ],
        { timeoutMs: 30_000 },
      );
      expect((await stat(out)).size).toBeGreaterThan(0);
      const info = await probeMedia(out);
      expect(info).toMatchObject({ hasVideo: true, width: 160, height: 120 });
      expect(info.durationSec).toBeGreaterThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects with stderr tail on failure", async () => {
    await expect(
      runFfmpeg(["-i", "does-not-exist.mp4", "-f", "null", "-"], { timeoutMs: 10_000 }),
    ).rejects.toThrow(/ffmpeg exited/);
  });
  it("kills the process on timeout", async () => {
    await expect(
      runFfmpeg(["-f", "lavfi", "-i", "testsrc=duration=600", "-f", "null", "-"], {
        timeoutMs: 200,
      }),
    ).rejects.toThrow();
  });
  it("rejects immediately when the signal is already aborted", async () => {
    await expect(
      runFfmpeg(["-f", "lavfi", "-i", "testsrc=duration=600", "-f", "null", "-"], {
        timeoutMs: 10_000,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(/aborted/);
  });
});

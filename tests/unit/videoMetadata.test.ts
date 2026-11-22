import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ probeMedia: vi.fn() }));
vi.mock("@/server/renderers/ffprobe", () => ({ probeMedia: mocks.probeMedia }));

import { inspectVideo } from "@/server/analyzers/video/metadata";

describe("inspectVideo", () => {
  it("returns probed info for a valid video", async () => {
    mocks.probeMedia.mockResolvedValue({
      durationSec: 5,
      hasVideo: true,
      hasAudio: true,
      width: 640,
      height: 480,
      fps: 30,
    });
    await expect(inspectVideo("/tmp/a.mp4")).resolves.toMatchObject({
      durationSec: 5,
      hasVideo: true,
      width: 640,
      height: 480,
    });
  });

  it("rejects a source with no video stream", async () => {
    mocks.probeMedia.mockResolvedValue({ durationSec: 5, hasVideo: false, hasAudio: true });
    await expect(inspectVideo("/tmp/a.mp3")).rejects.toThrow("no video stream");
  });

  it("rejects a zero-duration source", async () => {
    mocks.probeMedia.mockResolvedValue({ durationSec: 0, hasVideo: true, hasAudio: false });
    await expect(inspectVideo("/tmp/a.mp4")).rejects.toThrow("duration is unavailable");
  });

  it("rejects when ffprobe fails", async () => {
    mocks.probeMedia.mockRejectedValue(new Error("boom"));
    await expect(inspectVideo("/tmp/a.mp4")).rejects.toThrow("could not be probed");
  });
});
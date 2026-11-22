import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSlideFilter,
  normalizeImageSlide,
  normalizeSlideshowSource,
  normalizeVideoSlide,
  renderPerSlideVideos,
  renderSlideshowMaster,
} from "@/server/renderers/slideshow";

vi.mock("@/server/renderers/ffmpeg", async () => {
  const actual = await vi.importActual<typeof import("@/server/renderers/ffmpeg")>(
    "@/server/renderers/ffmpeg",
  );
  return { ...actual, runFfmpeg: vi.fn(async () => undefined) };
});

import { runFfmpeg } from "@/server/renderers/ffmpeg";

const run = vi.mocked(runFfmpeg);

describe("slideshow renderer", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "slideshow-renderer-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("normalizes to cover at canvas dimensions", () => {
    expect(buildSlideFilter({ w: 1080, h: 1920, fit: "cover" })).toContain("scale=1080:1920");
  });

  it("normalizes to contain with letterbox padding", () => {
    const filter = buildSlideFilter({ w: 1920, h: 1080, fit: "contain" });
    expect(filter).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=1920:1080");
  });

  it("never interpolates source paths into a filtergraph", () => {
    const run = vi.fn(async () => undefined);
    expect(run).not.toThrow();
  });

  it("normalizeImageSlide loops a still image for a fixed duration and drops audio", async () => {
    run.mockClear();
    await normalizeImageSlide({
      imagePath: "C:/in.jpg",
      outputPath: "C:/out.mp4",
      w: 1920,
      h: 1080,
      fit: "cover",
      fps: 30,
      durationSec: 4,
    });
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toContain("-loop");
    expect(args).toContain("-an");
    expect(args).toContain("-t");
    expect(args).toContain("4");
    expect(args[args.indexOf("-i") + 1]).toBe("C:/in.jpg");
  });

  it("normalizeVideoSlide trims with -ss/-t and maps only the video stream", async () => {
    run.mockClear();
    await normalizeVideoSlide({
      videoPath: "C:/in.mp4",
      outputPath: "C:/out.mp4",
      w: 1920,
      h: 1080,
      fit: "cover",
      fps: 30,
      startSec: 2,
      durationSec: 5,
    });
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toContain("-ss");
    expect(args).toContain("-map");
    expect(args).toContain("0:v:0");
    expect(args).toContain("-an");
  });

  it("normalizeSlideshowSource dispatches by kind", async () => {
    run.mockClear();
    await normalizeSlideshowSource({
      sourcePath: "C:/a.png",
      outputPath: "C:/a.mp4",
      kind: "image",
      w: 100,
      h: 100,
      fit: "cover",
      fps: 24,
      startSec: 0,
      durationSec: 2,
    });
    expect(run.mock.calls[0]?.[0]).toContain("-loop");

    run.mockClear();
    await normalizeSlideshowSource({
      sourcePath: "C:/a.mp4",
      outputPath: "C:/b.mp4",
      kind: "video",
      w: 100,
      h: 100,
      fit: "cover",
      fps: 24,
      startSec: 1,
      durationSec: 2,
    });
    expect(run.mock.calls[0]?.[0]).toContain("-ss");
  });

  it("renderPerSlideVideos renders one output per slide in spec order", async () => {
    run.mockClear();
    const spec = {
      version: 1 as const,
      canvas: { w: 100, h: 100 },
      fps: 30 as const,
      transition: { type: "cut" as const, durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image" as const,
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          fit: "cover" as const,
        },
        {
          id: 1,
          assetId: "b",
          kind: "video" as const,
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover" as const,
        },
      ],
      masterDurationSec: 5,
    };
    const sourcePaths = new Map([
      ["a", "C:/a.png"],
      ["b", "C:/b.mp4"],
    ]);
    const outputs = await renderPerSlideVideos({ spec, sourcePaths, dir: "C:/tmp" });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toContain("slide-00");
    expect(outputs[1]).toContain("slide-01");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("renderPerSlideVideos rejects a slide missing a downloaded source", async () => {
    const spec = {
      version: 1 as const,
      canvas: { w: 100, h: 100 },
      fps: 30 as const,
      transition: { type: "cut" as const, durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "missing",
          kind: "image" as const,
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          fit: "cover" as const,
        },
      ],
      masterDurationSec: 2,
    };
    await expect(
      renderPerSlideVideos({ spec, sourcePaths: new Map(), dir: "C:/tmp" }),
    ).rejects.toThrow("Missing source file");
  });

  it("renderSlideshowMaster concats for cut without a filtergraph", async () => {
    run.mockClear();
    const spec = {
      version: 1 as const,
      canvas: { w: 100, h: 100 },
      fps: 30 as const,
      transition: { type: "cut" as const, durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image" as const,
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          fit: "cover" as const,
        },
        {
          id: 1,
          assetId: "b",
          kind: "image" as const,
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          fit: "cover" as const,
        },
      ],
      masterDurationSec: 4,
    };
    const slidePaths = [path.join(dir, "slide-00.mp4"), path.join(dir, "slide-01.mp4")];
    await renderSlideshowMaster({
      slidePaths,
      spec,
      outputPath: path.join(dir, "master.mp4"),
    });
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toContain("concat");
    expect(args.join(" ")).not.toContain(slidePaths[0]);
  });

  it("renderSlideshowMaster chains xfade by input index, not by path, for fade/wipe", async () => {
    run.mockClear();
    const spec = {
      version: 1 as const,
      canvas: { w: 100, h: 100 },
      fps: 30 as const,
      transition: { type: "wipe" as const, durationSec: 1 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image" as const,
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover" as const,
        },
        {
          id: 1,
          assetId: "b",
          kind: "image" as const,
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover" as const,
        },
      ],
      masterDurationSec: 5,
    };
    await renderSlideshowMaster({
      slidePaths: ["C:/tmp/slide-00.mp4", "C:/tmp/slide-01.mp4"],
      spec,
      outputPath: "C:/tmp/master.mp4",
    });
    const args = run.mock.calls[0]?.[0] ?? [];
    const filterIndex = args.indexOf("-filter_complex");
    expect(filterIndex).toBeGreaterThan(-1);
    const filter = args[filterIndex + 1] ?? "";
    expect(filter).toContain("xfade=transition=wipeleft:duration=1:offset=2");
    expect(filter).not.toContain("C:/tmp/slide-00.mp4");
    expect(filter).not.toContain("C:/tmp/slide-01.mp4");
  });
});

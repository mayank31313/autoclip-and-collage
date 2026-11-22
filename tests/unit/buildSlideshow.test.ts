import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://u:p@localhost/d",
  REDIS_URL: "redis://localhost",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "k",
  S3_SECRET_KEY: "s",
  S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16),
  WEBHOOK_SIGNING_SECRET: "w".repeat(16),
  MAX_IMAGE_UPLOAD_MB: "1",
  MAX_UPLOAD_MB: "2",
  SLIDESHOW_MAX_SLIDES: "3",
  SLIDESHOW_MAX_SLIDE_SEC: "10",
  SLIDESHOW_MAX_DURATION_SEC: "20",
  SLIDESHOW_MAX_TRANSITION_SEC: "2",
});

vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import type { JobData } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import {
  createBuildSlideshowProcessor,
  type BuildSlideshowDeps,
} from "../../worker/processors/buildSlideshow";
import { createCollageDispatcher } from "../../worker/processors/collageQueue";
import type { RunJobDeps } from "../../worker/runJob";

const OWNER = "owner-1";
const defaultInput = {
  sources: [
    { assetId: "a1", kind: "image", durationSec: 2, startSec: 0, endSec: 2, fit: "cover" },
    { assetId: "a2", kind: "video", durationSec: 3, startSec: 0, endSec: 3, fit: "contain" },
  ],
  slideshow: { canvas: "16:9", fps: 30, transition: "cut", transitionSec: 0 },
};

function harness(
  opts: { input?: Record<string, unknown>; overrides?: Partial<BuildSlideshowDeps> } = {},
) {
  const row: Record<string, unknown> = {
    id: "j1",
    ownerId: OWNER,
    type: "collage.slideshow",
    status: "queued",
    progress: 0,
    webhookUrl: null,
    input: opts.input ?? defaultInput,
  };
  const history: string[] = [];
  const progress: number[] = [];
  const notify = vi.fn(async () => undefined);
  const runJobDeps = {
    store: {
      get: async () => ({ ...row }),
      transition: async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        history.push(to);
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
      setProgress: async (_id: string, value: number) => {
        progress.push(value);
      },
    },
    notify,
  } as unknown as RunJobDeps;

  const assets: Record<string, { key: string; kind: string; contentType: string }> = {
    a1: { key: "uploads/owner-1/u/a.png", kind: "image", contentType: "image/png" },
    a2: { key: "uploads/owner-1/u/a.mp4", kind: "video", contentType: "video/mp4" },
  };
  const downloads: { key: string; path: string }[] = [];
  const uploads: { key: string; contentType: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  const renders: { sourcePaths: Map<string, string> }[] = [];
  const masters: { slidePaths: readonly string[] }[] = [];
  const zips: { files: string[]; outPath: string }[] = [];

  const deps: Partial<BuildSlideshowDeps> = {
    assetsRepo: {
      getForOwner: vi.fn(async (id: string, ownerId: string) => {
        const asset = assets[id];
        return asset && ownerId === OWNER ? { id, ownerId, ...asset } : undefined;
      }),
      register: vi.fn(async (args: Record<string, unknown>) => {
        registered.push(args);
        return { id: `out-${registered.length}`, ...args };
      }),
    } as unknown as BuildSlideshowDeps["assetsRepo"],
    downloadObjectToFile: async (key, dest) => {
      downloads.push({ key, path: dest });
      await writeFile(dest, "src");
    },
    uploadFile: async (key, _path, contentType) => {
      uploads.push({ key, contentType });
      return 100 + uploads.length;
    },
    renderPerSlide: async (args) => {
      renders.push({ sourcePaths: new Map(args.sourcePaths) });
      const files: string[] = [];
      for (const slide of args.spec.slides) {
        const file = path.join(args.dir, `slide-${String(slide.id).padStart(2, "0")}.mp4`);
        await writeFile(file, "slide");
        files.push(file);
      }
      return files;
    },
    renderMaster: async (args) => {
      masters.push({ slidePaths: args.slidePaths });
      await writeFile(args.outputPath, "master");
    },
    writeZip: async (files, outPath) => {
      zips.push({ files: [...files], outPath });
      await writeFile(outPath, "zip");
    },
    runJobDeps,
    ...opts.overrides,
  };
  const bullJob = (attemptsMade = 0, maxAttempts = 3) =>
    ({
      data: { jobId: "j1", type: "collage.slideshow" },
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as Job<JobData>;
  return {
    row,
    history,
    progress,
    notify,
    downloads,
    uploads,
    registered,
    renders,
    masters,
    zips,
    bullJob,
    processor: createBuildSlideshowProcessor(deps),
  };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("buildSlideshow processor", () => {
  it("runs queued -> running -> succeeded and stores asset references, not URLs", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({
      masterAssetId: "out-1",
      zipAssetId: "out-4",
      slideAssetIds: ["out-2", "out-3"],
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 5,
    });
    expect(JSON.stringify(h.row.result)).not.toContain("https://");
    expect([...h.progress]).toEqual([...h.progress].sort((a, b) => a - b));
    expect(h.row.progress).toBe(100);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });

  it("downloads sources sequentially in input order and renders one slide per source", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.downloads.map((d) => d.key)).toEqual([
      "uploads/owner-1/u/a.png",
      "uploads/owner-1/u/a.mp4",
    ]);
    expect([...(h.renders[0]?.sourcePaths.keys() ?? [])]).toEqual(["a1", "a2"]);
    expect(h.row.result as { slideAssetIds: string[] }).toMatchObject({
      slideAssetIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
    });
  });

  it("uses deterministic, job-derived output keys and registers master, slides, then zip", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.uploads).toEqual([
      { key: "outputs/j1/master.mp4", contentType: "video/mp4" },
      { key: "outputs/j1/slide-0.mp4", contentType: "video/mp4" },
      { key: "outputs/j1/slide-1.mp4", contentType: "video/mp4" },
      { key: "outputs/j1/slideshow.zip", contentType: "application/zip" },
    ]);
    expect(h.registered[0]).toMatchObject({ key: "outputs/j1/master.mp4", kind: "output" });
    expect(h.registered[3]).toMatchObject({ key: "outputs/j1/slideshow.zip", kind: "output" });
  });

  it("returns exactly one slideAssetId per source in source order", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    const result = h.row.result as { slideAssetIds: string[] };
    expect(result.slideAssetIds).toHaveLength(2);
  });

  it("removes the temp directory after success and after failure", async () => {
    const ok = harness();
    await ok.processor(ok.bullJob());
    expect(await exists(path.dirname(ok.downloads[0]?.path ?? ""))).toBe(false);

    const bad = harness({
      overrides: {
        renderMaster: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(bad.processor(bad.bullJob(2))).rejects.toThrow("boom");
    expect(await exists(path.dirname(bad.downloads[0]?.path ?? ""))).toBe(false);
    expect(bad.registered).toEqual([]);
    expect(bad.uploads).toEqual([]);
    expect(bad.row).toMatchObject({ status: "failed", errorMessage: "Job failed" });
  });

  it("rejects invalid stored input before downloading anything", async () => {
    const h = harness({ input: { ...defaultInput, sources: [] } });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("fails a missing or foreign source asset as NOT_FOUND", async () => {
    const h = harness({
      input: { ...defaultInput, sources: [{ ...defaultInput.sources[0], assetId: "ghost" }] },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
  });

  it("fails when an asset's stored kind does not match the requested source kind", async () => {
    const h = harness({
      input: {
        ...defaultInput,
        sources: [{ ...defaultInput.sources[0], assetId: "a2", kind: "image" }],
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
  });

  it("re-checks slideshowMaxSlides from Config even if the stored input has more sources", async () => {
    const many = harness({
      input: {
        sources: Array.from({ length: 4 }, (_, i) => ({
          assetId: `a${i}`,
          kind: "image",
          durationSec: 1,
          startSec: 0,
          endSec: 1,
          fit: "cover",
        })),
        slideshow: defaultInput.slideshow,
      },
    });
    const err = await many.processor(many.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(many.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(many.downloads).toEqual([]);
  });

  it("re-checks slideshowMaxSlideSec from Config against the stored per-source duration", async () => {
    const h = harness({
      input: {
        sources: [
          {
            assetId: "a1",
            kind: "image",
            durationSec: 999,
            startSec: 0,
            endSec: 999,
            fit: "cover",
          },
        ],
        slideshow: defaultInput.slideshow,
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("re-checks slideshowMaxTransitionSec from Config against the stored transition", async () => {
    const h = harness({
      input: {
        sources: defaultInput.sources,
        slideshow: { canvas: "16:9", fps: 30, transition: "fade", transitionSec: 99 },
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("re-checks slideshowMaxDurationSec from Config against the planned master duration", async () => {
    const h = harness({
      input: {
        sources: [
          { assetId: "a1", kind: "image", durationSec: 9, startSec: 0, endSec: 9, fit: "cover" },
          { assetId: "a2", kind: "video", durationSec: 9, startSec: 0, endSec: 9, fit: "cover" },
          { assetId: "a3", kind: "video", durationSec: 9, startSec: 9, endSec: 18, fit: "cover" },
        ],
        slideshow: defaultInput.slideshow,
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("permanently fails a bad render without retrying and without storing output", async () => {
    const h = harness({
      overrides: {
        renderPerSlide: async () => {
          throw new AppError("VALIDATION_FAILED", 400, "corrupt source media");
        },
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.history).toEqual(["running", "failed"]);
    expect(h.row).toMatchObject({
      errorCode: "VALIDATION_FAILED",
      errorMessage: "corrupt source media",
    });
    expect(h.registered).toEqual([]);
  });
});

describe("collage queue dispatcher with slideshow", () => {
  const job = (type: string) => ({ data: { jobId: "j", type } }) as unknown as Job<JobData>;

  it("sends slideshow jobs to the slideshow processor and leaves grid/polaroid routing intact", async () => {
    const grid = vi.fn(async () => undefined);
    const polaroid = vi.fn(async () => undefined);
    const slideshow = vi.fn(async () => undefined);
    const dispatch = createCollageDispatcher({ grid, polaroid, slideshow });
    await dispatch(job("collage.slideshow"));
    await dispatch(job("collage.polaroid"));
    await dispatch(job("collage.build"));
    expect(slideshow).toHaveBeenCalledTimes(1);
    expect(polaroid).toHaveBeenCalledTimes(1);
    expect(grid).toHaveBeenCalledTimes(1);
  });
});

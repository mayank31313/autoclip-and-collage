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
  COLLAGE_MAX_INPUT_PIXELS: "1000000",
});

vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import type { JobData } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import {
  createBuildPolaroidProcessor,
  type BuildPolaroidDeps,
} from "../../worker/processors/buildPolaroid";
import { createCollageDispatcher } from "../../worker/processors/collageQueue";
import type { RunJobDeps } from "../../worker/runJob";

const OWNER = "owner-1";
const defaultInput = {
  sourceAssetIds: ["a1", "a2", "a3"],
  slides: 2,
  slideAspect: "4:5",
  captions: ["", "Hi", ""],
  format: "png",
};

function harness(
  opts: { input?: Record<string, unknown>; overrides?: Partial<BuildPolaroidDeps> } = {},
) {
  const row: Record<string, unknown> = {
    id: "j1",
    ownerId: OWNER,
    type: "collage.polaroid",
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
    a2: { key: "uploads/owner-1/u/b.jpg", kind: "image", contentType: "image/jpeg" },
    a3: { key: "uploads/owner-1/u/c.webp", kind: "image", contentType: "image/webp" },
  };
  const downloads: { key: string; path: string }[] = [];
  const uploads: { key: string; contentType: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  const renders: Parameters<BuildPolaroidDeps["renderPolaroidSlides"]>[0][] = [];
  const zips: { files: string[]; outPath: string }[] = [];
  const planSpy = vi.fn(planPolaroidCarousel);

  const deps: Partial<BuildPolaroidDeps> = {
    assetsRepo: {
      getForOwner: vi.fn(async (id: string, ownerId: string) => {
        const asset = assets[id];
        return asset && ownerId === OWNER ? { id, ownerId, ...asset } : undefined;
      }),
      register: vi.fn(async (args: Record<string, unknown>) => {
        registered.push(args);
        return { id: `out-${registered.length}`, ...args };
      }),
    } as unknown as BuildPolaroidDeps["assetsRepo"],
    downloadObjectToFile: async (key, dest) => {
      downloads.push({ key, path: dest });
      await writeFile(dest, "img");
    },
    uploadFile: async (key, _path, contentType) => {
      uploads.push({ key, contentType });
      return 100 + uploads.length;
    },
    inspectImage: async (_path, assetId) => ({
      assetId,
      widthPx: 400,
      heightPx: 300,
      pixelCount: 120_000,
    }),
    planPolaroidCarousel: planSpy,
    renderPolaroidSlides: async (args) => {
      renders.push(args);
      const ext = args.format === "jpeg" ? "jpg" : "png";
      const files: string[] = [];
      for (let s = 0; s < args.spec.slide.count; s++) {
        const file = path.join(args.outputDir, `slide-0${s + 1}.${ext}`);
        await writeFile(file, "slide");
        files.push(file);
      }
      return files;
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
      data: { jobId: "j1", type: "collage.polaroid" },
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
    zips,
    planSpy,
    bullJob,
    processor: createBuildPolaroidProcessor(deps),
  };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("buildPolaroid processor", () => {
  it("runs queued -> running -> succeeded and stores asset references, not URLs", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({
      zipAssetId: "out-3",
      slideAssetIds: ["out-1", "out-2"],
      slideWidth: 1080,
      slideHeight: 1350,
      format: "png",
    });
    expect(JSON.stringify(h.row.result)).not.toContain("https://");
    expect([...h.progress]).toEqual([...h.progress].sort((a, b) => a - b));
    expect(h.row.progress).toBe(100);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });

  it("downloads in input order and plans with ordered ids, captions, slides and aspect", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.downloads.map((d) => d.key)).toEqual([
      "uploads/owner-1/u/a.png",
      "uploads/owner-1/u/b.jpg",
      "uploads/owner-1/u/c.webp",
    ]);
    expect(h.planSpy).toHaveBeenCalledWith({
      images: [
        { assetId: "a1", caption: "", aspect: 400 / 300 },
        { assetId: "a2", caption: "Hi", aspect: 400 / 300 },
        { assetId: "a3", caption: "", aspect: 400 / 300 },
      ],
      slideCount: 2,
      slideAspect: "4:5",
      template: "scatter",
    });
    const render = h.renders[0];
    expect(render?.format).toBe("png");
    expect(path.isAbsolute(render?.fontPath ?? "")).toBe(true);
    expect(render?.fontPath.endsWith(path.join("assets", "fonts", "Caveat-Regular.ttf"))).toBe(
      true,
    );
    expect(h.zips[0]?.files.map((f) => path.basename(f))).toEqual(["slide-01.png", "slide-02.png"]);
  });

  it("uploads deterministic keys and registers slides before the ZIP", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.uploads).toEqual([
      { key: "outputs/j1/slide-01.png", contentType: "image/png" },
      { key: "outputs/j1/slide-02.png", contentType: "image/png" },
      { key: "outputs/j1/polaroid.zip", contentType: "application/zip" },
    ]);
    expect(h.registered[0]).toEqual({
      ownerId: OWNER,
      key: "outputs/j1/slide-01.png",
      kind: "output",
      contentType: "image/png",
      sizeBytes: 101,
      metadata: { index: 0, width: 1080, height: 1350, format: "png" },
    });
    expect(h.registered[2]).toMatchObject({
      key: "outputs/j1/polaroid.zip",
      kind: "output",
      contentType: "application/zip",
      metadata: { slideCount: 2, format: "png" },
    });
  });

  it("renders JPEG slides with the matching extension and content type", async () => {
    const h = harness({ input: { ...defaultInput, format: "jpeg" } });
    await h.processor(h.bullJob());
    expect(h.uploads.slice(0, 2)).toEqual([
      { key: "outputs/j1/slide-01.jpg", contentType: "image/jpeg" },
      { key: "outputs/j1/slide-02.jpg", contentType: "image/jpeg" },
    ]);
    expect(h.row.result).toMatchObject({ format: "jpeg" });
  });

  it("reuses the same output keys when a failed attempt is retried", async () => {
    let calls = 0;
    const h = harness({
      overrides: {
        renderPolaroidSlides: async (args) => {
          calls += 1;
          if (calls === 1) throw new Error("sharp crashed at /srv/tmp/x");
          const file = path.join(args.outputDir, "slide-01.png");
          const second = path.join(args.outputDir, "slide-02.png");
          await writeFile(file, "a");
          await writeFile(second, "b");
          return [file, second];
        },
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toThrow();
    expect(h.history).toEqual(["running", "queued"]);
    expect(h.registered).toEqual([]);
    await h.processor(h.bullJob(1));
    expect(h.history).toEqual(["running", "queued", "running", "succeeded"]);
    expect(h.registered).toHaveLength(3);
    expect(h.uploads.map((u) => u.key)).toEqual([
      "outputs/j1/slide-01.png",
      "outputs/j1/slide-02.png",
      "outputs/j1/polaroid.zip",
    ]);
  });

  it("removes the temp directory after success and after failure", async () => {
    const ok = harness();
    await ok.processor(ok.bullJob());
    expect(await exists(path.dirname(ok.downloads[0]?.path ?? ""))).toBe(false);

    const bad = harness({
      overrides: {
        renderPolaroidSlides: async () => {
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

  it("fails invalid media with a safe message, without retrying or storing output", async () => {
    const h = harness({
      overrides: {
        inspectImage: async () => {
          throw new AppError(
            "VALIDATION_FAILED",
            400,
            "Image is corrupt or exceeds the pixel limit",
          );
        },
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.history).toEqual(["running", "failed"]);
    expect(h.row).toMatchObject({
      errorCode: "VALIDATION_FAILED",
      errorMessage: "Image is corrupt or exceeds the pixel limit",
    });
    expect(h.registered).toEqual([]);
    expect(h.uploads).toEqual([]);
  });

  it("rejects invalid stored input before downloading anything", async () => {
    const h = harness({ input: { ...defaultInput, captions: ["only one"] } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("fails a missing or foreign source image as NOT_FOUND", async () => {
    const h = harness({ input: { ...defaultInput, sourceAssetIds: ["a1", "ghost", "a3"] } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
    expect(h.renders).toEqual([]);
  });
});

describe("collage queue dispatcher", () => {
  const job = (type: string) => ({ data: { jobId: "j", type } }) as unknown as Job<JobData>;

  it("sends polaroid jobs to the polaroid processor and everything else to the grid one", async () => {
    const grid = vi.fn(async () => undefined);
    const polaroid = vi.fn(async () => undefined);
    const dispatch = createCollageDispatcher({ grid, polaroid });
    await dispatch(job("collage.polaroid"));
    await dispatch(job("collage.build"));
    expect(polaroid).toHaveBeenCalledTimes(1);
    expect(grid).toHaveBeenCalledTimes(1);
  });
});

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

import type { JobData } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import {
  createBuildCollageProcessor,
  type BuildCollageDeps,
} from "../../worker/processors/buildCollage";
import type { RunJobDeps } from "../../worker/runJob";

const OWNER = "owner-1";
const MAX_BYTES = 1024 * 1024;

type Overrides = Partial<BuildCollageDeps>;

function harness(
  opts: {
    input?: Record<string, unknown>;
    assets?: Record<string, { key: string; kind: string; contentType: string; ownerId: string }>;
    overrides?: Overrides;
  } = {},
) {
  const row: Record<string, unknown> = {
    id: "j1",
    ownerId: OWNER,
    type: "collage.build",
    status: "queued",
    progress: 0,
    webhookUrl: null,
    input: opts.input ?? {
      sourceAssetIds: ["a1", "a2"],
      style: "justified",
      canvas: { w: 1000, h: 600, gap: 12, bg: "#ffffff" },
      format: "png",
    },
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

  const assets = opts.assets ?? {
    a1: { key: "uploads/owner-1/u/a.png", kind: "image", contentType: "image/png", ownerId: OWNER },
    a2: {
      key: "uploads/owner-1/u/b.jpg",
      kind: "image",
      contentType: "image/jpeg",
      ownerId: OWNER,
    },
  };
  const downloads: { key: string; path: string; maxBytes: number }[] = [];
  const inspected: { assetId: string; maxPixels: number }[] = [];
  const uploads: { key: string; contentType: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  const renders: unknown[] = [];

  const deps: Overrides = {
    assetsRepo: {
      getForOwner: vi.fn(async (id: string, ownerId: string) => {
        const asset = assets[id];
        return asset && asset.ownerId === ownerId ? { id, ...asset } : undefined;
      }),
      register: vi.fn(async (args: Record<string, unknown>) => {
        registered.push(args);
        return { id: "output-1", ...args };
      }),
    } as unknown as BuildCollageDeps["assetsRepo"],
    downloadObjectToFile: async (key, dest, maxBytes) => {
      downloads.push({ key, path: dest, maxBytes });
      await writeFile(dest, "img");
    },
    uploadFile: async (key, _path, contentType) => {
      uploads.push({ key, contentType });
      return 1234;
    },
    inspectImage: async (_path, assetId, maxPixels) => {
      inspected.push({ assetId, maxPixels });
      return { assetId, widthPx: 400, heightPx: 300, pixelCount: 120_000 };
    },
    renderCollage: async (args) => {
      renders.push(args);
      await writeFile(args.outputPath, "rendered");
    },
    runJobDeps,
    ...opts.overrides,
  };
  const bullJob = (attemptsMade = 0, maxAttempts = 3) =>
    ({
      data: { jobId: "j1", type: "collage.build" },
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as Job<JobData>;
  return {
    row,
    history,
    progress,
    notify,
    downloads,
    inspected,
    uploads,
    registered,
    renders,
    deps,
    bullJob,
    processor: createBuildCollageProcessor(deps),
  };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("buildCollage processor", () => {
  it("builds a photo wall as a single collage output", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1", "a2"],
        style: "photo-wall",
        photoWallPreset: "midnight",
        canvas: { w: 1000, h: 600, gap: 12, bg: "#ffffff" },
        format: "png",
      },
      overrides: {
        renderPhotoWall: async (args) => {
          expect(args.spec.items.map((item) => item.image)).toEqual(["a1", "a2"]);
          expect(args.spec.canvas.bg).toBe("#252c39");
          await writeFile(args.outputPath, "rendered wall");
        },
      },
    });
    await h.processor(h.bullJob());
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toMatchObject({ width: 1000, height: 600, format: "png" });
    expect(h.renders).toEqual([]);
  });

  it("runs queued -> running -> succeeded and persists an asset reference, not a URL", async () => {
    const h = harness();
    await h.processor(h.bullJob());

    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({
      outputAssetId: "output-1",
      width: 1000,
      height: 600,
      format: "png",
    });
    expect(JSON.stringify(h.row.result)).not.toContain("https://");
    expect(h.progress.length).toBeGreaterThan(0);
    expect([...h.progress]).toEqual([...h.progress].sort((a, b) => a - b));
    expect(h.row.progress).toBe(100);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });

  it("downloads sequentially in input order with the configured byte and pixel limits", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.downloads.map((d) => d.key)).toEqual([
      "uploads/owner-1/u/a.png",
      "uploads/owner-1/u/b.jpg",
    ]);
    expect(h.downloads.every((d) => d.maxBytes === MAX_BYTES)).toBe(true);
    expect(h.inspected).toEqual([
      { assetId: "a1", maxPixels: 1_000_000 },
      { assetId: "a2", maxPixels: 1_000_000 },
    ]);
  });

  it("uploads to a deterministic key and registers the output asset", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.uploads).toEqual([{ key: "outputs/j1/collage.png", contentType: "image/png" }]);
    expect(h.registered).toEqual([
      {
        ownerId: OWNER,
        key: "outputs/j1/collage.png",
        kind: "output",
        contentType: "image/png",
        sizeBytes: 1234,
        metadata: { width: 1000, height: 600, format: "png" },
      },
    ]);
  });

  it("renders JPEG with the matching key and content type", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1"],
        style: "justified",
        canvas: { w: 500, h: 500, gap: 12, bg: "#ffffff" },
        format: "jpeg",
      },
    });
    await h.processor(h.bullJob());
    expect(h.uploads).toEqual([{ key: "outputs/j1/collage.jpeg", contentType: "image/jpeg" }]);
    expect(h.row.result).toMatchObject({ format: "jpeg" });
  });

  it("handles a single image", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1"],
        style: "justified",
        canvas: { w: 500, h: 500, gap: 12, bg: "#ffffff" },
        format: "png",
      },
    });
    await h.processor(h.bullJob());
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.downloads).toHaveLength(1);
  });

  it("reuses the same output key when a failed attempt is retried", async () => {
    let calls = 0;
    const h = harness({
      overrides: {
        renderCollage: async (args) => {
          calls += 1;
          if (calls === 1) throw new Error("sharp crashed at /srv/tmp/x");
          await writeFile(args.outputPath, "rendered");
        },
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toThrow();
    expect(h.history).toEqual(["running", "queued"]);
    await h.processor(h.bullJob(1));
    expect(h.history).toEqual(["running", "queued", "running", "succeeded"]);
    expect(h.registered).toHaveLength(1);
    expect(h.uploads.map((u) => u.key)).toEqual(["outputs/j1/collage.png"]);
  });

  it("removes the temp directory after success", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(await exists(path.dirname(h.downloads[0].path))).toBe(false);
  });

  it("removes the temp directory after failure and registers no output", async () => {
    const h = harness({
      overrides: {
        renderCollage: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(h.processor(h.bullJob(2))).rejects.toThrow("boom");
    expect(await exists(path.dirname(h.downloads[0].path))).toBe(false);
    expect(h.registered).toEqual([]);
    expect(h.uploads).toEqual([]);
    expect(h.row).toMatchObject({ status: "failed", errorMessage: "Job failed" });
  });

  it("fails invalid media with a safe message, without retrying or registering output", async () => {
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
    expect(await exists(path.dirname(h.downloads[0].path))).toBe(false);
  });

  it("surfaces a real corrupt file from the default inspector as a safe failure", async () => {
    const { inspectImage } = await import("@/server/analyzers/image/metadata");
    const h = harness({ overrides: { inspectImage } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(String(h.row.errorMessage)).not.toMatch(/img|source-|[\\/]/);
  });

  it("turns planner RangeErrors into a non-retried user error", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1", "a2"],
        style: "justified",
        canvas: { w: 100, h: 100, gap: 5000, bg: "#ffffff" },
        format: "png",
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({
      status: "failed",
      errorCode: "VALIDATION_FAILED",
      errorMessage: "The images cannot be laid out on this canvas; reduce the gap or image count",
    });
    expect(h.renders).toEqual([]);
  });

  it("explains how to fix a photo wall that cannot fit on its canvas", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1", "a2"],
        style: "photo-wall",
        canvas: { w: 1, h: 1, gap: 12, bg: "#ffffff" },
        format: "png",
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({
      status: "failed",
      errorCode: "VALIDATION_FAILED",
      errorMessage:
        "The photo wall cannot fit on this canvas; increase its size or use fewer images",
    });
  });

  it("rejects canvases above the configured limits", async () => {
    const h = harness({
      input: {
        sourceAssetIds: ["a1"],
        style: "justified",
        canvas: { w: 9000, h: 100, gap: 12, bg: "#ffffff" },
        format: "png",
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["foreign", { a1: { key: "k1", kind: "image", contentType: "image/png", ownerId: "other" } }],
  ])("fails when a %s source asset cannot be resolved for the owner", async (_label, assets) => {
    const h = harness({ assets });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
    expect(h.downloads).toEqual([]);
  });

  it.each([
    ["non-image kind", { kind: "output", contentType: "image/png" }],
    ["unsupported content type", { kind: "image", contentType: "application/pdf" }],
  ])("rejects a %s source asset", async (_label, change) => {
    const h = harness({
      assets: {
        a1: { key: "k1", ownerId: OWNER, ...change },
        a2: { key: "k2", ownerId: OWNER, kind: "image", contentType: "image/png" },
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("fails a job whose persisted input is malformed", async () => {
    const h = harness({ input: { sourceAssetIds: [] } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
  });
});

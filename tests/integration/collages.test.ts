import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  getForOwner: vi.fn(),
  get: vi.fn(),
  transition: vi.fn(),
  setProgress: vi.fn(),
  getAsset: vi.fn(),
  presignGet: vi.fn(),
  deliverWebhook: vi.fn(),
}));
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({
  jobsRepo: {
    getForOwner: mocks.getForOwner,
    get: mocks.get,
    transition: mocks.transition,
    setProgress: mocks.setProgress,
  },
}));
vi.mock("@/server/db/repositories/assets", () => ({
  assetsRepo: { getForOwner: mocks.getAsset },
}));
vi.mock("@/server/storage/presign", () => ({ presignGet: mocks.presignGet }));
vi.mock("@/server/webhooks/deliver", () => ({ deliverWebhook: mocks.deliverWebhook }));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { CollageJobResult } from "@/lib/schemas/api";
import { runJob } from "../../worker/runJob";

const OWNER = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const OUTPUT_KEY = `outputs/${JOB_ID}/collage.png`;
const auth = { Authorization: "Bearer ak_test" };

const internalResult = { outputAssetId: "asset-out-1", width: 1000, height: 600, format: "png" };

function jobRow(patch: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: OWNER,
    type: "collage.build",
    status: "succeeded",
    progress: 100,
    result: internalResult,
    errorCode: null,
    errorMessage: null,
    webhookUrl: null,
    ...patch,
  };
}

let urlCounter = 0;
beforeEach(() => {
  urlCounter = 0;
  mocks.findActiveByHash.mockReset().mockResolvedValue({ id: OWNER, name: "t" });
  mocks.getForOwner.mockReset();
  mocks.get.mockReset();
  mocks.transition.mockReset();
  mocks.setProgress.mockReset();
  mocks.getAsset
    .mockReset()
    .mockResolvedValue({ id: "asset-out-1", key: OUTPUT_KEY, kind: "output", ownerId: OWNER });
  mocks.presignGet.mockReset().mockImplementation(async () => {
    urlCounter += 1;
    return `https://minio.example/b/${OUTPUT_KEY}?sig=${urlCounter}`;
  });
  mocks.deliverWebhook.mockReset().mockResolvedValue(true);
});

describe("GET /api/jobs/:id for collage jobs", () => {
  const call = async (jobId = JOB_ID) => {
    const { GET } = await import("@/app/api/jobs/[id]/route");
    return GET(new Request(`http://x/api/jobs/${jobId}`, { headers: auth }), {
      params: Promise.resolve({ id: jobId }),
    });
  };

  it("404s for another owner's job without touching assets", async () => {
    mocks.getForOwner.mockResolvedValue(undefined);
    expect((await call()).status).toBe(404);
    expect(mocks.getForOwner).toHaveBeenCalledWith(JOB_ID, OWNER);
    expect(mocks.getAsset).not.toHaveBeenCalled();
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "failed"])("omits the result while %s", async (status) => {
    mocks.getForOwner.mockResolvedValue(jobRow({ status, progress: 30, result: null }));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBeNull();
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("returns the public result with a signed URL and no asset ID or key", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const json = await (await call()).json();
    expect(mocks.getAsset).toHaveBeenCalledWith("asset-out-1", OWNER);
    expect(mocks.presignGet).toHaveBeenCalledWith(OUTPUT_KEY);
    expect(json.result).toEqual({
      output: {
        width: 1000,
        height: 600,
        format: "png",
        downloadUrl: `https://minio.example/b/${OUTPUT_KEY}?sig=1`,
        expiresInSec: 900,
      },
    });
    expect(CollageJobResult.safeParse(json.result).success).toBe(true);
    const text = JSON.stringify(json);
    expect(text).not.toContain("asset-out-1");
    expect(text).not.toContain("outputAssetId");
  });

  it("signs a fresh URL on every poll", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const first = (await (await call()).json()).result.output.downloadUrl;
    const second = (await (await call()).json()).result.output.downloadUrl;
    expect(first).not.toBe(second);
    expect(mocks.presignGet).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", undefined],
    ["foreign", undefined],
    ["non-output", { id: "asset-out-1", key: "uploads/x/a.png", kind: "image", ownerId: OWNER }],
  ])("does not sign when the %s output asset cannot be verified", async (_label, asset) => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    mocks.getAsset.mockResolvedValue(asset);
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL");
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("does not sign when the stored result is malformed", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow({ result: { note: "x" } }));
    expect((await call()).status).toBe(500);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });
});

describe("collage webhook delivery", () => {
  function store(initial: Record<string, unknown>) {
    const row = { ...initial };
    mocks.get.mockImplementation(async () => ({ ...row }));
    mocks.transition.mockImplementation(
      async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
    );
    mocks.setProgress.mockResolvedValue(undefined);
  }
  const args = { jobId: JOB_ID, attemptsMade: 0, maxAttempts: 3 };
  const queuedJob = () =>
    jobRow({ status: "queued", result: null, webhookUrl: "https://hooks.example/x" });

  it("includes a fresh signed URL in resultUrls for a succeeded job", async () => {
    store(queuedJob());
    await runJob(args, async () => internalResult);
    expect(mocks.getAsset).toHaveBeenCalledWith("asset-out-1", OWNER);
    expect(mocks.deliverWebhook).toHaveBeenCalledTimes(1);
    const { url, event } = mocks.deliverWebhook.mock.calls[0][0];
    expect(url).toBe("https://hooks.example/x");
    expect(event).toMatchObject({
      jobId: JOB_ID,
      type: "collage.build",
      status: "succeeded",
      resultUrls: [`https://minio.example/b/${OUTPUT_KEY}?sig=1`],
    });
  });

  it("sends an empty resultUrls (and no signing) when the output asset cannot be verified", async () => {
    store(queuedJob());
    mocks.getAsset.mockResolvedValue(undefined);
    await runJob(args, async () => internalResult);
    expect(mocks.presignGet).not.toHaveBeenCalled();
    expect(mocks.deliverWebhook.mock.calls[0][0].event.resultUrls).toEqual([]);
  });

  it("sends no result URLs for a failed job", async () => {
    store(queuedJob());
    await expect(
      runJob({ ...args, attemptsMade: 2 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mocks.presignGet).not.toHaveBeenCalled();
    expect(mocks.deliverWebhook.mock.calls[0][0].event).toMatchObject({
      status: "failed",
      resultUrls: [],
    });
  });

  it("sends no webhook when none is configured", async () => {
    store(jobRow({ status: "queued", result: null }));
    await runJob(args, async () => internalResult);
    expect(mocks.deliverWebhook).not.toHaveBeenCalled();
  });
});

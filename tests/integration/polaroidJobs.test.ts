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

import { PolaroidJobResult } from "@/lib/schemas/api";
import { runJob } from "../../worker/runJob";

const OWNER = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const auth = { Authorization: "Bearer ak_test" };
const KEYS: Record<string, string> = {
  "asset-zip": `outputs/${JOB_ID}/polaroid.zip`,
  "asset-s1": `outputs/${JOB_ID}/slide-01.png`,
  "asset-s2": `outputs/${JOB_ID}/slide-02.png`,
};
const internalResult = {
  zipAssetId: "asset-zip",
  slideAssetIds: ["asset-s1", "asset-s2"],
  slideWidth: 1080,
  slideHeight: 1350,
  format: "png",
};

function jobRow(patch: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: OWNER,
    type: "collage.polaroid",
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
  mocks.getAsset.mockReset().mockImplementation(async (id: string, owner: string) => {
    const key = KEYS[id];
    return key && owner === OWNER ? { id, key, kind: "output", ownerId: OWNER } : undefined;
  });
  mocks.presignGet.mockReset().mockImplementation(async (key: string) => {
    urlCounter += 1;
    return `https://minio.example/b/${key}?sig=${urlCounter}`;
  });
  mocks.deliverWebhook.mockReset().mockResolvedValue(true);
});

describe("GET /api/jobs/:id for polaroid jobs", () => {
  const call = async () => {
    const { GET } = await import("@/app/api/jobs/[id]/route");
    return GET(new Request(`http://x/api/jobs/${JOB_ID}`, { headers: auth }), {
      params: Promise.resolve({ id: JOB_ID }),
    });
  };

  it("404s for another owner's job without touching assets", async () => {
    mocks.getForOwner.mockResolvedValue(undefined);
    expect((await call()).status).toBe(404);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "failed"])("omits the result while %s", async (status) => {
    mocks.getForOwner.mockResolvedValue(jobRow({ status, progress: 30, result: null }));
    const res = await call();
    expect((await res.json()).result).toBeNull();
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("returns signed slide and ZIP URLs without asset IDs", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const json = await (await call()).json();
    expect(PolaroidJobResult.safeParse(json.result).success).toBe(true);
    expect(json.result.output).toMatchObject({
      slideCount: 2,
      slideWidth: 1080,
      slideHeight: 1350,
      slideFormat: "png",
      expiresInSec: 900,
    });
    expect(json.result.output.zipUrl).toContain("polaroid.zip");
    expect(json.result.output.slides.map((s: { index: number }) => s.index)).toEqual([0, 1]);
    expect(json.result.output.slides[1].url).toContain("slide-02.png");
    const text = JSON.stringify(json);
    for (const hidden of ["asset-zip", "asset-s1", "zipAssetId", "slideAssetIds"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("signs fresh URLs on every poll", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const first = (await (await call()).json()).result.output.zipUrl;
    const second = (await (await call()).json()).result.output.zipUrl;
    expect(first).not.toBe(second);
  });

  it.each([
    ["a missing ZIP asset", async (id: string) => (id === "asset-zip" ? undefined : slide(id))],
    [
      "a non-output slide",
      async (id: string) => (id === "asset-s2" ? { ...slide(id), kind: "image" } : slide(id)),
    ],
  ])("does not sign when %s cannot be verified", async (_label, resolve) => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    mocks.getAsset.mockImplementation(resolve);
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("does not sign when the stored result is malformed", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow({ result: { note: "x" } }));
    expect((await call()).status).toBe(500);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });
});

function slide(id: string) {
  return { id, key: KEYS[id], kind: "output", ownerId: OWNER };
}

describe("polaroid webhook delivery", () => {
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
  const queued = () =>
    jobRow({ status: "queued", result: null, webhookUrl: "https://hooks.example/x" });

  it("lists the ZIP first, then each slide, for a succeeded job", async () => {
    store(queued());
    await runJob(args, async () => internalResult);
    const { event } = mocks.deliverWebhook.mock.calls[0][0];
    expect(event).toMatchObject({ type: "collage.polaroid", status: "succeeded" });
    expect(event.resultUrls).toHaveLength(3);
    expect(event.resultUrls[0]).toContain("polaroid.zip");
    expect(event.resultUrls[1]).toContain("slide-01.png");
    expect(event.resultUrls[2]).toContain("slide-02.png");
  });

  it("sends empty resultUrls when an output asset cannot be verified", async () => {
    store(queued());
    mocks.getAsset.mockResolvedValue(undefined);
    await runJob(args, async () => internalResult);
    expect(mocks.presignGet).not.toHaveBeenCalled();
    expect(mocks.deliverWebhook.mock.calls[0][0].event.resultUrls).toEqual([]);
  });

  it("sends no result URLs for a failed job", async () => {
    store(queued());
    await expect(
      runJob({ ...args, attemptsMade: 2 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mocks.deliverWebhook.mock.calls[0][0].event).toMatchObject({
      status: "failed",
      resultUrls: [],
    });
  });
});

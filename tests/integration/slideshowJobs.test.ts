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
  getAsset: vi.fn(),
  presignGet: vi.fn(),
}));
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({
  jobsRepo: { getForOwner: mocks.getForOwner, get: vi.fn(), transition: vi.fn(), setProgress: vi.fn() },
}));
vi.mock("@/server/db/repositories/assets", () => ({
  assetsRepo: { getForOwner: mocks.getAsset },
}));
vi.mock("@/server/storage/presign", () => ({ presignGet: mocks.presignGet }));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { SlideshowJobResult } from "@/lib/schemas/api";

const OWNER = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const auth = { Authorization: "Bearer ak_test" };
const KEYS: Record<string, string> = {
  "asset-master": `outputs/${JOB_ID}/master.mp4`,
  "asset-zip": `outputs/${JOB_ID}/slideshow.zip`,
  "asset-s0": `outputs/${JOB_ID}/slide-0.mp4`,
  "asset-s1": `outputs/${JOB_ID}/slide-1.mp4`,
};
const internalResult = {
  masterAssetId: "asset-master",
  zipAssetId: "asset-zip",
  slideAssetIds: ["asset-s0", "asset-s1"],
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 9,
};
const internalInput = {
  sources: [
    { assetId: "src-0", kind: "image", durationSec: 3, startSec: 0, endSec: 3, fit: "cover" },
    { assetId: "src-1", kind: "video", durationSec: 6, startSec: 1, endSec: 7, fit: "contain" },
  ],
  slideshow: { canvas: "16:9", fps: 30, transition: "cut", transitionSec: 0 },
};

function jobRow(patch: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: OWNER,
    type: "collage.slideshow",
    status: "succeeded",
    progress: 100,
    result: internalResult,
    input: internalInput,
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
  mocks.getAsset.mockReset().mockImplementation(async (id: string, owner: string) => {
    const assetKey = KEYS[id];
    return assetKey && owner === OWNER ? { id, key: assetKey, kind: "output", ownerId: OWNER } : undefined;
  });
  mocks.presignGet.mockReset().mockImplementation(async (assetKey: string) => {
    urlCounter += 1;
    return `https://minio.example/b/${assetKey}?sig=${urlCounter}`;
  });
});

describe("GET /api/jobs/:id for slideshow jobs", () => {
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

  it("returns signed master, zip, and slide URLs with per-slide durations", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const json = await (await call()).json();
    expect(SlideshowJobResult.safeParse(json.result).success).toBe(true);
    expect(json.result.output).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 9,
      format: "mp4",
      expiresInSec: 900,
    });
    expect(json.result.output.masterUrl).toContain("master.mp4");
    expect(json.result.output.zipUrl).toContain("slideshow.zip");
    expect(json.result.output.slides).toEqual([
      { index: 0, durationSec: 3, url: expect.stringContaining("slide-0.mp4") },
      { index: 1, durationSec: 6, url: expect.stringContaining("slide-1.mp4") },
    ]);
    const text = JSON.stringify(json);
    for (const hidden of ["asset-master", "asset-zip", "asset-s0", "masterAssetId", "slideAssetIds"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("signs fresh URLs on every poll", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const first = (await (await call()).json()).result.output.masterUrl;
    const second = (await (await call()).json()).result.output.masterUrl;
    expect(first).not.toBe(second);
  });

  it.each([
    ["a missing master asset", async (id: string) => (id === "asset-master" ? undefined : slide(id))],
    [
      "a non-output slide",
      async (id: string) => (id === "asset-s1" ? { ...slide(id), kind: "image" } : slide(id)),
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

  it("does not sign when the job input cannot be matched to the result", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow({ input: { sources: [], slideshow: internalInput.slideshow } }));
    expect((await call()).status).toBe(500);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });
});

function slide(id: string) {
  return { id, key: KEYS[id], kind: "output", ownerId: OWNER };
}
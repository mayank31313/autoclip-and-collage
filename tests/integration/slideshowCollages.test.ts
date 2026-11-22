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
  MAX_IMAGE_UPLOAD_MB: "1",
  MAX_UPLOAD_MB: "1",
  SLIDESHOW_MAX_SLIDES: "20",
  SLIDESHOW_MAX_SLIDE_SEC: "30",
  SLIDESHOW_MAX_DURATION_SEC: "300",
});

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  enqueueJob: vi.fn(),
  headObject: vi.fn(),
  downloadObjectToFile: vi.fn(),
  register: vi.fn(),
  inspectVideo: vi.fn(),
  inspectImage: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));
const {
  findActiveByHash,
  enqueueJob,
  headObject,
  downloadObjectToFile,
  register,
  inspectVideo,
  inspectImage,
} = mocks;
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner: vi.fn() } }));
vi.mock("@/server/db/repositories/assets", () => ({ assetsRepo: { register: mocks.register } }));
vi.mock("@/server/queue/queues", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/server/storage/objects", () => ({
  headObject: mocks.headObject,
  downloadObjectToFile: mocks.downloadObjectToFile,
}));
vi.mock("@/server/analyzers/video/metadata", () => ({ inspectVideo: mocks.inspectVideo }));
vi.mock("@/server/analyzers/image/metadata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/analyzers/image/metadata")>();
  return { ...actual, inspectImage: mocks.inspectImage };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: mocks.mkdtemp, rm: mocks.rm };
});
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const ownerId = "11111111-1111-1111-1111-111111111111";
const auth = { Authorization: "Bearer ak_test" };
const key = (name: string, owner = ownerId) => `uploads/${owner}/up-1/${name}`;

const imageSource = (name = "a.jpg", extra: Record<string, unknown> = {}) => ({
  key: key(name),
  kind: "image",
  durationSec: 3,
  fit: "cover",
  ...extra,
});
const videoSource = (name = "b.mp4", extra: Record<string, unknown> = {}) => ({
  key: key(name),
  kind: "video",
  fit: "cover",
  ...extra,
});

const body = (
  sources: Record<string, unknown>[],
  slideshow: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  mode: "slideshow",
  sources,
  slideshow: { canvas: "16:9", fps: 30, transition: "cut", transitionSec: 0, ...slideshow },
  format: "mp4",
  ...extra,
});

const call = async (payload: unknown, headers: Record<string, string> = auth) => {
  const { POST } = await import("@/app/api/collages/route");
  return POST(
    new Request("http://x/api/collages", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
};

const expectRejected = async (res: Response, status: number, code: string) => {
  expect(res.status).toBe(status);
  expect((await res.json()).error.code).toBe(code);
  expect(register).not.toHaveBeenCalled();
  expect(enqueueJob).not.toHaveBeenCalled();
};

beforeEach(() => {
  findActiveByHash.mockReset().mockResolvedValue({ id: ownerId, name: "t" });
  enqueueJob.mockReset().mockResolvedValue({ id: "job-1" });
  headObject.mockReset().mockImplementation(async (objectKey: string) => {
    if (objectKey.endsWith(".mp4")) return { contentType: "video/mp4", sizeBytes: 2000 };
    return { contentType: "image/jpeg", sizeBytes: 1000 };
  });
  downloadObjectToFile.mockReset().mockResolvedValue(undefined);
  inspectVideo.mockReset().mockResolvedValue({
    durationSec: 10,
    hasVideo: true,
    hasAudio: true,
    width: 1280,
    height: 720,
    fps: 30,
  });
  mocks.mkdtemp.mockReset().mockResolvedValue("/tmp/slideshow-probe-xyz");
  mocks.rm.mockReset().mockResolvedValue(undefined);
  inspectImage.mockReset().mockResolvedValue({
    assetId: "stub",
    widthPx: 640,
    heightPx: 480,
    pixelCount: 640 * 480,
  });
  register.mockReset().mockImplementation(async (args: { key: string }) => ({
    id: `asset-${args.key.split("/").pop()}`,
  }));
});

describe("POST /api/collages (slideshow)", () => {
  it("rejects missing credentials", async () => {
    await expectRejected(await call(body([imageSource()]), {}), 401, "UNAUTHORIZED");
  });

  it("allows video upload MIME types and extensions", async () => {
    const res = await call(body([imageSource(), videoSource(undefined, { endSec: 5 })]));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(headObject).toHaveBeenCalledWith(key("b.mp4"));
    expect(inspectVideo).toHaveBeenCalled();
  });

  it("hides keys outside the caller's upload namespace", async () => {
    const other = "99999999-9999-9999-9999-999999999999";
    const payload = body([imageSource("a.jpg", { key: key("a.jpg", other) })]);
    await expectRejected(await call(payload), 404, "NOT_FOUND");
  });

  it("404s when the source object does not exist", async () => {
    headObject.mockRejectedValue(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    await expectRejected(await call(body([imageSource()])), 404, "NOT_FOUND");
  });

  it("rejects a source whose stored content type does not match the declared kind", async () => {
    // declared as video but the stored object is actually an image
    headObject.mockResolvedValue({ contentType: "image/jpeg", sizeBytes: 1000 });
    const res = await call(body([videoSource("b.jpg", { endSec: 3 })]));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("rejects a video trim outside the probed duration", async () => {
    inspectVideo.mockResolvedValue({
      durationSec: 2,
      hasVideo: true,
      hasAudio: true,
      width: 640,
      height: 480,
    });
    const res = await call(body([videoSource(undefined, { startSec: 0, endSec: 10 })]));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("rejects a master duration over 300 seconds", async () => {
    const sources = Array.from({ length: 11 }, (_, i) => imageSource(`${i}.jpg`, { durationSec: 29 }));
    const res = await call(body(sources));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("rejects a 45-second slide and a 360-second master under the default config", async () => {
    const longSlide = await call(body([imageSource("a.jpg", { durationSec: 45 })]));
    await expectRejected(longSlide, 400, "VALIDATION_FAILED");

    const sources = Array.from({ length: 9 }, (_, i) => imageSource(`${i}.jpg`, { durationSec: 40 }));
    const longMaster = await call(body(sources));
    await expectRejected(longMaster, 400, "VALIDATION_FAILED");
  });

  it("accepts a 45-second slide and a 360-second master once config limits are raised", async () => {
    Object.assign(process.env, {
      SLIDESHOW_MAX_SLIDE_SEC: "45",
      SLIDESHOW_MAX_DURATION_SEC: "360",
    });
    vi.resetModules();
    try {
      const { POST } = await import("@/app/api/collages/route");
      const run = (payload: unknown) =>
        POST(
          new Request("http://x/api/collages", {
            method: "POST",
            headers: auth,
            body: JSON.stringify(payload),
          }),
        );

      const longSlideRes = await run(body([imageSource("a.jpg", { durationSec: 45 })]));
      expect(longSlideRes.status).toBe(202);

      const sources = Array.from({ length: 9 }, (_, i) => imageSource(`${i}.jpg`, { durationSec: 40 }));
      const longMasterRes = await run(body(sources));
      expect(longMasterRes.status).toBe(202);
    } finally {
      Object.assign(process.env, {
        SLIDESHOW_MAX_SLIDE_SEC: "30",
        SLIDESHOW_MAX_DURATION_SEC: "300",
      });
      vi.resetModules();
    }
  });

  it("rejects a transition exceeding the configured SLIDESHOW_MAX_TRANSITION_SEC", async () => {
    Object.assign(process.env, { SLIDESHOW_MAX_TRANSITION_SEC: "1" });
    vi.resetModules();
    try {
      const { POST } = await import("@/app/api/collages/route");
      const run = (payload: unknown) =>
        POST(
          new Request("http://x/api/collages", {
            method: "POST",
            headers: auth,
            body: JSON.stringify(payload),
          }),
        );
      const res = await run(
        body(
          [imageSource("a.jpg"), imageSource("b.jpg")],
          { transition: "fade", transitionSec: 1.5 },
        ),
      );
      await expectRejected(res, 400, "VALIDATION_FAILED");
    } finally {
      Object.assign(process.env, { SLIDESHOW_MAX_TRANSITION_SEC: "2" });
      vi.resetModules();
    }
  });

  it("registers image and video assets and enqueues a collage.slideshow job", async () => {
    const payload = body([imageSource("a.jpg", { durationSec: 4 }), videoSource("b.mp4", { startSec: 1, endSec: 6 })]);
    const res = await call(payload);
    expect(res.status).toBe(202);
    expect(register).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenNthCalledWith(1, {
      ownerId,
      kind: "image",
      key: key("a.jpg"),
      contentType: "image/jpeg",
      sizeBytes: 1000,
    });
    expect(register).toHaveBeenNthCalledWith(2, {
      ownerId,
      kind: "video",
      key: key("b.mp4"),
      contentType: "video/mp4",
      sizeBytes: 2000,
      metadata: { width: 1280, height: 720, durationSec: 5 },
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "collage",
      type: "collage.slideshow",
      ownerId,
      input: {
        sources: [
          {
            assetId: "asset-a.jpg",
            kind: "image",
            durationSec: 4,
            startSec: 0,
            endSec: 4,
            fit: "cover",
          },
          {
            assetId: "asset-b.mp4",
            kind: "video",
            durationSec: 5,
            startSec: 1,
            endSec: 6,
            fit: "cover",
          },
        ],
        slideshow: { canvas: "16:9", fps: 30, transition: "cut", transitionSec: 0 },
      },
    });
  });

  it("rejects more sources than the configured maximum", async () => {
    const sources = Array.from({ length: 21 }, (_, i) => imageSource(`${i}.jpg`));
    await expectRejected(await call(body(sources)), 400, "VALIDATION_FAILED");
  });

  it("rejects duplicate source keys", async () => {
    const res = await call(body([imageSource("a.jpg"), imageSource("a.jpg")]));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("probes image sources with sharp and rejects a corrupt image at create time", async () => {
    // Imported dynamically so it is the same module instance `route.ts` currently holds: earlier
    // tests in this file call `vi.resetModules()`, which would otherwise make a statically
    // imported `AppError` fail `instanceof` checks inside the route handler.
    const { AppError } = await import("@/server/http/errors");
    inspectImage.mockRejectedValue(
      new AppError("VALIDATION_FAILED", 400, "Image is corrupt or exceeds the pixel limit"),
    );
    const res = await call(body([imageSource("a.jpg")]));
    expect(inspectImage).toHaveBeenCalled();
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });
});
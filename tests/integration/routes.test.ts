import { beforeEach, describe, expect, it, vi } from "vitest";
import { gridTemplate } from "../fixtures/collageTemplates";

const env = {
  DATABASE_URL: "postgres://u:p@localhost/d",
  REDIS_URL: "redis://localhost",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "k",
  S3_SECRET_KEY: "s",
  S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16),
  WEBHOOK_SIGNING_SECRET: "w".repeat(16),
  MAX_UPLOAD_MB: "4",
  MAX_IMAGE_UPLOAD_MB: "1",
};
Object.assign(process.env, env);

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  getForOwner: vi.fn(),
  enqueueJob: vi.fn(),
  headObject: vi.fn(),
  register: vi.fn(),
}));
const { findActiveByHash, getForOwner, enqueueJob, headObject, register } = mocks;
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner: mocks.getForOwner } }));
vi.mock("@/server/db/repositories/assets", () => ({ assetsRepo: { register: mocks.register } }));
vi.mock("@/server/queue/queues", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/server/storage/objects", () => ({ headObject: mocks.headObject }));
vi.mock("@/server/storage/presign", () => ({
  presignPut: async () => ({ url: "http://minio/put?sig=abc", expiresInSec: 900 }),
}));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const auth = { Authorization: "Bearer ak_test" };

beforeEach(() => {
  findActiveByHash
    .mockReset()
    .mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111", name: "t" });
  getForOwner.mockReset();
  enqueueJob.mockReset().mockResolvedValue({ id: "job-1" });
  headObject.mockReset().mockResolvedValue({ contentType: "image/png", sizeBytes: 1000 });
  register.mockReset().mockImplementation(async (args: { key: string }) => ({
    id: `asset-${args.key.split("/").pop()}`,
  }));
});

describe("POST /api/uploads/presign", () => {
  const call = async (body: unknown, headers: Record<string, string> = auth) => {
    const { POST } = await import("@/app/api/uploads/presign/route");
    return POST(
      new Request("http://x/api/uploads/presign", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  };
  it("rejects missing credentials", async () => {
    expect((await call({}, {})).status).toBe(401);
  });
  it("returns a presigned URL and a namespaced key", async () => {
    const res = await call({ filename: "My Clip.mp4", contentType: "video/mp4", sizeBytes: 1000 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toContain("http://minio/put");
    expect(json.key).toMatch(/^uploads\/1111.*\/My_Clip\.mp4$/);
  });
  it("rejects files above MAX_UPLOAD_MB", async () => {
    const res = await call({
      filename: "big.mp4",
      contentType: "video/mp4",
      sizeBytes: 5 * 1024 * 1024,
    });
    expect(res.status).toBe(413);
  });
  it("accepts HEIC only when the sharp build can decode it", async () => {
    const { isSupportedImageMime } = await import("@/server/analyzers/image/metadata");
    const res = await call({ filename: "a.heic", contentType: "image/heic", sizeBytes: 1000 });
    expect(res.status).toBe(isSupportedImageMime("image/heic") ? 200 : 400);
    const renamed = await call({ filename: "a.HEIF", contentType: "image/jpeg", sizeBytes: 1000 });
    expect(renamed.status).toBe(isSupportedImageMime("image/heic") ? 200 : 400);
  });
  it("applies MAX_IMAGE_UPLOAD_MB to images only", async () => {
    const size = 2 * 1024 * 1024;
    const image = await call({ filename: "big.png", contentType: "image/png", sizeBytes: size });
    expect(image.status).toBe(413);
    expect((await image.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    const small = await call({ filename: "ok.png", contentType: "image/png", sizeBytes: 1000 });
    expect(small.status).toBe(200);
    expect((await small.json()).key).toMatch(/^uploads\/1111.*\/ok\.png$/);
    const video = await call({ filename: "ok.mp4", contentType: "video/mp4", sizeBytes: size });
    expect(video.status).toBe(200);
  });
});

describe("GET /api/jobs/:id", () => {
  const id = "22222222-2222-2222-2222-222222222222";
  const call = async (jobId: string) => {
    const { GET } = await import("@/app/api/jobs/[id]/route");
    return GET(new Request("http://x/api/jobs/" + jobId, { headers: auth }), {
      params: Promise.resolve({ id: jobId }),
    });
  };
  it("returns the job for its owner", async () => {
    getForOwner.mockResolvedValue({
      id,
      type: "collage.build",
      status: "running",
      progress: 40,
      result: null,
      errorCode: null,
      errorMessage: null,
    });
    const res = await call(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "running", progress: 40, error: null });
  });
  it("404s for unknown or non-uuid ids", async () => {
    getForOwner.mockResolvedValue(undefined);
    expect((await call(id)).status).toBe(404);
    expect((await call("not-a-uuid")).status).toBe(404);
  });
  it("surfaces failure details", async () => {
    getForOwner.mockResolvedValue({
      id,
      type: "t",
      status: "failed",
      progress: 10,
      result: null,
      errorCode: "JOB_FAILED",
      errorMessage: "boom",
    });
    expect((await (await call(id)).json()).error).toEqual({ code: "JOB_FAILED", message: "boom" });
  });
});

describe("GET /api/collages/templates", () => {
  const call = async (headers: Record<string, string> = auth) => {
    const { GET } = await import("@/app/api/collages/templates/route");
    return GET(new Request("http://x/api/collages/templates", { headers }));
  };
  it("rejects missing credentials", async () => {
    expect((await call({})).status).toBe(401);
  });
  it("lists the shipped templates with their cell layouts", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { templates } = (await res.json()) as { templates: { id: string; cells: unknown[] }[] };
    expect(templates.map((t) => t.id)).toContain("hero-4");
    expect(templates.find((t) => t.id === "hero-4")?.cells).toHaveLength(5);
  });
});

describe("POST /api/collages", () => {
  const ownerId = "11111111-1111-1111-1111-111111111111";
  const key = (name: string, owner = ownerId) => `uploads/${owner}/up-1/${name}`;
  const canvas = { w: 1080, h: 1080 };
  const body = (images: string[], extra: Record<string, unknown> = {}) => ({
    images,
    mode: "grid",
    style: "justified",
    canvas,
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

  it("rejects missing credentials", async () => {
    await expectRejected(await call(body([key("a.png")]), {}), 401, "UNAUTHORIZED");
  });
  it("rejects duplicate keys", async () => {
    await expectRejected(await call(body([key("a.png"), key("a.png")])), 400, "VALIDATION_FAILED");
  });
  it("hides keys outside the caller's upload namespace", async () => {
    const other = "99999999-9999-9999-9999-999999999999";
    for (const k of [key("a.png", other), `uploads/${ownerId}x/up/a.png`, "a.png"]) {
      headObject.mockClear();
      await expectRejected(await call(body([k])), 404, "NOT_FOUND");
      expect(headObject).not.toHaveBeenCalled();
    }
    await expectRejected(await call(body([key("../a.png")])), 404, "NOT_FOUND");
  });
  it("maps a missing S3 object to 404", async () => {
    headObject.mockRejectedValue(
      Object.assign(new Error("NotFound"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expectRejected(await call(body([key("a.png")])), 404, "NOT_FOUND");
  });
  it("does not mask other storage failures as client errors", async () => {
    headObject.mockRejectedValue(new Error("connection reset"));
    await expectRejected(await call(body([key("a.png")])), 500, "INTERNAL");
  });
  it("rejects unsupported MIME types and extensions", async () => {
    headObject.mockResolvedValue({ contentType: "application/pdf", sizeBytes: 1000 });
    await expectRejected(await call(body([key("a.png")])), 400, "VALIDATION_FAILED");
    headObject.mockResolvedValue({ contentType: undefined, sizeBytes: 1000 });
    await expectRejected(await call(body([key("a.png")])), 400, "VALIDATION_FAILED");
    headObject.mockResolvedValue({ contentType: "image/png", sizeBytes: 1000 });
    await expectRejected(await call(body([key("a.gif")])), 400, "VALIDATION_FAILED");
    await expectRejected(await call(body([key("a")])), 400, "VALIDATION_FAILED");
  });
  it("rejects missing or oversized objects", async () => {
    const tooBig = 2 * 1024 * 1024;
    headObject.mockResolvedValue({ contentType: "image/png", sizeBytes: tooBig });
    await expectRejected(await call(body([key("a.png")])), 413, "PAYLOAD_TOO_LARGE");
    for (const sizeBytes of [undefined, 0]) {
      headObject.mockResolvedValue({ contentType: "image/png", sizeBytes });
      await expectRejected(await call(body([key("a.png")])), 400, "VALIDATION_FAILED");
    }
  });
  it("rejects more images than COLLAGE_MAX_IMAGES", async () => {
    const images = Array.from({ length: 21 }, (_, i) => key(`${i}.png`));
    await expectRejected(await call(body(images)), 400, "VALIDATION_FAILED");
  });
  it("rejects canvases over the side or area limits", async () => {
    for (const c of [
      { w: 8193, h: 100 },
      { w: 100, h: 8193 },
      { w: 6000, h: 7000 },
    ]) {
      await expectRejected(
        await call(body([key("a.png")], { canvas: c })),
        400,
        "VALIDATION_FAILED",
      );
    }
  });
  it("rejects file templates with the wrong image count", async () => {
    const images = [key("a.png"), key("b.png"), key("c.png")];
    const res = await call(body(images, { style: "template", template: "grid-2x2" }));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });
  it("rejects unknown template ids", async () => {
    const images = [key("a.png"), key("b.png"), key("c.png"), key("d.png")];
    const res = await call(body(images, { style: "template", template: "no-such-template" }));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("enqueues a one-image justified job and returns only the job id", async () => {
    const res = await call(body([key("a.png")], { webhookUrl: "https://hooks.example/x" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(register).toHaveBeenCalledWith({
      ownerId,
      key: key("a.png"),
      kind: "image",
      contentType: "image/png",
      sizeBytes: 1000,
    });
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ queue: "collage", type: "collage.build", ownerId }),
    );
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "collage",
      type: "collage.build",
      ownerId,
      webhookUrl: "https://hooks.example/x",
      input: {
        sourceAssetIds: ["asset-a.png"],
        style: "justified",
        canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
        format: "png",
      },
    });
  });
  it("enqueues a photo wall with the uploaded images in order", async () => {
    const res = await call(
      body([key("a.png"), key("b.png")], {
        style: "photo-wall",
        photoWallPreset: "scrapbook",
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "collage.build",
        input: expect.objectContaining({
          sourceAssetIds: ["asset-a.png", "asset-b.png"],
          style: "photo-wall",
          photoWallPreset: "scrapbook",
        }),
      }),
    );
  });
  it("rejects unknown wall presets and presets used with other styles", async () => {
    expect(
      (
        await call(
          body([key("a.png")], {
            style: "photo-wall",
            photoWallPreset: "unknown",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          body([key("a.png")], {
            style: "justified",
            photoWallPreset: "warm",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("enqueues a multi-image template job in request order with asset IDs, not keys", async () => {
    headObject.mockResolvedValue({ contentType: "image/JPEG; charset=binary", sizeBytes: 5 });
    const keys = ["a.JPG", "b.jpeg", "c.webp", "d.png"].map((n) => key(n));
    const res = await call(
      body(keys, {
        style: "template",
        template: "grid-2x2",
        format: "jpeg",
        canvas: { ...canvas, bg: "#ABCDEF" },
      }),
    );
    expect(res.status).toBe(202);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/jpeg" }));
    const [args] = enqueueJob.mock.calls[0] as [
      { input: Record<string, unknown>; webhookUrl?: string },
    ];
    expect(args.input).toEqual({
      sourceAssetIds: ["asset-a.JPG", "asset-b.jpeg", "asset-c.webp", "asset-d.png"],
      style: "template",
      template: expect.objectContaining({ id: "grid-2x2", cols: [1, 1], rows: [1, 1] }),
      canvas: { w: 1080, h: 1080, gap: 12, bg: "#ABCDEF" },
      format: "jpeg",
    });
    expect(JSON.stringify(args)).not.toContain("uploads/");
  });
  it("enqueues a custom template definition as given", async () => {
    const customTemplate = gridTemplate(2, 1, "custom");
    const res = await call(
      body([key("a.png"), key("b.png")], { style: "template", customTemplate }),
    );
    expect(res.status).toBe(202);
    const [args] = enqueueJob.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(args.input.template).toEqual(customTemplate);
  });
  it("surfaces a key registered by another owner as a conflict", async () => {
    const { AppError } = await import("@/server/http/errors");
    register.mockRejectedValue(new AppError("CONFLICT", 409, "Asset key is already registered"));
    const res = await call(body([key("a.png")]));
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

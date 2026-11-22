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
});

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  enqueueJob: vi.fn(),
  headObject: vi.fn(),
  register: vi.fn(),
}));
const { findActiveByHash, enqueueJob, headObject, register } = mocks;
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner: vi.fn() } }));
vi.mock("@/server/db/repositories/assets", () => ({ assetsRepo: { register: mocks.register } }));
vi.mock("@/server/queue/queues", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/server/storage/objects", () => ({ headObject: mocks.headObject }));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const ownerId = "11111111-1111-1111-1111-111111111111";
const auth = { Authorization: "Bearer ak_test" };
const key = (name: string, owner = ownerId) => `uploads/${owner}/up-1/${name}`;
const keys = (count: number) => Array.from({ length: count }, (_, i) => key(`${i}.png`));
const body = (
  count: number,
  polaroid: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  images: keys(count),
  mode: "polaroid",
  polaroid: { slideAspect: "4:5", ...polaroid },
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
  headObject.mockReset().mockResolvedValue({ contentType: "image/png", sizeBytes: 1000 });
  register.mockReset().mockImplementation(async (args: { key: string }) => ({
    id: `asset-${args.key.split("/").pop()}`,
  }));
});

describe("POST /api/collages (polaroid)", () => {
  it("rejects missing credentials", async () => {
    await expectRejected(await call(body(4), {}), 401, "UNAUTHORIZED");
  });

  it("queues a collage.polaroid job with resolved options", async () => {
    const payload = body(
      4,
      { captions: [" Summer ", "b", "", "d"] },
      { format: "jpeg", webhookUrl: "https://example.com/hook" },
    );
    const res = await call(payload);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "collage",
      type: "collage.polaroid",
      ownerId,
      input: {
        sourceAssetIds: ["asset-0.png", "asset-1.png", "asset-2.png", "asset-3.png"],
        slides: 2,
        slideAspect: "4:5",
        template: "scatter",
        imagesPerSlide: [2, 2],
        slideSizes: ["large", "large"],
        captions: ["Summer", "b", "", "d"],
        format: "jpeg",
      },
      webhookUrl: "https://example.com/hook",
    });
  });

  it("derives slides from the image count and blanks missing captions", async () => {
    await call(body(7));
    const [args] = enqueueJob.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(args.input).toMatchObject({
      slides: 3,
      captions: Array.from({ length: 7 }, () => ""),
      format: "png",
    });
    expect(args).not.toHaveProperty("webhookUrl");
  });

  it("keeps an explicit slide count and registers the images in order", async () => {
    await call(body(4, { slides: 4, slideAspect: "1:1" }));
    const [args] = enqueueJob.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(args.input).toMatchObject({ slides: 4, slideAspect: "1:1" });
    expect(register).toHaveBeenCalledTimes(4);
    expect(register).toHaveBeenNthCalledWith(1, {
      ownerId,
      kind: "image",
      key: key("0.png"),
      contentType: "image/png",
      sizeBytes: 1000,
    });
    expect(register.mock.calls.map(([a]) => (a as { key: string }).key)).toEqual(keys(4));
  });

  it("rejects fewer images than slides without registering anything", async () => {
    const res = await call(body(2, { slides: 3 }));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("rejects more images than the configured maximum", async () => {
    await expectRejected(await call(body(21, { slides: 10 })), 400, "VALIDATION_FAILED");
  });

  it("hides keys outside the caller's upload namespace", async () => {
    const other = "99999999-9999-9999-9999-999999999999";
    const payload = { ...body(2), images: [key("0.png"), key("1.png", other)] };
    await expectRejected(await call(payload), 404, "NOT_FOUND");
  });

  it("rejects an unsupported stored content type", async () => {
    headObject.mockResolvedValue({ contentType: "application/pdf", sizeBytes: 1000 });
    await expectRejected(await call(body(2)), 400, "VALIDATION_FAILED");
  });
});

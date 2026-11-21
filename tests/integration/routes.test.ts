import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => ({ findActiveByHash: vi.fn(), getForOwner: vi.fn() }));
const { findActiveByHash, getForOwner } = mocks;
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner: mocks.getForOwner } }));
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({
  db: vi.fn(),
  redis: vi.fn(),
  getRedis: vi.fn(),
  getProducerRedis: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({ execute: checks.db }),
}));
vi.mock("@/server/queue/queues", () => ({
  getRedis: checks.getRedis,
  getProducerRedis: checks.getProducerRedis,
}));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/health/route";

function request(): Request {
  return new Request("http://localhost/api/health");
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    checks.db.mockResolvedValue(undefined);
    checks.redis.mockResolvedValue("PONG");
    checks.getRedis.mockImplementation(() => ({ ping: checks.redis }));
    checks.getProducerRedis.mockImplementation(() => ({ ping: checks.redis }));
  });

  it("returns 200 with healthy dependency checks", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { db: true, redis: true },
    });
    expect(checks.getProducerRedis).toHaveBeenCalledOnce();
    expect(checks.getRedis).not.toHaveBeenCalled();
  });

  it("returns a 503 envelope when a dependency check fails", async () => {
    vi.useFakeTimers();
    checks.db.mockRejectedValue(new Error("database down"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        details: { checks: { db: false, redis: true } },
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a 503 envelope when Redis ping times out and clears its timer", async () => {
    vi.useFakeTimers();
    checks.redis.mockImplementation(() => new Promise(() => undefined));
    const responsePromise = GET(request());

    await vi.advanceTimersByTimeAsync(2000);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        details: { checks: { db: true, redis: false } },
      },
    });
    expect(checks.getProducerRedis).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

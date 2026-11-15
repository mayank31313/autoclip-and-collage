import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  transition: vi.fn(),
  add: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function () {
    return { add: mocks.add, on: vi.fn() };
  }),
}));
vi.mock("ioredis", () => ({
  default: vi.fn(function () {
    return { status: "ready", on: vi.fn() };
  }),
}));
vi.mock("@/server/config", () => ({ getConfig: () => ({ redisUrl: "redis://localhost:6379" }) }));
vi.mock("@/server/db/repositories/jobs", () => ({
  jobsRepo: { create: mocks.create, transition: mocks.transition },
}));

import { enqueueJob } from "@/server/queue/queues";

const args = { queue: "collage" as const, type: "build", ownerId: "o1", input: {} };

describe("enqueueJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "job-1" });
  });

  it("fails the job row and throws QUEUE_UNAVAILABLE when the queue rejects", async () => {
    mocks.add.mockRejectedValue(new Error("Connection is closed"));
    await expect(enqueueJob(args)).rejects.toMatchObject({
      code: "QUEUE_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.transition).toHaveBeenCalledWith(
      "job-1",
      "failed",
      expect.objectContaining({ errorCode: "QUEUE_UNAVAILABLE" }),
    );
  });

  it("returns the row and does not fail it when the queue accepts the job", async () => {
    mocks.add.mockResolvedValue({});
    await expect(enqueueJob(args)).resolves.toEqual({ id: "job-1" });
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});

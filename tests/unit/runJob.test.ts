import { describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/server/logger", () => ({ logger: logMocks }));

import { AppError } from "@/server/http/errors";
import { runJob, type RunJobDeps } from "../../worker/runJob";

type Row = {
  id: string;
  status: string;
  webhookUrl: string | null;
  type: string;
  progress: number;
  [k: string]: unknown;
};

function harness(initial: Partial<Row> = {}) {
  const row: Row = {
    id: "j1",
    status: "queued",
    webhookUrl: null,
    type: "t",
    progress: 0,
    ...initial,
  };
  const history: string[] = [];
  const notify = vi.fn(async () => undefined);
  const deps = {
    store: {
      get: async () => ({ ...row }),
      transition: async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        history.push(to);
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
      setProgress: async () => undefined,
    },
    notify,
  } as unknown as RunJobDeps;
  return { row, history, notify, deps };
}

const args = { jobId: "j1", attemptsMade: 0, maxAttempts: 3 };

describe("runJob", () => {
  it("runs queued -> running -> succeeded and stores the result", async () => {
    const h = harness();
    await runJob(args, async () => ({ out: 1 }), h.deps);
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({ out: 1 });
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });
  it("is a no-op for jobs that already finished (idempotent retry)", async () => {
    const h = harness({ status: "succeeded" });
    const work = vi.fn();
    await runJob(args, work, h.deps);
    expect(work).not.toHaveBeenCalled();
    expect(h.history).toEqual([]);
  });
  it("resumes a job left running by a crashed attempt", async () => {
    const h = harness({ status: "running" });
    await runJob(args, async () => ({}), h.deps);
    expect(h.history).toEqual(["succeeded"]);
  });
  it("requeues and rethrows when attempts remain", async () => {
    const h = harness();
    await expect(
      runJob(
        args,
        async () => {
          throw new Error("x");
        },
        h.deps,
      ),
    ).rejects.toThrow("x");
    expect(h.history).toEqual(["running", "queued"]);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("fails permanently with the AppError code on the final attempt and notifies", async () => {
    const h = harness();
    const final = { ...args, attemptsMade: 2 };
    await expect(
      runJob(
        final,
        async () => {
          throw new AppError("VALIDATION_FAILED", 400, "bad input");
        },
        h.deps,
      ),
    ).rejects.toThrow();
    expect(h.history).toEqual(["running", "failed"]);
    expect(h.row).toMatchObject({ errorCode: "VALIDATION_FAILED", errorMessage: "bad input" });
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "failed");
  });
  it("does not fail the job if notification throws", async () => {
    const h = harness();
    h.notify.mockRejectedValueOnce(new Error("hook down"));
    await expect(runJob(args, async () => ({}), h.deps)).resolves.toBeUndefined();
    expect(logMocks.error).toHaveBeenCalled();
  });
});

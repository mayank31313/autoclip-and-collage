import { randomUUID } from "node:crypto";
import type { JobStatus } from "@/lib/schemas/job";
import { jobsRepo, type JobRow, type TransitionPatch } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/logger";
import { deliverWebhook } from "@/server/webhooks/deliver";

export interface JobStore {
  get(id: string): Promise<JobRow | undefined>;
  transition(id: string, to: JobStatus, patch?: TransitionPatch): Promise<JobRow>;
  setProgress(id: string, progress: number): Promise<void>;
}

export interface RunJobDeps {
  store: JobStore;
  notify(job: JobRow, status: JobStatus): Promise<void>;
}

const defaultDeps: RunJobDeps = {
  store: jobsRepo,
  async notify(job, status) {
    if (!job.webhookUrl) return;
    await deliverWebhook({
      url: job.webhookUrl,
      event: { eventId: randomUUID(), jobId: job.id, type: job.type, status, resultUrls: [] },
    });
  },
};

const FINISHED: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

async function safeNotify(deps: RunJobDeps, job: JobRow, status: JobStatus): Promise<void> {
  try {
    await deps.notify(job, status);
  } catch (err) {
    logger.error({ jobId: job.id, err }, "webhook notification failed");
  }
}

/**
 * Runs a processor with persistent state and retry semantics. A crashed `running` job resumes,
 * while terminal jobs are skipped to keep duplicate queue deliveries idempotent.
 */
export async function runJob(
  args: { jobId: string; attemptsMade: number; maxAttempts: number },
  work: (ctx: {
    job: JobRow;
    progress(progress: number): Promise<void>;
  }) => Promise<Record<string, unknown>>,
  deps: RunJobDeps = defaultDeps,
): Promise<void> {
  const job = await deps.store.get(args.jobId);
  if (!job) throw new AppError("NOT_FOUND", 404, `Job ${args.jobId} not found`);
  if (FINISHED.includes(job.status)) return;

  const running = job.status === "running" ? job : await deps.store.transition(job.id, "running");
  try {
    const result = await work({
      job: running,
      progress: (progress) => deps.store.setProgress(job.id, progress),
    });
    const done = await deps.store.transition(job.id, "succeeded", { progress: 100, result });
    await safeNotify(deps, done, "succeeded");
  } catch (err) {
    const finalAttempt = args.attemptsMade + 1 >= args.maxAttempts;
    if (!finalAttempt) {
      await deps.store.transition(job.id, "queued");
    } else {
      const failed = await deps.store.transition(job.id, "failed", {
        errorCode: err instanceof AppError ? err.code : "JOB_FAILED",
        errorMessage:
          err instanceof AppError && err.status >= 400 && err.status < 500
            ? err.message
            : "Job failed",
      });
      await safeNotify(deps, failed, "failed");
    }
    throw err;
  }
}

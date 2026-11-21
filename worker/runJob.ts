import { randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import type { JobStatus } from "@/lib/schemas/job";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";
import { jobsRepo, type JobRow, type TransitionPatch } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { COLLAGE_JOB_TYPE, resolveCollageResult } from "@/server/jobs/collageResult";
import { resolvePolaroidResult } from "@/server/jobs/polaroidResult";
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
      event: {
        eventId: randomUUID(),
        jobId: job.id,
        type: job.type,
        status,
        resultUrls: await resultUrlsFor(job, status),
      },
    });
  },
};

/** Signs URLs at delivery time; a result that cannot be resolved must not block the webhook. */
async function resultUrlsFor(job: JobRow, status: JobStatus): Promise<string[]> {
  if (status !== "succeeded") return [];
  try {
    if (job.type === COLLAGE_JOB_TYPE) {
      const { output } = await resolveCollageResult(job);
      return [output.downloadUrl];
    }
    if (job.type === POLAROID_JOB_TYPE) {
      const { output } = await resolvePolaroidResult(job);
      return [output.zipUrl, ...output.slides.map((slide) => slide.url)];
    }
    return [];
  } catch (err) {
    logger.warn({ jobId: job.id, err }, "could not resolve webhook result URL");
    return [];
  }
}

const FINISHED: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];
const RETRYABLE_CLIENT_STATUSES: readonly number[] = [408, 429];

/** A 4xx AppError describes bad input, which no retry can fix. */
function isPermanentFailure(err: unknown): err is AppError {
  return (
    err instanceof AppError &&
    err.status >= 400 &&
    err.status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.includes(err.status)
  );
}

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
    const permanent = isPermanentFailure(err);
    const finalAttempt = args.attemptsMade + 1 >= args.maxAttempts;
    if (!finalAttempt && !permanent) {
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
    // BullMQ retries any other error, so signal that retrying cannot help.
    if (permanent) throw new UnrecoverableError(err.message);
    throw err;
  }
}

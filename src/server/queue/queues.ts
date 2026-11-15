import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobData } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { jobsRepo, type JobRow } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";

export const QUEUE_NAMES = ["video-analyze", "video-render", "collage"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

let redis: IORedis | undefined;
/** BullMQ requires `maxRetriesPerRequest: null` for blocking worker connections. */
export function getRedis(): IORedis {
  redis ??= new IORedis(getConfig().redisUrl, { maxRetriesPerRequest: null });
  return redis;
}

const queues = new Map<QueueName, Queue<JobData>>();
export function getQueue(name: QueueName): Queue<JobData> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue<JobData>(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q;
}

export const JOB_ATTEMPTS = 3;

/** Persists the job row first, then enqueues with the row id as the BullMQ jobId (idempotent). */
export async function enqueueJob(args: {
  queue: QueueName;
  type: string;
  ownerId: string;
  input: Record<string, unknown>;
  webhookUrl?: string;
}): Promise<JobRow> {
  const row = await jobsRepo.create(args);
  try {
    await getQueue(args.queue).add(
      args.type,
      { jobId: row.id, type: args.type },
      {
        jobId: row.id,
        attempts: JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  } catch {
    await jobsRepo.transition(row.id, "failed", {
      errorCode: "QUEUE_UNAVAILABLE",
      errorMessage: "Could not enqueue job",
    });
    throw new AppError("QUEUE_UNAVAILABLE", 503, "Queue is unavailable");
  }
  return row;
}

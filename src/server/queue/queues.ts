import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobData } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { jobsRepo, type JobRow } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/logger";

export const QUEUE_NAMES = ["video-analyze", "video-render", "collage"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

let redis: IORedis | undefined;
/** BullMQ requires `maxRetriesPerRequest: null` for blocking worker connections. */
export function getRedis(): IORedis {
  redis ??= new IORedis(getConfig().redisUrl, { maxRetriesPerRequest: null });
  return redis;
}

const PRODUCER_MAX_RETRIES_PER_REQUEST = 1;
const PRODUCER_CONNECT_TIMEOUT_MS = 3000;
const PRODUCER_RETRY_DELAY_MS = 200;
const PRODUCER_MAX_RECONNECTS = 2;

const queues = new Map<QueueName, Queue<JobData>>();
let producerRedis: IORedis | undefined;
/**
 * Fail-fast connection for enqueueing from request handlers. With the worker settings an unreachable
 * Redis makes `Queue.add` wait forever, so the API could never report QUEUE_UNAVAILABLE. Here the
 * connection gives up after a few attempts (pending commands then reject) and is rebuilt on next use,
 * so the API recovers once Redis is back.
 */
export function getProducerRedis(): IORedis {
  if (!producerRedis || producerRedis.status === "end") {
    producerRedis = new IORedis(getConfig().redisUrl, {
      maxRetriesPerRequest: PRODUCER_MAX_RETRIES_PER_REQUEST,
      connectTimeout: PRODUCER_CONNECT_TIMEOUT_MS,
      retryStrategy: (times) =>
        times > PRODUCER_MAX_RECONNECTS ? null : PRODUCER_RETRY_DELAY_MS * times,
    });
    // Without a listener ioredis logs every failed connection attempt as an unhandled error.
    producerRedis.on("error", (err) => logger.warn({ err }, "producer redis error"));
    queues.clear();
  }
  return producerRedis;
}

export function getQueue(name: QueueName): Queue<JobData> {
  const connection = getProducerRedis();
  let q = queues.get(name);
  if (!q) {
    q = new Queue<JobData>(name, { connection });
    q.on("error", (err) => logger.warn({ err, queue: name }, "queue error"));
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

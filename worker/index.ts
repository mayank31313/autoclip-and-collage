import { Worker, type Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { logger } from "@/server/logger";
import { QUEUE_NAMES, getRedis, type QueueName } from "@/server/queue/queues";
import { placeholderProcessor } from "./processors/placeholder";

// TODO(milestone-1/collage, milestone-1/video): replace these with real processors.
export const processors: Record<QueueName, (job: Job<JobData>) => Promise<void>> = {
  "video-analyze": placeholderProcessor,
  "video-render": placeholderProcessor,
  collage: placeholderProcessor,
};

function concurrencyFor(name: QueueName): number {
  const config = getConfig();
  return name === "video-analyze"
    ? config.workerConcurrencyAnalyze
    : config.workerConcurrencyRender;
}

const workers = QUEUE_NAMES.map((name) => {
  const worker = new Worker<JobData>(name, processors[name], {
    connection: getRedis(),
    concurrency: concurrencyFor(name),
  });
  worker.on("failed", (job, err) =>
    logger.error({ queue: name, jobId: job?.id, err }, "job attempt failed"),
  );
  worker.on("completed", (job) => logger.info({ queue: name, jobId: job.id }, "job completed"));
  return worker;
});

logger.info({ queues: QUEUE_NAMES }, "worker started");

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down");
  await Promise.all(workers.map((worker) => worker.close()));
  await getRedis().quit();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";
import { buildCollageProcessor } from "./buildCollage";
import { buildPolaroidProcessor } from "./buildPolaroid";

type Processor = (job: Job<JobData>) => Promise<void>;

/** The `collage` queue carries several job types; route each to its processor by type. */
export function createCollageDispatcher(handlers: {
  grid: Processor;
  polaroid: Processor;
}): Processor {
  return (job) =>
    job.data.type === POLAROID_JOB_TYPE ? handlers.polaroid(job) : handlers.grid(job);
}

export const collageDispatcher = createCollageDispatcher({
  grid: buildCollageProcessor,
  polaroid: buildPolaroidProcessor,
});

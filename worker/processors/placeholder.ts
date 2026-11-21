import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { runJob } from "../runJob";

/** Stand-in until the Collage and Video sub-projects register real processors. */
export async function placeholderProcessor(job: Job<JobData>): Promise<void> {
  await runJob(
    {
      jobId: job.data.jobId,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    },
    async ({ progress }) => {
      await progress(50);
      return { note: "placeholder processor" };
    },
  );
}

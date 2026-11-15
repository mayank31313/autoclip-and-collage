import { z } from "zod";

export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobResponse = z.object({
  id: z.string(),
  type: z.string(),
  status: JobStatus,
  progress: z.number().int().min(0).max(100),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type JobResponse = z.infer<typeof JobResponse>;

/** Data carried on the BullMQ job; the full input lives in Postgres. */
export const JobData = z.object({ jobId: z.string().uuid(), type: z.string() });
export type JobData = z.infer<typeof JobData>;

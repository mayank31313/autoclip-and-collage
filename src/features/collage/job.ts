import type { JobStatus } from "@/lib/schemas/job";

export const JOB_POLL_INTERVAL_MS = 1000;

const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Poll cadence for TanStack Query; `false` stops polling once the job is terminal. */
export function jobRefetchInterval(job: { status: JobStatus } | undefined): number | false {
  return job && isTerminalStatus(job.status) ? false : JOB_POLL_INTERVAL_MS;
}

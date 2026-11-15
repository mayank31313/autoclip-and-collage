import type { JobStatus } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";

const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled", "queued"], // running -> queued is a retry
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("CONFLICT", 409, `Invalid job transition ${from} -> ${to}`);
  }
}

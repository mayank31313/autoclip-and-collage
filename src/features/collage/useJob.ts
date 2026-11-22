"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchJob, type ApiKey } from "@/features/collage/api";
import { jobRefetchInterval } from "@/features/collage/job";
import type { JobResponse } from "@/lib/schemas/job";

const MAX_TRANSIENT_RETRIES = 3;

/** Client errors (bad key, unknown job) will not fix themselves; only transient failures retry. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_TRANSIENT_RETRIES;
}

/**
 * Polls `GET /api/jobs/:id` until the job is terminal. The API key is used only in the request
 * closure, so it never appears in the query key.
 */
export function useJob(apiKey: ApiKey, jobId: string | null) {
  const query = useQuery<JobResponse, Error>({
    queryKey: ["collage-job", jobId],
    queryFn: () => fetchJob(apiKey, jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (q) => jobRefetchInterval(q.state.data),
    retry: shouldRetry,
    gcTime: 0,
  });
  return { job: jobId === null ? undefined : query.data, error: query.error };
}

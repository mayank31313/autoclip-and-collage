import { z } from "zod";
import type { JobResponse } from "@/lib/schemas/job";
import { jobsRepo } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { COLLAGE_JOB_TYPE, resolveCollageResult } from "@/server/jobs/collageResult";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guid (not uuid): only guards the Postgres uuid cast, without enforcing RFC version/variant bits.
const IdParam = z.guid();

export const GET = withApi({ auth: "apiKey" }, async ({ params, ctx }) => {
  const id = IdParam.safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND", 404, "Job not found");
  const job = await jobsRepo.getForOwner(id.data, requirePrincipal(ctx).id);
  if (!job) throw new AppError("NOT_FOUND", 404, "Job not found");
  // Signed URLs are never stored: each poll resolves the owner's output asset and signs afresh.
  let result: JobResponse["result"] = job.result ?? null;
  if (job.type === COLLAGE_JOB_TYPE) {
    result = job.status === "succeeded" ? await resolveCollageResult(job) : null;
  }
  const json: JobResponse = {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    result,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ?? "" } : null,
  };
  return { json };
});

import { z } from "zod";
import type { JobResponse } from "@/lib/schemas/job";
import { jobsRepo } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guid (not uuid): only guards the Postgres uuid cast, without enforcing RFC version/variant bits.
const IdParam = z.guid();

export const GET = withApi({ auth: "apiKey" }, async ({ params, ctx }) => {
  const id = IdParam.safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND", 404, "Job not found");
  const job = await jobsRepo.getForOwner(id.data, requirePrincipal(ctx).id);
  if (!job) throw new AppError("NOT_FOUND", 404, "Job not found");
  const json: JobResponse = {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    result: job.result ?? null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ?? "" } : null,
  };
  return { json };
});

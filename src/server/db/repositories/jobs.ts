import { and, eq } from "drizzle-orm";
import type { JobStatus } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import { assertTransition } from "@/server/jobs/state";
import { getDb } from "../client";
import { jobs } from "../schema";

export type JobRow = typeof jobs.$inferSelect;

export interface TransitionPatch {
  progress?: number;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

const TERMINAL: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export function buildTransitionSet(to: JobStatus, patch: TransitionPatch, now: Date) {
  const clearOutput = to === "queued" || to === "running";
  const clearErrors = clearOutput || to === "succeeded";

  return {
    status: to,
    updatedAt: now,
    finishedAt: TERMINAL.includes(to) ? now : null,
    ...(clearErrors && { errorCode: null, errorMessage: null }),
    ...(clearOutput && { result: null }),
    ...(patch.progress !== undefined && { progress: patch.progress }),
    ...(patch.result !== undefined && { result: patch.result }),
    ...(patch.errorCode !== undefined && { errorCode: patch.errorCode }),
    ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
  };
}

export const jobsRepo = {
  async create(args: {
    ownerId: string;
    queue: string;
    type: string;
    input: Record<string, unknown>;
    webhookUrl?: string;
  }): Promise<JobRow> {
    const [row] = await getDb().insert(jobs).values(args).returning();
    return row;
  },
  async get(id: string): Promise<JobRow | undefined> {
    const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return row;
  },
  async getForOwner(id: string, ownerId: string): Promise<JobRow | undefined> {
    const [row] = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, ownerId)))
      .limit(1);
    return row;
  },
  /** Compare-and-set on the current status so concurrent workers cannot both win. */
  async transition(id: string, to: JobStatus, patch: TransitionPatch = {}): Promise<JobRow> {
    const current = await jobsRepo.get(id);
    if (!current) throw new AppError("NOT_FOUND", 404, "Job not found");
    assertTransition(current.status, to);
    const [row] = await getDb()
      .update(jobs)
      .set(buildTransitionSet(to, patch, new Date()))
      .where(and(eq(jobs.id, id), eq(jobs.status, current.status)))
      .returning();
    if (!row) throw new AppError("CONFLICT", 409, "Job state changed concurrently");
    return row;
  },
  async setProgress(id: string, progress: number): Promise<void> {
    await getDb().update(jobs).set({ progress, updatedAt: new Date() }).where(eq(jobs.id, id));
  },
};

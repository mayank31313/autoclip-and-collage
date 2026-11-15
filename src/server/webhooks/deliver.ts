import type { JobStatus } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { logger } from "@/server/logger";
import { webhookDeliveriesRepo } from "@/server/db/repositories/webhookDeliveries";
import { signPayload } from "@/server/security/hmac";
import { assertPublicUrl } from "@/server/security/ssrf";

export interface WebhookEvent {
  eventId: string;
  jobId: string;
  type: string;
  status: JobStatus;
  resultUrls: string[];
}

export interface WebhookDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  secret: string;
  maxAttempts: number;
  baseDelayMs: number;
  timeoutMs: number;
  nowSec: () => number;
  assertUrl: (url: string) => Promise<unknown>;
  record: (a: {
    eventId: string;
    jobId: string;
    url: string;
    attempt: number;
    statusCode?: number;
    error?: string;
  }) => Promise<void>;
}

export function defaultWebhookDeps(): WebhookDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    secret: getConfig().webhookSecret,
    maxAttempts: 5,
    baseDelayMs: 1000,
    timeoutMs: 10_000,
    nowSec: () => Math.floor(Date.now() / 1000),
    assertUrl: (url) => assertPublicUrl(url),
    record: (a) => webhookDeliveriesRepo.record(a),
  };
}

type Attempt = Parameters<WebhookDeps["record"]>[0];

/** Audit trail is best-effort: a DB failure must neither trigger a retry nor escape the delivery. */
async function recordSafely(deps: WebhookDeps, attempt: Attempt): Promise<void> {
  try {
    await deps.record(attempt);
  } catch (err) {
    logger.warn(
      { err, eventId: attempt.eventId, jobId: attempt.jobId, attempt: attempt.attempt },
      "failed to record webhook delivery attempt",
    );
  }
}

async function releaseBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // body already consumed or errored; nothing left to release
  }
}

/** Returns true on a 2xx response. Never throws: callers must not fail a job because a receiver is down. */
export async function deliverWebhook(
  args: { url: string; event: WebhookEvent },
  deps: WebhookDeps = defaultWebhookDeps(),
): Promise<boolean> {
  try {
    await deps.assertUrl(args.url);
  } catch {
    return false;
  }
  const body = JSON.stringify(args.event);
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    const timestamp = deps.nowSec();
    const rec = { eventId: args.event.eventId, jobId: args.event.jobId, url: args.url, attempt };
    let res: Response | undefined;
    let error: string | undefined;
    try {
      res = await deps.fetch(args.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(deps.timeoutMs),
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": String(timestamp),
          "X-Signature": signPayload({ secret: deps.secret, body, timestamp }),
        },
        body,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : "request failed";
    }
    if (res) await releaseBody(res);
    await recordSafely(deps, res ? { ...rec, statusCode: res.status } : { ...rec, error });
    if (res?.ok) return true;
    if (attempt < deps.maxAttempts) await deps.sleep(deps.baseDelayMs * 2 ** (attempt - 1));
  }
  return false;
}

import type { JobStatus } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
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
    nowSec: () => Math.floor(Date.now() / 1000),
    assertUrl: (url) => assertPublicUrl(url),
    record: (a) => webhookDeliveriesRepo.record(a),
  };
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
    try {
      const res = await deps.fetch(args.url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": String(timestamp),
          "X-Signature": signPayload({ secret: deps.secret, body, timestamp }),
        },
        body,
      });
      await deps.record({ ...rec, statusCode: res.status });
      if (res.ok) return true;
    } catch (err) {
      await deps.record({ ...rec, error: err instanceof Error ? err.message : "request failed" });
    }
    if (attempt < deps.maxAttempts) await deps.sleep(deps.baseDelayMs * 2 ** (attempt - 1));
  }
  return false;
}

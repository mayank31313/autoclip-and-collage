import { describe, expect, it, vi } from "vitest";
import { deliverWebhook, type WebhookDeps } from "@/server/webhooks/deliver";
import { verifySignature } from "@/server/security/hmac";

const event = {
  eventId: "e1",
  jobId: "j1",
  type: "collage.build",
  status: "succeeded" as const,
  resultUrls: [],
};
const secret = "s".repeat(32);

function deps(responses: Array<Response | Error>): WebhookDeps & {
  sleeps: number[];
  records: unknown[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const sleeps: number[] = [];
  const records: unknown[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    fetch: fetchMock as unknown as WebhookDeps["fetch"],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    secret,
    maxAttempts: 3,
    baseDelayMs: 100,
    nowSec: () => 1000,
    assertUrl: async () => undefined,
    record: async (r) => {
      records.push(r);
    },
    sleeps,
    records,
    fetchMock,
  };
}

describe("deliverWebhook", () => {
  it("sends a verifiable signed request and records the attempt", async () => {
    const d = deps([new Response("ok", { status: 200 })]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    const [, init] = d.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(
      verifySignature({
        secret,
        body: init.body as string,
        signature: headers["X-Signature"],
        timestamp: Number(headers["X-Timestamp"]),
        toleranceSec: 300,
        nowSec: 1000,
      }),
    ).toBe(true);
    expect(d.records).toEqual([
      expect.objectContaining({ attempt: 1, statusCode: 200, eventId: "e1" }),
    ]);
  });
  it("retries with exponential backoff then succeeds", async () => {
    const d = deps([
      new Response("", { status: 500 }),
      new Error("boom"),
      new Response(null, { status: 204 }),
    ]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    expect(d.sleeps).toEqual([100, 200]);
    expect(d.records).toHaveLength(3);
  });
  it("gives up after maxAttempts and returns false", async () => {
    const d = deps([
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
    ]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(false);
    expect(d.records).toHaveLength(3);
  });
  it("does not send when the URL fails the SSRF check", async () => {
    const d = deps([]);
    d.assertUrl = async () => {
      throw new Error("blocked");
    };
    expect(await deliverWebhook({ url: "http://127.0.0.1/", event }, d)).toBe(false);
    expect(d.fetchMock).not.toHaveBeenCalled();
  });
});

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
    timeoutMs: 5000,
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
  it("revalidates and pins the destination on every retry", async () => {
    const d = deps([new Response("", { status: 500 }), new Response("ok", { status: 200 })]);
    const addresses = ["93.184.216.34", "8.8.8.8"];
    let validationCount = 0;
    const assertUrl = vi.fn(async () => addresses[validationCount++]);
    d.assertUrl = assertUrl;

    await deliverWebhook({ url: "https://hook.test/x", event }, d);

    expect(assertUrl).toHaveBeenCalledTimes(2);
    expect(
      (d.fetchMock.mock.calls as unknown as Array<[string, RequestInit, string]>).map(
        (call) => call[2],
      ),
    ).toEqual(addresses);
  });
  it("uses one timeout signal for destination validation and request", async () => {
    const d = deps([new Response("ok", { status: 200 })]);
    let validationSignal: AbortSignal | undefined;
    d.assertUrl = async (_url, signal) => {
      validationSignal = signal;
      return "93.184.216.34";
    };

    await deliverWebhook({ url: "https://hook.test/x", event }, d);

    expect(validationSignal).toBeInstanceOf(AbortSignal);
    expect((d.fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
      validationSignal,
    );
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
  it("returns true after a 2xx even if recording throws, without retrying", async () => {
    const d = deps([new Response("ok", { status: 200 })]);
    d.record = async () => {
      throw new Error("db down");
    };
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never rejects when recording throws on every failed attempt", async () => {
    const d = deps([
      new Response("", { status: 500 }),
      new Error("boom"),
      new Response("", { status: 500 }),
    ]);
    d.record = async () => {
      throw new Error("db down");
    };
    await expect(deliverWebhook({ url: "https://hook.test/x", event }, d)).resolves.toBe(false);
    expect(d.fetchMock).toHaveBeenCalledTimes(3);
  });
  it("passes an abort signal and retries when the request times out", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const d = deps([timeout, new Response("ok", { status: 200 })]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    for (const call of d.fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
    expect(d.records[0]).toEqual(expect.objectContaining({ attempt: 1, error: "timed out" }));
  });
  it("cancels the response body to release the socket", async () => {
    const res = new Response("ignored", { status: 500 });
    const cancel = vi.spyOn(res.body!, "cancel");
    const d = deps([res, new Response("ok", { status: 200 })]);
    await deliverWebhook({ url: "https://hook.test/x", event }, d);
    expect(cancel).toHaveBeenCalled();
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

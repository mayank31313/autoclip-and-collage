import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: transport.request }));
vi.mock("node:https", () => ({ request: transport.request }));

import { fetchPinned, safeFetch, type SafeFetchDeps } from "@/server/security/ssrf";
import { defaultWebhookDeps, deliverWebhook } from "@/server/webhooks/deliver";

afterEach(() => {
  vi.unstubAllGlobals();
  transport.request.mockReset();
});

describe("pinned HTTP transport", () => {
  it("uses the validated address in the socket lookup instead of resolving the host again", async () => {
    let lookupResult: unknown;
    transport.request.mockImplementation((...args: unknown[]) => {
      const options = args[1] as {
        lookup: (
          hostname: string,
          options: unknown,
          callback: (error: Error | null, address: string, family: number) => void,
        ) => void;
      };
      options.lookup("example.com", {}, (error, address, family) => {
        lookupResult = { error, address, family };
      });

      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = 200;
        response.headers = {};
        (args[2] as (message: IncomingMessage) => void)(response as unknown as IncomingMessage);
        response.end("pinned");
      };
      return request as unknown as ClientRequest;
    });

    const resolve = vi.fn(async () => ["93.184.216.34"]);
    const response = await safeFetch(
      "https://example.com/file",
      { maxBytes: 10, timeoutMs: 1000, maxRedirects: 0 },
      { resolve } as SafeFetchDeps,
    );

    expect(await response.text()).toBe("pinned");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(lookupResult).toEqual({ error: null, address: "93.184.216.34", family: 4 });
  });

  it("uses the same pinned transport for default webhook delivery", async () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://u:p@localhost/d",
      REDIS_URL: "redis://localhost",
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "k",
      S3_SECRET_KEY: "s",
      S3_BUCKET: "b",
      API_KEY_PEPPER: "p".repeat(16),
      WEBHOOK_SIGNING_SECRET: "w".repeat(16),
    });
    transport.request.mockImplementation((...args: unknown[]) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = 204;
        response.headers = {};
        (args[2] as (message: IncomingMessage) => void)(response as unknown as IncomingMessage);
        response.end();
      };
      return request as unknown as ClientRequest;
    });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const deps = defaultWebhookDeps();
    deps.assertUrl = async () => "93.184.216.34";
    deps.record = async () => undefined;

    await expect(
      deliverWebhook(
        {
          url: "https://example.com/hook",
          event: {
            eventId: "e1",
            jobId: "j1",
            type: "test",
            status: "succeeded",
            resultUrls: [],
          },
        },
        deps,
      ),
    ).resolves.toBe(true);

    expect(transport.request).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns no body for HTTP 205 responses", async () => {
    transport.request.mockImplementation((...args: unknown[]) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = 205;
        response.headers = {};
        (args[2] as (message: IncomingMessage) => void)(response as unknown as IncomingMessage);
        response.end();
      };
      return request as unknown as ClientRequest;
    });

    await expect(fetchPinned("https://example.com/", {}, "93.184.216.34")).resolves.toMatchObject({
      status: 205,
      body: null,
    });
  });
});

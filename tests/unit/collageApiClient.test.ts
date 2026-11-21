import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createCollage,
  fetchJob,
  presignUpload,
  uploadFiles,
} from "@/features/collage/api";
import { isTerminalStatus, jobRefetchInterval, JOB_POLL_INTERVAL_MS } from "@/features/collage/job";
import type { CreateCollageBody } from "@/lib/schemas/api";

const KEY = "ak_secret_value";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function authHeader(call: unknown[]): string | null {
  const init = call[1] as RequestInit;
  return new Headers(init.headers).get("authorization");
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("presigns with a bearer header and parses the response", async () => {
    const fn = stubFetch(
      jsonResponse(200, { url: "http://minio/put", key: "uploads/o/u/a.png", expiresInSec: 900 }),
    );
    const file = new File([new Uint8Array(5)], "a.png", { type: "image/png" });
    const res = await presignUpload(KEY, file);
    expect(res.key).toBe("uploads/o/u/a.png");
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(url).toBe("/api/uploads/presign");
    expect(authHeader([url, init])).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      filename: "a.png",
      contentType: "image/png",
      sizeBytes: 5,
    });
  });

  it("never places the key in the URL or body", async () => {
    const fn = stubFetch(jsonResponse(202, { jobId: "j1" }));
    const body = {
      images: ["k"],
      mode: "grid",
      style: "justified",
      canvas: { w: 10, h: 10, gap: 12, bg: "#ffffff" },
      format: "png",
    } satisfies CreateCollageBody;
    expect(await createCollage(KEY, body)).toEqual({ jobId: "j1" });
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(String(url)).not.toContain(KEY);
    expect(String((init as RequestInit).body)).not.toContain(KEY);
  });

  it("maps the error envelope to ApiError without leaking the key", async () => {
    stubFetch(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Authentication required" } }),
    );
    const err = await fetchJob(KEY, "j1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(String((err as ApiError).message)).not.toContain(KEY);
  });

  it("falls back to a generic message for non-envelope failures", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await fetchJob(KEY, "j1").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502 });
    expect((err as ApiError).message).toBe("Request failed (502)");
  });

  it("encodes the job id in the path and parses the job", async () => {
    const fn = stubFetch(
      jsonResponse(200, {
        id: "a/b",
        type: "collage.build",
        status: "running",
        progress: 10,
        result: null,
        error: null,
      }),
    );
    const job = await fetchJob(KEY, "a/b");
    expect(job.status).toBe("running");
    expect(fn.mock.calls[0]?.[0]).toBe("/api/jobs/a%2Fb");
  });

  it("rejects malformed job payloads", async () => {
    stubFetch(jsonResponse(200, { id: "j1" }));
    await expect(fetchJob(KEY, "j1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("uploadFiles", () => {
  const files = [
    new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    new File([new Uint8Array(8)], "b.jpg", { type: "image/jpeg" }),
  ];

  it("uploads in order, reports per-file progress and returns keys", async () => {
    stubFetch(
      jsonResponse(200, { url: "http://minio/1", key: "k-a", expiresInSec: 900 }),
      jsonResponse(200, { url: "http://minio/2", key: "k-b", expiresInSec: 900 }),
    );
    const puts: string[] = [];
    const put = vi.fn(async (url: string, f: File, onProgress: (fraction: number) => void) => {
      puts.push(`${url}:${f.name}:${f.type}`);
      onProgress(0.5);
      onProgress(1);
    });
    const seen: number[][] = [];
    const keys = await uploadFiles(KEY, files, (p) => seen.push([...p]), put);
    expect(keys).toEqual(["k-a", "k-b"]);
    expect(puts).toEqual(["http://minio/1:a.png:image/png", "http://minio/2:b.jpg:image/jpeg"]);
    expect(seen.at(-1)).toEqual([100, 100]);
    expect(seen).toContainEqual([50, 0]);
  });

  it("does not forward the API key to the object store", async () => {
    stubFetch(jsonResponse(200, { url: "http://minio/1", key: "k-a", expiresInSec: 900 }));
    const put = vi.fn(async (...args: unknown[]) => void args);
    await uploadFiles(KEY, files.slice(0, 1), () => {}, put);
    expect(JSON.stringify(put.mock.calls)).not.toContain(KEY);
  });

  it("stops at the first failed upload", async () => {
    const fn = stubFetch(
      jsonResponse(200, { url: "http://minio/1", key: "k-a", expiresInSec: 900 }),
      jsonResponse(200, { url: "http://minio/2", key: "k-b", expiresInSec: 900 }),
    );
    const put = vi.fn().mockRejectedValueOnce(new Error("Upload of a.png failed"));
    await expect(uploadFiles(KEY, files, () => {}, put)).rejects.toThrow("Upload of a.png failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("job polling", () => {
  it("recognises terminal statuses", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("polls until a terminal status, then stops", () => {
    expect(jobRefetchInterval(undefined)).toBe(JOB_POLL_INTERVAL_MS);
    expect(jobRefetchInterval({ status: "queued" })).toBe(JOB_POLL_INTERVAL_MS);
    expect(jobRefetchInterval({ status: "running" })).toBe(JOB_POLL_INTERVAL_MS);
    expect(jobRefetchInterval({ status: "succeeded" })).toBe(false);
    expect(jobRefetchInterval({ status: "failed" })).toBe(false);
    expect(jobRefetchInterval({ status: "cancelled" })).toBe(false);
  });
});

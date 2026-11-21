import type { z } from "zod";
import { CreateCollageResponse, PresignResponse, type CreateCollageBody } from "@/lib/schemas/api";
import { JobResponse } from "@/lib/schemas/job";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Reports the upload progress of one file as a fraction in 0..1. */
export type PutProgress = (fraction: number) => void;
export type PutObject = (url: string, file: File, onProgress: PutProgress) => Promise<void>;

async function errorFrom(res: Response): Promise<ApiError> {
  try {
    const body: unknown = await res.json();
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (typeof error?.message === "string" && error.message) {
      const code = typeof error.code === "string" ? error.code : undefined;
      return new ApiError(res.status, error.message, code);
    }
  } catch {
    // Non-JSON bodies (proxies, gateways) fall through to the generic message.
  }
  return new ApiError(res.status, `Request failed (${res.status})`);
}

async function request<T extends z.ZodType>(
  apiKey: string,
  path: string,
  schema: T,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<z.infer<T>> {
  const headers = new Headers({ authorization: `Bearer ${apiKey}` });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(path, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new ApiError(res.status, "Unexpected response from the server");
  return parsed.data;
}

export function presignUpload(apiKey: string, file: File): Promise<PresignResponse> {
  const body = { filename: file.name, contentType: file.type, sizeBytes: file.size };
  return request(apiKey, "/api/uploads/presign", PresignResponse, { method: "POST", body });
}

export function createCollage(apiKey: string, body: CreateCollageBody) {
  return request(apiKey, "/api/collages", CreateCollageResponse, { method: "POST", body });
}

export function fetchJob(apiKey: string, jobId: string): Promise<JobResponse> {
  return request(apiKey, `/api/jobs/${encodeURIComponent(jobId)}`, JobResponse);
}

/** XHR (not fetch) because only XHR reports upload progress. The API key is never sent here. */
export const putObject: PutObject = (url, file, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = () => reject(new Error(`Upload of ${file.name} failed`));
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        fail();
      }
    };
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.send(file);
  });

/**
 * Uploads files one at a time (bounded bandwidth and memory) and returns object keys in input
 * order. Per-file progress is reported as whole percents.
 */
export async function uploadFiles(
  apiKey: string,
  files: File[],
  onProgress: (percents: number[]) => void,
  put: PutObject = putObject,
): Promise<string[]> {
  const percents = files.map(() => 0);
  const keys: string[] = [];
  for (const [i, file] of files.entries()) {
    const { url, key } = await presignUpload(apiKey, file);
    await put(url, file, (fraction) => {
      percents[i] = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      onProgress([...percents]);
    });
    keys.push(key);
  }
  return keys;
}

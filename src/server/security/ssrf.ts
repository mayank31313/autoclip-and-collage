import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { AppError } from "@/server/http/errors";

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

export interface PublicDestination {
  url: URL;
  address: string;
}

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not an IP at all: fail closed
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Expands a valid IPv6 literal (`::` compression, dotted IPv4 tail) into eight 16-bit groups. */
function expandV6(ip: string): number[] {
  let text = ip.split("%")[0]; // drop zone id
  const tail = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [, head, a, b, c, d] = tail;
    text = `${head}${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`;
  }
  const [left, right] = text.split("::");
  const l = left ? left.split(":") : [];
  const r = right === undefined ? [] : right ? right.split(":") : [];
  const fill = right === undefined ? 0 : 8 - l.length - r.length;
  return [...l, ...Array<string>(fill).fill("0"), ...r].map((g) => parseInt(g, 16));
}

function embeddedV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return isPrivateV4(embeddedV4(g[6], g[7]));
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and IPv4-compatible
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (nat64) return isPrivateV4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g[1], g[2]));
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}
const blocked = (msg: string) => new AppError("SSRF_BLOCKED", 400, msg);

export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<URL> {
  return (await resolvePublicDestination(raw, resolve)).url;
}

export async function resolvePublicDestination(
  raw: string,
  resolve: Resolver = defaultResolver,
  signal?: AbortSignal,
): Promise<PublicDestination> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw blocked("Only http(s) URLs are allowed");
  if (url.username || url.password) throw blocked("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const resolved = isIP(host) ? Promise.resolve([host]) : resolve(host);
  const addresses = signal ? await withAbortSignal(resolved, signal) : await resolved;
  if (addresses.length === 0 || addresses.some(isPrivateIp))
    throw blocked("URL resolves to a non-public address");
  return { url, address: addresses[0] };
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}
export interface SafeFetchDeps {
  fetch?: (url: string | URL, init?: RequestInit, address?: string) => Promise<Response>;
  resolve: Resolver;
}

/**
 * Fetches a remote URL re-validating and pinning every redirect hop while capping size and time.
 */
export async function safeFetch(
  raw: string,
  opts: SafeFetchOptions,
  deps: SafeFetchDeps = { resolve: defaultResolver },
): Promise<Response> {
  let current = raw;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const destination = await resolvePublicDestination(current, deps.resolve, signal);
    const res = await (deps.fetch ?? fetchPinned)(
      destination.url,
      {
        redirect: "manual",
        signal,
      },
      destination.address,
    );
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await cancelBody(res);
      try {
        current = new URL(location, destination.url).toString();
      } catch {
        throw blocked("Invalid redirect URL");
      }
      continue;
    }
    return await capBody(res, opts.maxBytes);
  }
  throw blocked("Too many redirects");
}

function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function fetchPinned(
  target: string | URL,
  init: RequestInit = {},
  address?: string,
): Promise<Response> {
  if (!address) return Promise.reject(blocked("Missing validated destination address"));
  const url = target instanceof URL ? target : new URL(target);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(address);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method,
        headers: toNodeHeaders(init.headers),
        signal: init.signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        ...(url.protocol === "https:" && !isIP(host) ? { servername: host } : {}),
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = incoming.statusCode ?? 502;
        const body =
          status === 204 || status === 205 || status === 304
            ? null
            : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, headers }));
      },
    );
    req.on("error", reject);
    const body = init.body;
    if (typeof body === "string" || body instanceof Uint8Array) req.end(body);
    else if (body === null || body === undefined) req.end();
    else {
      req.destroy(new TypeError("Unsupported request body type"));
      reject(new TypeError("Unsupported request body type"));
    }
  });
}

function toNodeHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name] = value;
  });
  return result;
}

async function capBody(res: Response, maxBytes: number): Promise<Response> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await cancelBody(res);
    throw new AppError("PAYLOAD_TOO_LARGE", 413, "Remote file too large");
  }
  if (!res.body) return res;
  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes)
          controller.error(new AppError("PAYLOAD_TOO_LARGE", 413, "Remote file too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: res.status, headers: res.headers });
}

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Cleanup should not replace the request's primary error.
  }
}

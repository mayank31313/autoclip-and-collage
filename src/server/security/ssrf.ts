import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/server/http/errors";

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

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

function isPrivateV6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateV4(dotted[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

const blocked = (msg: string) => new AppError("SSRF_BLOCKED", 400, msg);

export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<URL> {
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
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateIp))
    throw blocked("URL resolves to a non-public address");
  return url;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}
export interface SafeFetchDeps {
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  resolve: Resolver;
}

/**
 * Fetches a remote URL re-validating every redirect hop and capping size and time.
 * TODO(milestone-5): pin the validated IP to defeat DNS rebinding between check and connect.
 */
export async function safeFetch(
  raw: string,
  opts: SafeFetchOptions,
  deps: SafeFetchDeps = { fetch: (u, i) => fetch(u, i), resolve: defaultResolver },
): Promise<Response> {
  let current = raw;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const url = await assertPublicUrl(current, deps.resolve);
    const res = await deps.fetch(url, { redirect: "manual", signal });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return capBody(res, opts.maxBytes);
  }
  throw blocked("Too many redirects");
}

function capBody(res: Response, maxBytes: number): Response {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Remote file too large");
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

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

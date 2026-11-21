import { describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl,
  isPrivateIp,
  resolvePublicDestination,
  safeFetch,
  type SafeFetchDeps,
} from "@/server/security/ssrf";

const publicResolver = async () => ["93.184.216.34"];

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:0:0:0",
    "0:0:0:0:0:ffff:7f00:1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::ffff:0a00:0001",
    "::7f00:1",
    "::127.0.0.1",
    "::808:808",
    "64:ff9b::7f00:1",
    "64:ff9b::127.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2002:c0a8:101::",
    "ff02::1",
    "ff00::",
    "2001::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "fc00::1",
    "febf::1",
  ])("blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "64:ff9b::808:808",
    "64:ff9b::8.8.8.8",
    "2002:808:808::1",
  ])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("allows public hosts", async () => {
    await expect(
      assertPublicUrl("https://example.com/a.mp4", publicResolver),
    ).resolves.toBeInstanceOf(URL);
  });
  it("blocks non-http schemes, credentials and private literals", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicResolver)).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    await expect(assertPublicUrl("http://u:p@example.com/", publicResolver)).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    await expect(assertPublicUrl("http://127.0.0.1/", publicResolver)).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    await expect(assertPublicUrl("http://[::1]/", publicResolver)).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });
  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(
      assertPublicUrl("http://evil.test/", async () => ["10.0.0.5"]),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("resolvePublicDestination", () => {
  it("applies the timeout while resolving a hostname", async () => {
    await expect(
      resolvePublicDestination(
        "https://example.com/",
        () => new Promise(() => undefined),
        AbortSignal.timeout(1),
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  }, 200);
});

describe("safeFetch", () => {
  const opts = { maxBytes: 10, timeoutMs: 1000, maxRedirects: 2 };
  it("follows a redirect and returns the body", async () => {
    const calls: string[] = [];
    const fetchImpl = async (u: string | URL) => {
      calls.push(String(u));
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/x" } })
        : new Response("hello");
    };
    const res = await safeFetch("https://example.com/a", opts, {
      fetch: fetchImpl,
      resolve: publicResolver,
    });
    expect(await res.text()).toBe("hello");
    expect(calls).toEqual(["https://example.com/a", "https://cdn.example.com/x"]);
  });
  it("passes the validated address to the transport without resolving the hostname again", async () => {
    let resolutions = 0;
    let pin: string | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit, address?: string) => {
      pin = address;
      return new Response("hello");
    });
    const resolve = async () => {
      resolutions += 1;
      return ["93.184.216.34"];
    };

    await safeFetch("https://example.com/a", opts, {
      fetch: fetchImpl as unknown as SafeFetchDeps["fetch"],
      resolve,
    });

    expect(resolutions).toBe(1);
    expect(pin).toBe("93.184.216.34");
  });
  it("resolves and pins every redirect destination independently", async () => {
    const addresses = ["93.184.216.34", "8.8.8.8"];
    const pins: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit, address?: string) => {
      pins.push(address);
      return pins.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/x" } })
        : new Response("hello");
    });
    let resolution = 0;
    const resolve = vi.fn(async () => [addresses[resolution++]]);

    await safeFetch("https://example.com/a", opts, {
      fetch: fetchImpl as unknown as SafeFetchDeps["fetch"],
      resolve,
    });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(pins).toEqual(addresses);
  });
  it("blocks a redirect to a private address", async () => {
    const fetchImpl = async () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("limits redirects", async () => {
    const fetchImpl = async () =>
      new Response(null, { status: 302, headers: { location: "https://example.com/loop" } });
    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("rejects malformed redirect destinations as blocked URLs", async () => {
    const fetchImpl = async () =>
      new Response(null, { status: 302, headers: { location: "http://[::1" } });
    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("cancels the redirect response body before following the location", async () => {
    const cancel = vi.fn();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1
        ? new Response(new ReadableStream({ cancel }), {
            status: 302,
            headers: { location: "https://cdn.example.com/file" },
          })
        : new Response("ok");
    };

    const response = await safeFetch("https://example.com/a", opts, {
      fetch: fetchImpl,
      resolve: publicResolver,
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("ok");
  });
  it("rejects oversized bodies by content-length", async () => {
    const fetchImpl = async () => new Response("x", { headers: { "content-length": "999" } });
    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("cancels the body when the declared size is too large", async () => {
    const cancel = vi.fn();
    const fetchImpl = async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-length": "999" },
      });

    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("applies the timeout while resolving the destination", async () => {
    await expect(
      safeFetch(
        "https://example.com/a",
        { ...opts, timeoutMs: 1 },
        { fetch: async () => new Response("unused"), resolve: () => new Promise(() => undefined) },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
  it("errors the stream when the body exceeds maxBytes", async () => {
    const fetchImpl = async () => new Response("this body is far longer than ten bytes");
    const res = await safeFetch("https://example.com/a", opts, {
      fetch: fetchImpl,
      resolve: publicResolver,
    });
    await expect(res.text()).rejects.toBeDefined();
  });
});

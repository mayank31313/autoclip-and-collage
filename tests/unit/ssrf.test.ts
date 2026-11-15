import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp, safeFetch } from "@/server/security/ssrf";

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
  it("rejects oversized bodies by content-length", async () => {
    const fetchImpl = async () => new Response("x", { headers: { "content-length": "999" } });
    await expect(
      safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
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

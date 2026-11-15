import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/server/security/hmac";

const secret = "s".repeat(32);
const body = JSON.stringify({ eventId: "e1" });

describe("hmac", () => {
  it("signs with sha256= prefix and verifies", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(
      verifySignature({
        secret,
        body,
        signature: sig,
        timestamp: 1000,
        toleranceSec: 300,
        nowSec: 1100,
      }),
    ).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(
      verifySignature({
        secret,
        body: body + " ",
        signature: sig,
        timestamp: 1000,
        toleranceSec: 300,
        nowSec: 1000,
      }),
    ).toBe(false);
  });
  it("rejects stale timestamps", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(
      verifySignature({
        secret,
        body,
        signature: sig,
        timestamp: 1000,
        toleranceSec: 300,
        nowSec: 2000,
      }),
    ).toBe(false);
  });
  it("fails closed on a NaN timestamp even with a matching signature", () => {
    const sig = signPayload({ secret, body, timestamp: NaN });
    expect(
      verifySignature({
        secret,
        body,
        signature: sig,
        timestamp: NaN,
        toleranceSec: 300,
        nowSec: 1000,
      }),
    ).toBe(false);
  });
  it("fails closed on a NaN tolerance", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(
      verifySignature({
        secret,
        body,
        signature: sig,
        timestamp: 1000,
        toleranceSec: NaN,
        nowSec: 1000,
      }),
    ).toBe(false);
  });
  it("rejects malformed signatures without throwing", () => {
    expect(
      verifySignature({
        secret,
        body,
        signature: "nope",
        timestamp: 1000,
        toleranceSec: 300,
        nowSec: 1000,
      }),
    ).toBe(false);
  });
});

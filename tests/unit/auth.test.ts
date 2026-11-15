import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, parseBearer } from "@/server/security/auth";

describe("auth helpers", () => {
  it("generates unique prefixed keys", () => {
    const a = generateApiKey();
    expect(a).toMatch(/^ak_[A-Za-z0-9_-]{40,}$/);
    expect(generateApiKey()).not.toBe(a);
  });
  it("hashes deterministically and depends on the pepper", () => {
    expect(hashApiKey("k", "pepper-pepper-pepper")).toBe(hashApiKey("k", "pepper-pepper-pepper"));
    expect(hashApiKey("k", "pepper-pepper-pepper")).not.toBe(hashApiKey("k", "other-pepper-other"));
  });
  it("parses bearer headers", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});

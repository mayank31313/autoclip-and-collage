import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/server/security/auth";

const mocks = vi.hoisted(() => ({
  config: { apiKeyPepper: "p".repeat(16), studioApiKey: undefined as string | undefined },
  findActiveByHash: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig: () => mocks.config }));
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));

const { authenticateApiKey } = await import("@/server/security/principal");
const principal = { id: "owner-1", name: "studio" };

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/collages", { method: "POST", headers });
}

beforeEach(() => {
  mocks.config.studioApiKey = undefined;
  mocks.findActiveByHash.mockReset().mockResolvedValue(principal);
});

describe("authenticateApiKey", () => {
  it("uses the bearer key when one is sent", async () => {
    mocks.config.studioApiKey = "ak_studio";
    await expect(authenticateApiKey(request({ authorization: "Bearer ak_user" }))).resolves.toBe(
      principal,
    );
    expect(mocks.findActiveByHash).toHaveBeenCalledWith(hashApiKey("ak_user", "p".repeat(16)));
  });

  it("falls back to the studio key for same-origin browser requests without a key", async () => {
    mocks.config.studioApiKey = "ak_studio";
    await expect(authenticateApiKey(request({ "sec-fetch-site": "same-origin" }))).resolves.toBe(
      principal,
    );
    expect(mocks.findActiveByHash).toHaveBeenCalledWith(hashApiKey("ak_studio", "p".repeat(16)));
  });

  it("never uses the studio key for cross-site or header-less requests", async () => {
    mocks.config.studioApiKey = "ak_studio";
    const cases: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      {},
    ];
    for (const headers of cases) {
      await expect(authenticateApiKey(request(headers))).rejects.toMatchObject({ status: 401 });
    }
    expect(mocks.findActiveByHash).not.toHaveBeenCalled();
  });

  it("requires a key when no studio key is configured", async () => {
    await expect(
      authenticateApiKey(request({ "sec-fetch-site": "same-origin" })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("does not fall back when a malformed authorization header is sent", async () => {
    mocks.config.studioApiKey = "ak_studio";
    const req = request({ authorization: "Basic abc", "sec-fetch-site": "same-origin" });
    await expect(authenticateApiKey(req)).rejects.toMatchObject({ status: 401 });
  });
});

import { describe, expect, it } from "vitest";

describe("tooling", () => {
  it("runs vitest with the @ alias", async () => {
    const mod = await import("@/lib/utils/cn");
    expect(typeof mod.cn).toBe("function");
  });
});

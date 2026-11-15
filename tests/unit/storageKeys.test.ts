import { describe, expect, it } from "vitest";
import { buildUploadKey, sanitizeFilename } from "@/server/storage/keys";

describe("storage keys", () => {
  it("strips path separators and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/pass wd?.mp4")).toBe("pass_wd_.mp4");
  });
  it("falls back for empty names and caps length", () => {
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("a".repeat(500) + ".mp4").length).toBeLessThanOrEqual(120);
  });
  it("builds namespaced keys", () => {
    expect(buildUploadKey({ ownerId: "o", uploadId: "u", filename: "a b.png" })).toBe(
      "uploads/o/u/a_b.png",
    );
  });
});

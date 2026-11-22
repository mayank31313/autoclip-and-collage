import { describe, expect, it } from "vitest";
import { ALLOWED_UPLOAD_TYPES, CreateCollageBody } from "@/lib/schemas/api";

describe("slideshow API", () => {
  it("allows video upload MIME types", () => {
    expect(ALLOWED_UPLOAD_TYPES).toContain("video/mp4");
  });

  it("accepts a mixed slideshow body", () => {
    expect(
      CreateCollageBody.safeParse({
        mode: "slideshow",
        sources: [
          { key: "uploads/owner/a.jpg", kind: "image", durationSec: 3, fit: "cover" },
          { key: "uploads/owner/b.mp4", kind: "video", startSec: 1, endSec: 4, fit: "contain" },
        ],
        slideshow: { canvas: "9:16", fps: 30, transition: "fade", transitionSec: 0.5 },
        format: "mp4",
      }).success,
    ).toBe(true);
  });
});
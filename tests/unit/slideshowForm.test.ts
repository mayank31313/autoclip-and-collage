import { describe, expect, it } from "vitest";
import { buildSlideshowBody } from "@/features/collage/slideshowForm";

describe("slideshow form", () => {
  it("builds mixed source entries", () => {
    expect(
      buildSlideshowBody(
        {
          canvas: "1:1",
          fps: 30,
          transition: "fade",
          transitionSec: 0.5,
          sources: [
            { kind: "image", durationSec: 3, fit: "cover" },
            { kind: "video", startSec: 1, endSec: 5, fit: "contain" },
          ],
        },
        ["a", "b"],
      ),
    ).toEqual({
      mode: "slideshow",
      sources: [
        { key: "a", kind: "image", durationSec: 3, fit: "cover" },
        { key: "b", kind: "video", startSec: 1, endSec: 5, fit: "contain" },
      ],
      slideshow: { canvas: "1:1", fps: 30, transition: "fade", transitionSec: 0.5 },
      format: "mp4",
    });
  });
});

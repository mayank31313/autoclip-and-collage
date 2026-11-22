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

  it("normalizes a stale non-zero transitionSec to 0 when transition is cut", () => {
    const body = buildSlideshowBody(
      {
        canvas: "16:9",
        fps: 24,
        transition: "cut",
        // Simulates a value left over from switching away from fade/wipe without the UI
        // having reset it yet; the builder must not forward this to Zod as-is.
        transitionSec: 0.5,
        sources: [{ kind: "image", durationSec: 3, fit: "cover" }],
      },
      ["a"],
    );
    if (body.mode !== "slideshow") throw new Error("expected slideshow body");
    expect(body.slideshow.transitionSec).toBe(0);
  });

  it("does not throw a raw Zod error for a stale cut transitionSec", () => {
    expect(() =>
      buildSlideshowBody(
        {
          canvas: "16:9",
          fps: 24,
          transition: "cut",
          transitionSec: 2,
          sources: [{ kind: "image", durationSec: 3, fit: "cover" }],
        },
        ["a"],
      ),
    ).not.toThrow();
  });
});

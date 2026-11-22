import { describe, expect, it } from "vitest";
import {
  SLIDESHOW_JOB_TYPE,
  SlideshowJobResult,
  SlideshowOptions,
  SlideshowSourceSchema,
  SlideshowSpec,
  SlideshowWorkerInput,
} from "@/lib/schemas/slideshow";
import { validateSlideshowSpec } from "@/lib/planner/slideshow/validate";
import { SLIDESHOW_CANVAS_SIZE } from "@/lib/planner/slideshow/defaults";

describe("slideshow schemas", () => {
  it("requires positive image duration", () => {
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.jpg",
        kind: "image",
        durationSec: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts a valid video trim", () => {
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.mp4",
        kind: "video",
        startSec: 2,
        endSec: 7,
        fit: "cover",
      }).success,
    ).toBe(true);
  });

  it("rejects cut with a non-zero transition", () => {
    expect(
      SlideshowOptions.safeParse({
        canvas: "16:9",
        fps: 30,
        transition: "cut",
        transitionSec: 1,
      }).success,
    ).toBe(false);
  });

  it("uses the slideshow job type", () => {
    expect(SLIDESHOW_JOB_TYPE).toBe("collage.slideshow");
  });

  it("rejects duplicate source asset IDs in worker input", () => {
    expect(
      SlideshowWorkerInput.safeParse({
        sources: [
          { assetId: "a", kind: "image", durationSec: 3, startSec: 0, endSec: 3, fit: "cover" },
          { assetId: "a", kind: "video", durationSec: 4, startSec: 0, endSec: 4, fit: "contain" },
        ],
        slideshow: {
          canvas: "16:9",
          fps: 30,
          transition: "cut",
          transitionSec: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("exports a parseable spec shape", () => {
    const spec = SlideshowSpec.parse({
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 3,
    });
    expect(spec.slides).toHaveLength(1);
  });

  it("validates spec with validateSlideshowSpec and detects errors", () => {
    const validSpec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 3,
    };
    expect(validateSlideshowSpec(validSpec)).toHaveLength(0);

    const invalidSpec: SlideshowSpec = {
      ...validSpec,
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 3,
          endSec: 1,
          durationSec: 3,
          fit: "cover",
        },
        {
          id: 1,
          assetId: "a",
          kind: "video",
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          fit: "cover",
        },
      ],
      transition: { type: "cut", durationSec: 1 },
    };
    const issues = validateSlideshowSpec(invalidSpec);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.message)).toContain("asset used more than once");
    expect(issues.map((i) => i.message)).toContain("endSec must follow startSec");
    expect(issues.map((i) => i.message)).toContain("cut requires zero transition");
  });

  it("validates SlideshowJobResult schema", () => {
    const parsed = SlideshowJobResult.safeParse({
      output: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationSec: 10,
        format: "mp4",
        masterUrl: "https://example.com/master.mp4",
        zipUrl: "https://example.com/slideshow.zip",
        slides: [{ index: 0, durationSec: 10, url: "https://example.com/slide-0.mp4" }],
        expiresInSec: 300,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("exports canvas sizes", () => {
    expect(SLIDESHOW_CANVAS_SIZE["16:9"]).toEqual({ w: 1920, h: 1080 });
    expect(SLIDESHOW_CANVAS_SIZE["9:16"]).toEqual({ w: 1080, h: 1920 });
    expect(SLIDESHOW_CANVAS_SIZE["1:1"]).toEqual({ w: 1080, h: 1080 });
  });

  it("rejects a slide exceeding SLIDESHOW_MAX_SLIDE_SEC", () => {
    const spec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 1000,
          durationSec: 1000,
          fit: "cover",
        },
      ],
      masterDurationSec: 1000,
    };
    expect(SlideshowSpec.safeParse(spec).success).toBe(false);
    expect(validateSlideshowSpec(spec as SlideshowSpec).map((i) => i.message)).toContain(
      "durationSec must not exceed 30s",
    );
  });

  it("rejects a masterDurationSec exceeding SLIDESHOW_MAX_DURATION_SEC", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 5000,
    };
    expect(SlideshowSpec.safeParse(spec).success).toBe(false);
    expect(validateSlideshowSpec(spec).map((i) => i.message)).toContain(
      "masterDurationSec must not exceed 300s",
    );
  });

  it("rejects a transition exceeding SLIDESHOW_MAX_TRANSITION_SEC", () => {
    const spec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "fade", durationSec: 10 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 3,
    };
    expect(SlideshowSpec.safeParse(spec).success).toBe(false);
    expect(validateSlideshowSpec(spec as SlideshowSpec).map((i) => i.message)).toContain(
      "transition durationSec must not exceed 2s",
    );
  });

  it("rejects a slide whose durationSec disagrees with endSec minus startSec", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "video",
          startSec: 2,
          endSec: 7,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 5,
    };
    expect(SlideshowSpec.safeParse(spec).success).toBe(false);
    expect(validateSlideshowSpec(spec).map((i) => i.message)).toContain(
      "durationSec must equal endSec minus startSec",
    );
  });

  it("accepts an epsilon-safe durationSec match", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "video",
          startSec: 2,
          endSec: 7.0000001,
          durationSec: 5,
          fit: "cover",
        },
      ],
      masterDurationSec: 5,
    };
    expect(validateSlideshowSpec(spec)).toHaveLength(0);
  });
});

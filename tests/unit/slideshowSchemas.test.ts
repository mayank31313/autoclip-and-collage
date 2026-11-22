import { describe, expect, it } from "vitest";
import {
  SLIDESHOW_JOB_TYPE,
  SlideshowJobResult,
  SlideshowOptions,
  SlideshowSourceSchema,
  SlideshowSpec,
  SlideshowWorkerInput,
  SlideshowWorkerResult,
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

  it("rejects fade/wipe with a zero transition", () => {
    expect(
      SlideshowOptions.safeParse({
        canvas: "16:9",
        fps: 30,
        transition: "fade",
        transitionSec: 0,
      }).success,
    ).toBe(false);
    expect(
      SlideshowOptions.safeParse({
        canvas: "16:9",
        fps: 30,
        transition: "wipe",
        transitionSec: 0,
      }).success,
    ).toBe(false);
  });

  it("requires an image durationSec of at least 1 second", () => {
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.jpg",
        kind: "image",
        durationSec: 0.5,
      }).success,
    ).toBe(false);
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.jpg",
        kind: "image",
        durationSec: 1,
      }).success,
    ).toBe(true);
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

  it("rejects a fade/wipe transition not shorter than every slide's duration", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "fade", durationSec: 2 },
      slides: [
        { id: 0, assetId: "a", kind: "image", startSec: 0, endSec: 2, durationSec: 2, fit: "cover" },
        { id: 1, assetId: "b", kind: "image", startSec: 0, endSec: 5, durationSec: 5, fit: "cover" },
      ],
      masterDurationSec: 5,
    };
    const issues = validateSlideshowSpec(spec);
    expect(issues.map((i) => i.message)).toContain(
      "transition duration must be less than slide 0's duration",
    );
  });

  it("rejects a middle slide whose duration is less than twice the transition", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "wipe", durationSec: 2 },
      slides: [
        { id: 0, assetId: "a", kind: "image", startSec: 0, endSec: 10, durationSec: 10, fit: "cover" },
        { id: 1, assetId: "b", kind: "image", startSec: 0, endSec: 3, durationSec: 3, fit: "cover" },
        { id: 2, assetId: "c", kind: "image", startSec: 0, endSec: 10, durationSec: 10, fit: "cover" },
      ],
      masterDurationSec: 19,
    };
    const issues = validateSlideshowSpec(spec);
    expect(issues.map((i) => i.message)).toContain(
      "transition duration must not exceed half of slide 1's duration",
    );
  });

  it("accepts a fade transition within half of every middle slide's duration", () => {
    const spec: SlideshowSpec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "fade", durationSec: 1 },
      slides: [
        { id: 0, assetId: "a", kind: "image", startSec: 0, endSec: 3, durationSec: 3, fit: "cover" },
        { id: 1, assetId: "b", kind: "image", startSec: 0, endSec: 3, durationSec: 3, fit: "cover" },
        { id: 2, assetId: "c", kind: "image", startSec: 0, endSec: 3, durationSec: 3, fit: "cover" },
      ],
      masterDurationSec: 7,
    };
    expect(validateSlideshowSpec(spec)).toHaveLength(0);
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

  it("does not enforce a slide duration upper bound in the pure spec/validator", () => {
    // Runtime upper bounds come from server Config and are enforced in the API route
    // (src/app/api/collages/route.ts), not in the isomorphic schema/planner.
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
    expect(SlideshowSpec.safeParse(spec).success).toBe(true);
    expect(validateSlideshowSpec(spec as SlideshowSpec)).toHaveLength(0);
  });

  it("does not enforce a masterDurationSec upper bound in the pure spec/validator", () => {
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
    expect(SlideshowSpec.safeParse(spec).success).toBe(true);
    expect(validateSlideshowSpec(spec)).toHaveLength(0);
  });

  it("does not enforce a transition duration upper bound in the pure spec/validator", () => {
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
    expect(SlideshowSpec.safeParse(spec).success).toBe(true);
    expect(validateSlideshowSpec(spec as SlideshowSpec)).toHaveLength(0);
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

  it("accepts a SlideshowSpec with more than 20 slides (no fixed cap downstream)", () => {
    const slides = Array.from({ length: 21 }, (_, i) => ({
      id: i,
      assetId: `asset-${i}`,
      kind: "image" as const,
      startSec: 0,
      endSec: 2,
      durationSec: 2,
      fit: "cover" as const,
    }));
    const spec = {
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides,
      masterDurationSec: 42,
    };
    const parsed = SlideshowSpec.safeParse(spec);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.slides).toHaveLength(21);
    }
  });

  it("accepts a SlideshowWorkerInput with 21 sources (no fixed cap downstream)", () => {
    const sources = Array.from({ length: 21 }, (_, i) => ({
      assetId: `asset-${i}`,
      kind: "image" as const,
      durationSec: 2,
      startSec: 0,
      endSec: 2,
      fit: "cover" as const,
    }));
    const parsed = SlideshowWorkerInput.safeParse({
      sources,
      slideshow: { canvas: "16:9", fps: 30, transition: "cut", transitionSec: 0 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sources).toHaveLength(21);
    }
  });

  it("accepts a SlideshowWorkerResult with 21 slideAssetIds (no fixed cap downstream)", () => {
    const slideAssetIds = Array.from({ length: 21 }, (_, i) => `slide-asset-${i}`);
    const parsed = SlideshowWorkerResult.safeParse({
      masterAssetId: "master-asset",
      zipAssetId: "zip-asset",
      slideAssetIds,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 42,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.slideAssetIds).toHaveLength(21);
    }
  });

  it("accepts a SlideshowJobResult with 21 slides in output.slides (no fixed cap downstream)", () => {
    const slides = Array.from({ length: 21 }, (_, i) => ({
      index: i,
      durationSec: 2,
      url: `https://example.com/slide-${i}.mp4`,
    }));
    const parsed = SlideshowJobResult.safeParse({
      output: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationSec: 42,
        format: "mp4",
        masterUrl: "https://example.com/master.mp4",
        zipUrl: "https://example.com/slideshow.zip",
        slides,
        expiresInSec: 300,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.output.slides).toHaveLength(21);
    }
  });
});
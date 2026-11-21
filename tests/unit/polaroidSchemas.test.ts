import { describe, expect, it } from "vitest";
import { resolvePolaroidOptions } from "@/lib/planner/collage/polaroid/options";
import { CreateCollageBody, PolaroidJobResult } from "@/lib/schemas/api";
import { PolaroidWorkerInput, PolaroidWorkerResult } from "@/lib/schemas/polaroid";

const keys = (count: number) =>
  Array.from({ length: count }, (_, i) => `uploads/owner/u1/${i}.png`);
const polaroidBody = (
  count: number,
  polaroid: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  images: keys(count),
  mode: "polaroid",
  polaroid: { slideAspect: "4:5", ...polaroid },
  ...extra,
});
const parses = (value: unknown) => CreateCollageBody.safeParse(value).success;

describe("CreateCollageBody (polaroid)", () => {
  it("accepts a minimal body and defaults the format", () => {
    expect(CreateCollageBody.parse(polaroidBody(4))).toMatchObject({
      mode: "polaroid",
      format: "png",
      polaroid: { slideAspect: "4:5" },
    });
  });

  it("keeps routing grid bodies and rejects unknown modes", () => {
    const grid = { images: keys(1), mode: "grid", style: "justified", canvas: { w: 100, h: 100 } };
    expect(parses(grid)).toBe(true);
    expect(parses({ ...polaroidBody(4), mode: "sequence" })).toBe(false);
    expect(parses({ images: keys(4), mode: "polaroid" })).toBe(false);
  });

  it("limits slides to 2..10", () => {
    expect(parses(polaroidBody(6, { slides: 1 }))).toBe(false);
    expect(parses(polaroidBody(20, { slides: 11 }))).toBe(false);
    expect(parses(polaroidBody(20, { slides: 10 }))).toBe(true);
  });

  it("needs at least one image per slide, defaulting to about three per slide", () => {
    expect(parses(polaroidBody(1))).toBe(false);
    expect(parses(polaroidBody(2))).toBe(true);
    expect(parses(polaroidBody(2, { slides: 3 }))).toBe(false);
  });

  it("holds at most six images per slide", () => {
    expect(parses(polaroidBody(12, { slides: 2 }))).toBe(true);
    expect(parses(polaroidBody(13, { slides: 2 }))).toBe(false);
  });

  it("takes one caption of at most 60 characters per image", () => {
    const captions = (n: number, len = 5) => Array.from({ length: n }, () => "x".repeat(len));
    expect(parses(polaroidBody(4, { captions: captions(4) }))).toBe(true);
    expect(parses(polaroidBody(4, { captions: captions(3) }))).toBe(false);
    expect(parses(polaroidBody(4, { captions: captions(4, 60) }))).toBe(true);
    expect(parses(polaroidBody(4, { captions: captions(4, 61) }))).toBe(false);
  });

  it("rejects duplicate keys, HEIC, an unknown aspect and a non-http webhook", () => {
    const [first] = keys(1);
    expect(parses({ ...polaroidBody(2), images: [first, first] })).toBe(false);
    expect(
      parses({ ...polaroidBody(2), images: ["uploads/o/u/a.heic", "uploads/o/u/b.png"] }),
    ).toBe(false);
    expect(parses(polaroidBody(4, { slideAspect: "16:9" }))).toBe(false);
    expect(parses(polaroidBody(4, {}, { webhookUrl: "ftp://example.com/x" }))).toBe(false);
    expect(parses(polaroidBody(4, {}, { webhookUrl: "https://example.com/x" }))).toBe(true);
  });
});

describe("resolvePolaroidOptions", () => {
  it("fills the slide count and blank captions", () => {
    expect(resolvePolaroidOptions({ slideAspect: "1:1" }, 7)).toEqual({
      slides: 3,
      slideAspect: "1:1",
      captions: Array.from({ length: 7 }, () => ""),
    });
  });

  it("keeps explicit slides and trims captions", () => {
    expect(
      resolvePolaroidOptions({ slides: 2, slideAspect: "4:5", captions: [" Hi ", ""] }, 2),
    ).toEqual({ slides: 2, slideAspect: "4:5", captions: ["Hi", ""] });
  });
});

describe("PolaroidWorkerInput", () => {
  const input = {
    sourceAssetIds: ["a", "b", "c"],
    slides: 2,
    slideAspect: "4:5",
    captions: ["", "", ""],
    format: "png",
  };

  it("accepts resolved input", () => {
    expect(PolaroidWorkerInput.safeParse(input).success).toBe(true);
  });

  it("rejects mismatched captions, duplicate ids and impossible slide counts", () => {
    expect(PolaroidWorkerInput.safeParse({ ...input, captions: ["", ""] }).success).toBe(false);
    expect(
      PolaroidWorkerInput.safeParse({ ...input, sourceAssetIds: ["a", "a", "c"] }).success,
    ).toBe(false);
    expect(PolaroidWorkerInput.safeParse({ ...input, slides: 4 }).success).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => `id${i}`);
    const crowded = { ...input, sourceAssetIds: many, captions: many.map(() => "") };
    expect(PolaroidWorkerInput.safeParse(crowded).success).toBe(false);
  });
});

describe("polaroid results", () => {
  it("parses the internal result and needs at least two slides", () => {
    const result = {
      zipAssetId: "z",
      slideAssetIds: ["s1", "s2"],
      slideWidth: 1080,
      slideHeight: 1350,
      format: "png",
    };
    expect(PolaroidWorkerResult.safeParse(result).success).toBe(true);
    expect(PolaroidWorkerResult.safeParse({ ...result, slideAssetIds: ["s1"] }).success).toBe(
      false,
    );
  });

  it("parses the public result and requires http(s) URLs", () => {
    const output = {
      slideCount: 2,
      slideWidth: 1080,
      slideHeight: 1350,
      slideFormat: "png",
      zipUrl: "https://minio.example/z.zip",
      slides: [
        { index: 0, url: "https://minio.example/1.png" },
        { index: 1, url: "https://minio.example/2.png" },
      ],
      expiresInSec: 900,
    };
    expect(PolaroidJobResult.safeParse({ output }).success).toBe(true);
    expect(
      PolaroidJobResult.safeParse({ output: { ...output, zipUrl: "javascript:x" } }).success,
    ).toBe(false);
  });
});

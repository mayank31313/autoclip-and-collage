import { describe, expect, it } from "vitest";
import {
  COLLAGE_FORM_DEFAULTS,
  buildCreateBody,
  createCollageFormSchema,
  type CollageFormValues,
} from "@/features/collage/form";
import { effectiveSlides } from "@/features/collage/polaroidForm";
import type { CollageLimits } from "@/features/collage/limits";

const MB = 1024 * 1024;
const limits: CollageLimits = {
  maxImages: 20,
  maxImageUploadBytes: 2 * MB,
  maxCanvasPixels: 4_000_000,
  maxCanvasDimension: 3000,
};
const schema = createCollageFormSchema(limits, []);

const file = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
const values = (count: number, overrides: Partial<CollageFormValues> = {}): CollageFormValues => ({
  ...COLLAGE_FORM_DEFAULTS,
  mode: "polaroid",
  files: Array.from({ length: count }, (_, i) => file(`${i}.png`)),
  captions: Array.from({ length: count }, () => ""),
  ...overrides,
});
const issues = (v: CollageFormValues) => {
  const result = schema.safeParse(v);
  return result.success
    ? []
    : result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
};

describe("polaroid form validation", () => {
  it("accepts auto slides and ignores canvas and template fields", () => {
    expect(issues(values(4))).toEqual([]);
    expect(issues(values(4, { preset: "custom", width: Number.NaN, style: "template" }))).toEqual(
      [],
    );
  });

  it("ignores polaroid fields in grid mode", () => {
    const grid = { ...values(1), mode: "grid" as const, slides: 99 };
    expect(issues(grid)).toEqual([]);
  });

  it("limits slides to whole numbers from 2 to 10", () => {
    for (const slides of [1, 11, 2.5]) {
      expect(issues(values(12, { slides }))).toEqual([
        { path: "slides", message: "Choose 2 to 10 slides" },
      ]);
    }
    expect(issues(values(12, { slides: 10 }))).toEqual([]);
  });

  it("needs at least one image per slide, including the automatic count", () => {
    expect(issues(values(1))[0]).toEqual({
      path: "slides",
      message: "2 slides need at least 2 images",
    });
    expect(issues(values(3, { slides: 4 }))[0]?.message).toBe("4 slides need at least 4 images");
    expect(issues(values(13, { slides: 2 }))[0]?.message).toBe("2 slides hold at most 12 images");
  });

  it("limits each caption to 60 characters", () => {
    const captions = ["", "x".repeat(61), "", ""];
    expect(issues(values(4, { captions }))).toEqual([
      { path: "captions.1", message: "Captions can be up to 60 characters" },
    ]);
  });
});

describe("effectiveSlides", () => {
  it("uses the automatic count only for an empty field", () => {
    expect(effectiveSlides(Number.NaN, 7)).toBe(3);
    expect(effectiveSlides(5, 7)).toBe(5);
  });
});

describe("buildCreateBody (polaroid)", () => {
  const keys = ["k0", "k1", "k2", "k3"];

  it("sends auto slides as omitted and trims captions", () => {
    const body = buildCreateBody(values(4, { captions: [" Hi ", "", "", ""] }), keys);
    expect(body).toEqual({
      images: keys,
      mode: "polaroid",
      polaroid: { slideAspect: "4:5", captions: ["Hi", "", "", ""] },
      format: "png",
    });
  });

  it("omits captions when all are blank and keeps an explicit slide count, aspect and format", () => {
    const body = buildCreateBody(
      values(4, { slides: 2, slideAspect: "1:1", format: "jpeg" }),
      keys,
    );
    expect(body).toEqual({
      images: keys,
      mode: "polaroid",
      polaroid: { slides: 2, slideAspect: "1:1" },
      format: "jpeg",
    });
  });
});

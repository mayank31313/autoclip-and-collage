import { describe, expect, it } from "vitest";
import {
  COLLAGE_FORM_DEFAULTS,
  buildCreateBody,
  compatibleTemplates,
  createCollageFormSchema,
  formatBytes,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageLimits } from "@/features/collage/limits";

const MB = 1024 * 1024;
const limits: CollageLimits = {
  maxImages: 3,
  maxImageUploadBytes: 2 * MB,
  maxCanvasPixels: 4_000_000,
  maxCanvasDimension: 3000,
};
const schema = createCollageFormSchema(limits);

function file(name: string, type = "image/png", size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

function values(overrides: Partial<CollageFormValues> = {}): CollageFormValues {
  return { ...COLLAGE_FORM_DEFAULTS, files: [file("a.png")], ...overrides };
}

function issues(input: CollageFormValues): { path: string; message: string }[] {
  const r = schema.safeParse(input);
  return r.success
    ? []
    : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

describe("collage form defaults", () => {
  it("defaults to justified rows, PNG and a square preset", () => {
    expect(COLLAGE_FORM_DEFAULTS).toMatchObject({
      style: "justified",
      preset: "square",
      format: "png",
    });
    expect(issues(values())).toEqual([]);
  });
});

describe("file validation", () => {
  it("requires at least one image", () => {
    expect(issues(values({ files: [] }))[0]).toMatchObject({ path: "files" });
  });

  it("enforces the configured image count", () => {
    const files = [1, 2, 3, 4].map((n) => file(`${n}.png`));
    expect(issues(values({ files }))[0]?.message).toBe("Select at most 3 images");
  });

  it("rejects oversized files by configured bytes", () => {
    const r = issues(values({ files: [file("big.png", "image/png", 2 * MB + 1)] }));
    expect(r[0]).toMatchObject({ path: "files.0" });
    expect(r[0]?.message).toContain("2 MB");
  });

  it("rejects HEIC and non-image types", () => {
    expect(issues(values({ files: [file("a.heic", "image/heic")] }))[0]?.message).toContain("HEIC");
    expect(issues(values({ files: [file("a.gif", "image/gif")] }))[0]?.message).toContain(
      "JPEG, PNG, or WebP",
    );
  });
});

describe("canvas validation", () => {
  it("accepts custom dimensions within limits", () => {
    expect(issues(values({ preset: "custom", width: 2000, height: 1500 }))).toEqual([]);
  });

  it("rejects custom sides over the maximum dimension", () => {
    const r = issues(values({ preset: "custom", width: 3001, height: 100 }));
    expect(r[0]).toMatchObject({ path: "width" });
  });

  it("rejects custom canvases over the pixel budget", () => {
    const r = issues(values({ preset: "custom", width: 3000, height: 2000 }));
    expect(r[0]).toMatchObject({ path: "width" });
  });

  it("rejects non-integer or non-positive custom sizes", () => {
    expect(issues(values({ preset: "custom", width: 0, height: 100 })).length).toBeGreaterThan(0);
    expect(issues(values({ preset: "custom", width: 10.5, height: 100 })).length).toBeGreaterThan(
      0,
    );
    expect(issues(values({ preset: "custom", width: NaN, height: 100 })).length).toBeGreaterThan(0);
  });

  it("ignores stale custom sizes when a preset is selected", () => {
    expect(issues(values({ preset: "square", width: 99999, height: NaN }))).toEqual([]);
  });

  it("rejects presets that exceed configured limits", () => {
    const tight = createCollageFormSchema({ ...limits, maxCanvasDimension: 1000 });
    expect(tight.safeParse(values({ preset: "landscape" })).success).toBe(false);
  });
});

describe("template compatibility", () => {
  it("offers only templates matching the image count, plus rectangular", () => {
    expect(compatibleTemplates(4)).toEqual(["grid-2x2", "rectangular"]);
    expect(compatibleTemplates(5)).toEqual(["hero-4", "rectangular"]);
    expect(compatibleTemplates(9)).toEqual(["grid-3x3", "rectangular"]);
    expect(compatibleTemplates(7)).toEqual(["rectangular"]);
  });

  it("rejects a curated template with the wrong count", () => {
    const r = issues(values({ style: "template", template: "grid-2x2" }));
    expect(r[0]).toMatchObject({ path: "template" });
  });

  it("ignores the template value for justified style", () => {
    expect(issues(values({ style: "justified", template: "grid-3x3" }))).toEqual([]);
  });
});

describe("buildCreateBody", () => {
  it("builds a justified PNG request with server defaults", () => {
    expect(buildCreateBody(values(), ["k1"])).toEqual({
      images: ["k1"],
      mode: "grid",
      style: "justified",
      canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
      format: "png",
    });
  });

  it("includes the template only for template style and uses custom sizes", () => {
    const body = buildCreateBody(
      values({
        style: "template",
        template: "rectangular",
        preset: "custom",
        width: 800,
        height: 600,
        format: "jpeg",
      }),
      ["k1", "k2"],
    );
    expect(body).toMatchObject({
      style: "template",
      template: "rectangular",
      canvas: { w: 800, h: 600 },
      format: "jpeg",
    });
  });

  it("uses the preset's dimensions", () => {
    expect(buildCreateBody(values({ preset: "portrait" }), ["k1"]).canvas).toMatchObject({
      w: 1080,
      h: 1350,
    });
  });
});

describe("formatBytes", () => {
  it("formats megabytes", () => {
    expect(formatBytes(200 * MB)).toBe("200 MB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(512)).toBe("512 B");
  });
});

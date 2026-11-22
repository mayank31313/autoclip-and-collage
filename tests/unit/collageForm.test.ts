import { describe, expect, it } from "vitest";
import {
  COLLAGE_FORM_DEFAULTS,
  buildCreateBody,
  buildGridTemplate,
  compatibleTemplates,
  createCollageFormSchema,
  formatBytes,
  type CollageFormValues,
} from "@/features/collage/form";
import type { CollageLimits } from "@/features/collage/limits";
import { gridTemplate, heroFourTemplate } from "../fixtures/collageTemplates";

const MB = 1024 * 1024;
const limits: CollageLimits = {
  maxImages: 3,
  maxImageUploadBytes: 2 * MB,
  maxCanvasPixels: 4_000_000,
  maxCanvasDimension: 3000,
};
const templates = [gridTemplate(2, 2), heroFourTemplate];
const schema = createCollageFormSchema(limits, templates);

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
    const tight = createCollageFormSchema({ ...limits, maxCanvasDimension: 1000 }, templates);
    expect(tight.safeParse(values({ preset: "landscape" })).success).toBe(false);
  });
});

describe("template compatibility", () => {
  it("offers only templates matching the image count, plus rectangular", () => {
    expect(compatibleTemplates(templates, 4)).toEqual(["grid-2x2", "rectangular"]);
    expect(compatibleTemplates(templates, 5)).toEqual(["hero-4", "rectangular"]);
    expect(compatibleTemplates(templates, 7)).toEqual(["rectangular"]);
  });

  it("rejects a template with the wrong count", () => {
    const r = issues(values({ style: "template", template: "grid-2x2" }));
    expect(r[0]).toMatchObject({ path: "template", message: "grid-2x2 needs exactly 4 images" });
  });

  it("rejects unknown template ids", () => {
    expect(issues(values({ style: "template", template: "nope" }))[0]).toMatchObject({
      path: "template",
    });
  });

  it("ignores the template value for justified style", () => {
    expect(issues(values({ style: "justified", template: "grid-2x2" }))).toEqual([]);
  });
});

describe("custom templates", () => {
  const twoByOne = JSON.stringify(gridTemplate(2, 1, "custom"));
  const files = [file("a.png"), file("b.png")];

  it("accepts valid JSON whose cell count matches the images", () => {
    expect(issues(values({ style: "custom", customTemplate: twoByOne, files }))).toEqual([]);
  });

  it("reports malformed JSON, invalid templates and count mismatches on customTemplate", () => {
    const bad = (customTemplate: string, f = files) =>
      issues(values({ style: "custom", customTemplate, files: f }))[0];
    expect(bad("{ nope")).toMatchObject({ path: "customTemplate", message: "Enter valid JSON" });
    expect(bad(JSON.stringify({ ...gridTemplate(2, 1), cols: [] }))).toMatchObject({
      path: "customTemplate",
    });
    expect(bad(twoByOne, [file("a.png")])).toMatchObject({
      path: "customTemplate",
      message: "This layout needs exactly 2 images",
    });
  });

  it("ignores custom JSON for other styles", () => {
    expect(issues(values({ style: "justified", customTemplate: "{ nope" }))).toEqual([]);
  });

  it("builds equal grids with an optional 2x2 hero in the top-left", () => {
    expect(buildGridTemplate({ rows: 2, cols: 3, hero: false }).cells).toHaveLength(6);
    const hero = buildGridTemplate({ rows: 3, cols: 3, hero: true });
    expect(hero.cells[0]).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 2, hero: true });
    expect(hero.cells).toHaveLength(6);
    expect(buildGridTemplate({ rows: 1, cols: 3, hero: true }).cells.some((c) => c.hero)).toBe(
      false,
    );
  });
});

describe("buildCreateBody", () => {
  it("submits a photo wall without carrying over the selected grid template", () => {
    const body = buildCreateBody(
      values({ style: "photo-wall", template: "rectangular", photoWallPreset: "midnight" }),
      ["k1"],
    );
    expect(body).toMatchObject({ mode: "grid", style: "photo-wall", photoWallPreset: "midnight" });
    expect(body).not.toHaveProperty("template");
  });

  it("builds a justified PNG request with server defaults", () => {
    expect(buildCreateBody(values(), ["k1"])).toEqual({
      images: ["k1"],
      mode: "grid",
      style: "justified",
      canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
      format: "png",
    });
  });

  it("sends a custom layout as an inline template definition", () => {
    const customTemplate = gridTemplate(2, 1, "custom");
    const body = buildCreateBody(
      values({ style: "custom", customTemplate: JSON.stringify(customTemplate) }),
      ["k1", "k2"],
    );
    expect(body).toMatchObject({ style: "template", customTemplate });
    if (body.mode !== "grid") throw new Error("expected grid body");
    expect(body.template).toBeUndefined();
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
    const body = buildCreateBody(values({ preset: "portrait" }), ["k1"]);
    if (body.mode !== "grid") throw new Error("expected grid body");
    expect(body.canvas).toMatchObject({
      w: 1080,
      h: 1350,
    });
  });

  it("prefers slideshow over polaroid when both are selected", () => {
    const body = buildCreateBody(
      values({
        mode: "polaroid",
        slideshowSelected: true,
        slideshowSources: [
          { kind: "image", durationSec: 3, startSec: NaN, endSec: NaN, fit: "cover" },
          { kind: "video", durationSec: NaN, startSec: 1, endSec: 5, fit: "contain" },
        ],
      }),
      ["k1", "k2"],
    );
    expect(body).toMatchObject({
      mode: "slideshow",
      sources: [
        { key: "k1", kind: "image", durationSec: 3, fit: "cover" },
        { key: "k2", kind: "video", startSec: 1, endSec: 5, fit: "contain" },
      ],
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

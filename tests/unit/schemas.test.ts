import { describe, expect, it } from "vitest";
import { Edl } from "@/lib/schemas/edl";
import { LayoutSpec } from "@/lib/schemas/layout";
import {
  CollageJobResult,
  CreateCollageBody,
  CreateCollageResponse,
  PresignBody,
} from "@/lib/schemas/api";
import { CollageWorkerInput, CollageWorkerResult } from "@/lib/schemas/collage";
import { gridTemplate } from "../fixtures/collageTemplates";

const clip = {
  src: "a1",
  start: 1,
  end: 5,
  score: 0.5,
  crop: { mode: "none", aspect: "16:9" },
  captions: { enabled: false },
  audio: {},
};

describe("Edl", () => {
  it("accepts a valid clip and applies defaults", () => {
    const edl = Edl.parse({ version: 1, clips: [clip] });
    expect(edl.clips[0].audio.normalizeLufs).toBe(-16);
    expect(edl.clips[0].captions.style).toBe("default");
  });
  it("rejects end <= start", () => {
    expect(Edl.safeParse({ version: 1, clips: [{ ...clip, end: 1 }] }).success).toBe(false);
  });
});

describe("LayoutSpec", () => {
  const base = {
    version: 1,
    canvas: { w: 100, h: 100 },
    mode: "grid",
    style: "template",
  };
  const cell = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    w: 50,
    h: 50,
    image: null,
    order: id,
  });
  it("accepts non-overlapping in-canvas cells", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0, 0), cell(1, 50, 0)] }).success).toBe(
      true,
    );
  });
  it("rejects overlapping cells", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0, 0), cell(1, 25, 0)] }).success).toBe(
      false,
    );
  });
  it("rejects cells outside the canvas", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 75, 0)] }).success).toBe(false);
  });
  it("reports invalid cells by array position rather than cell ID", () => {
    const result = LayoutSpec.safeParse({
      ...base,
      cells: [cell(37, 0, 0), cell(4, 75, 0)],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["cells", 1]);
    }
  });
  it("rejects non-integer coordinates", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0.5, 0)] }).success).toBe(false);
  });
});

describe("PresignBody", () => {
  it("rejects unsupported content types", () => {
    expect(
      PresignBody.safeParse({
        filename: "a.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 10,
      }).success,
    ).toBe(false);
  });
  it("rejects HEIC types and extensions the packaged sharp build cannot decode", () => {
    const heic = { filename: "a.heic", contentType: "image/heic", sizeBytes: 10 };
    expect(PresignBody.safeParse(heic).success).toBe(false);
    expect(PresignBody.safeParse({ ...heic, contentType: "image/png" }).success).toBe(false);
    expect(PresignBody.safeParse({ ...heic, filename: "a.HEIF" }).success).toBe(false);
  });
  it("accepts video/mp4", () => {
    expect(
      PresignBody.safeParse({ filename: "a.mp4", contentType: "video/mp4", sizeBytes: 10 }).success,
    ).toBe(true);
  });
});

describe("CreateCollageBody", () => {
  const valid = {
    images: ["uploads/owner/u1/a.png"],
    mode: "grid",
    style: "justified",
    canvas: { w: 1080, h: 1080 },
  };
  const keys = (n: number) => Array.from({ length: n }, (_, i) => `uploads/owner/u1/${i}.png`);
  const template = (id: string, n: number) => ({
    ...valid,
    images: keys(n),
    style: "template",
    template: id,
  });

  it("parses a one-image justified request and applies defaults", () => {
    expect(CreateCollageBody.parse(valid)).toMatchObject({
      style: "justified",
      format: "png",
      canvas: { gap: 12, bg: "#ffffff" },
    });
  });
  it("rejects empty and duplicate image keys", () => {
    expect(CreateCollageBody.safeParse({ ...valid, images: [] }).success).toBe(false);
    expect(
      CreateCollageBody.safeParse({ ...valid, images: [...valid.images, ...valid.images] }).success,
    ).toBe(false);
  });
  it("rejects HEIC/HEIF image keys", () => {
    expect(
      CreateCollageBody.safeParse({ ...valid, images: ["uploads/owner/u1/a.heic"] }).success,
    ).toBe(false);
    expect(
      CreateCollageBody.safeParse({ ...valid, images: ["uploads/owner/u1/a.HEIF"] }).success,
    ).toBe(false);
  });
  it("rejects unsupported modes and styles", () => {
    expect(CreateCollageBody.safeParse({ ...valid, mode: "sequence" }).success).toBe(false);
    expect(CreateCollageBody.safeParse({ ...valid, style: "guillotine" }).success).toBe(false);
  });
  it("accepts slug template ids and leaves their image counts to the server", () => {
    expect(CreateCollageBody.safeParse(template("grid-2x2", 3)).success).toBe(true);
    expect(CreateCollageBody.safeParse(template("Grid 2x2", 4)).success).toBe(false);
  });
  it("accepts a rectangular template for any image count", () => {
    expect(CreateCollageBody.safeParse(template("rectangular", 1)).success).toBe(true);
    expect(CreateCollageBody.safeParse(template("rectangular", 7)).success).toBe(true);
  });
  it("requires a template for template style and rejects one for justified", () => {
    expect(CreateCollageBody.safeParse({ ...valid, style: "template" }).success).toBe(false);
    expect(CreateCollageBody.safeParse({ ...valid, template: "rectangular" }).success).toBe(false);
    expect(
      CreateCollageBody.safeParse({ ...valid, customTemplate: gridTemplate(1, 1) }).success,
    ).toBe(false);
  });
  it("accepts a custom template whose cell count matches the images", () => {
    const custom = (n: number) => ({
      ...valid,
      images: keys(n),
      style: "template",
      customTemplate: gridTemplate(2, 2, "custom"),
    });
    expect(CreateCollageBody.safeParse(custom(4)).success).toBe(true);
    expect(CreateCollageBody.safeParse(custom(3)).success).toBe(false);
    expect(CreateCollageBody.safeParse({ ...custom(4), template: "grid-2x2" }).success).toBe(false);
    const overlapping = {
      ...custom(2),
      customTemplate: {
        ...gridTemplate(2, 1),
        cells: [
          { col: 0, row: 0, colSpan: 2 },
          { col: 1, row: 0 },
        ],
      },
    };
    expect(CreateCollageBody.safeParse(overlapping).success).toBe(false);
  });
  it("validates canvas dimensions, gap, and background", () => {
    const withCanvas = (canvas: object) => CreateCollageBody.safeParse({ ...valid, canvas });
    expect(withCanvas({ w: 800, h: 600, gap: 0, bg: "#A0b1C2" }).success).toBe(true);
    expect(withCanvas({ w: 0, h: 600 }).success).toBe(false);
    expect(withCanvas({ w: 800.5, h: 600 }).success).toBe(false);
    expect(withCanvas({ w: 800, h: 600, gap: -1 }).success).toBe(false);
    expect(withCanvas({ w: 800, h: 600, bg: "#fff" }).success).toBe(false);
    expect(withCanvas({ w: 800, h: 600, bg: "white" }).success).toBe(false);
  });
  it("accepts png and jpeg formats only", () => {
    expect(CreateCollageBody.safeParse({ ...valid, format: "jpeg" }).success).toBe(true);
    expect(CreateCollageBody.safeParse({ ...valid, format: "webp" }).success).toBe(false);
  });
  it("accepts only http(s) webhook URLs", () => {
    const hook = (webhookUrl: string) => CreateCollageBody.safeParse({ ...valid, webhookUrl });
    expect(hook("https://receiver.example/hook").success).toBe(true);
    expect(hook("ftp://receiver.example/hook").success).toBe(false);
    expect(hook("not a url").success).toBe(false);
  });
});

describe("CreateCollageResponse", () => {
  it("contains only the job id", () => {
    expect(CreateCollageResponse.parse({ jobId: "j1", extra: 1 })).toEqual({ jobId: "j1" });
    expect(CreateCollageResponse.safeParse({}).success).toBe(false);
  });
});

describe("CollageWorkerInput", () => {
  const input = {
    sourceAssetIds: ["a1", "a2"],
    style: "justified",
    canvas: { w: 1080, h: 1080, gap: 12, bg: "#ffffff" },
    format: "png",
  };
  it("accepts a nonempty unique asset-ID list", () => {
    expect(CollageWorkerInput.safeParse(input).success).toBe(true);
  });
  it("rejects empty and duplicate asset IDs", () => {
    expect(CollageWorkerInput.safeParse({ ...input, sourceAssetIds: [] }).success).toBe(false);
    expect(CollageWorkerInput.safeParse({ ...input, sourceAssetIds: ["a1", "a1"] }).success).toBe(
      false,
    );
  });
  it("enforces style/template consistency and template cell counts", () => {
    const grid = gridTemplate(2, 2);
    expect(CollageWorkerInput.safeParse({ ...input, style: "template" }).success).toBe(false);
    expect(CollageWorkerInput.safeParse({ ...input, template: "rectangular" }).success).toBe(false);
    expect(
      CollageWorkerInput.safeParse({ ...input, style: "template", template: grid }).success,
    ).toBe(false);
    expect(
      CollageWorkerInput.safeParse({ ...input, style: "template", template: "grid-2x2" }).success,
    ).toBe(false);
    expect(
      CollageWorkerInput.safeParse({
        ...input,
        sourceAssetIds: ["a1", "a2", "a3", "a4"],
        style: "template",
        template: grid,
      }).success,
    ).toBe(true);
  });
});

describe("CollageWorkerResult", () => {
  it("accepts the internal result", () => {
    expect(
      CollageWorkerResult.safeParse({
        outputAssetId: "o1",
        width: 1080,
        height: 1080,
        format: "jpeg",
      }).success,
    ).toBe(true);
  });
});

describe("CollageJobResult", () => {
  const output = {
    width: 1080,
    height: 1080,
    format: "png",
    downloadUrl: "https://s3.example/outputs/j1/collage.png?sig=x",
    expiresInSec: 900,
  };
  it("accepts a valid public result", () => {
    expect(CollageJobResult.safeParse({ output }).success).toBe(true);
  });
  it("rejects invalid URL, format, and dimensions", () => {
    const bad = (patch: object) => CollageJobResult.safeParse({ output: { ...output, ...patch } });
    expect(bad({ downloadUrl: "not a url" }).success).toBe(false);
    expect(bad({ format: "gif" }).success).toBe(false);
    expect(bad({ width: 0 }).success).toBe(false);
    expect(bad({ height: 10.5 }).success).toBe(false);
    expect(bad({ expiresInSec: 0 }).success).toBe(false);
  });
});

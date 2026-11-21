import { describe, expect, it } from "vitest";
import { Edl } from "@/lib/schemas/edl";
import { LayoutSpec } from "@/lib/schemas/layout";
import { PresignBody } from "@/lib/schemas/api";

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
  it("accepts video/mp4", () => {
    expect(
      PresignBody.safeParse({ filename: "a.mp4", contentType: "video/mp4", sizeBytes: 10 }).success,
    ).toBe(true);
  });
});

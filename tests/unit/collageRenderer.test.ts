import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LayoutSpec } from "@/lib/schemas/layout";
import { renderCollage } from "@/server/renderers/collage";

let dir: string;
const sources = new Map<string, string>();

async function solid(name: string, background: string): Promise<string> {
  const path = join(dir, `${name}.png`);
  await sharp({ create: { width: 2, height: 2, channels: 3, background } }).toFile(path);
  return path;
}

const layout: LayoutSpec = {
  version: 1,
  canvas: { w: 10, h: 4, gap: 2, bg: "#ffffff" },
  mode: "grid",
  style: "template",
  cells: [
    { id: 0, x: 0, y: 0, w: 4, h: 4, image: "red", focus: [0.5, 0.5], order: 0, pinned: false },
    { id: 1, x: 6, y: 0, w: 4, h: 4, image: "blue", focus: [0.5, 0.5], order: 1, pinned: false },
  ],
};

async function pixel(path: string, x: number, y: number, channels = 3) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(offset, offset + channels));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "collage-render-"));
  sources.set("red", await solid("red", "#ff0000"));
  sources.set("blue", await solid("blue", "#0000ff"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderCollage", () => {
  it("renders a PNG with exact canvas size, cells, and gap", async () => {
    const outputPath = join(dir, "out.png");
    await renderCollage({ layout, sourcePaths: sources, outputPath, format: "png" });
    const meta = await sharp(outputPath).metadata();
    expect(meta).toMatchObject({ format: "png", width: 10, height: 4 });
    expect(await pixel(outputPath, 1, 1)).toEqual([255, 0, 0]);
    expect(await pixel(outputPath, 8, 2)).toEqual([0, 0, 255]);
    expect(await pixel(outputPath, 5, 2)).toEqual([255, 255, 255]);
  });

  it("flattens JPEG output onto the background", async () => {
    const outputPath = join(dir, "out.jpg");
    await renderCollage({ layout, sourcePaths: sources, outputPath, format: "jpeg" });
    const meta = await sharp(outputPath).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 10, height: 4, channels: 3 });
    const [r, g, b] = await pixel(outputPath, 5, 2);
    expect(Math.min(r ?? 0, g ?? 0, b ?? 0)).toBeGreaterThan(240);
  });

  it("applies EXIF rotation before fitting", async () => {
    const left = join(dir, "orient.jpg");
    // Raw 4x2 (red left half, blue right half) tagged orientation 6 displays as 2x4: red top, blue bottom.
    const raw = Buffer.from([
      ...[255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255],
      ...[255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255],
    ]);
    await sharp(raw, { raw: { width: 4, height: 2, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .withMetadata({ orientation: 6 })
      .toFile(left);
    const single: LayoutSpec = {
      ...layout,
      canvas: { w: 2, h: 4, gap: 0, bg: "#ffffff" },
      cells: [
        { id: 0, x: 0, y: 0, w: 2, h: 4, image: "o", focus: [0.5, 0.5], order: 0, pinned: false },
      ],
    };
    const outputPath = join(dir, "orient-out.png");
    await renderCollage({
      layout: single,
      sourcePaths: new Map([["o", left]]),
      outputPath,
      format: "png",
    });
    const [tr, , tb] = await pixel(outputPath, 0, 0);
    const [br, , bb] = await pixel(outputPath, 0, 3);
    expect(tr).toBeGreaterThan(200);
    expect(tb).toBeLessThan(60);
    expect(br).toBeLessThan(60);
    expect(bb).toBeGreaterThan(200);
  });

  it("fits a photo whose shape differs from its cell instead of cropping it", async () => {
    const wide = join(dir, "wide.png");
    const data = Buffer.alloc(8 * 4 * 3);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) data.set(x === 0 ? [255, 0, 0] : [0, 0, 255], (y * 8 + x) * 3);
    }
    await sharp(data, { raw: { width: 8, height: 4, channels: 3 } }).toFile(wide);
    const single: LayoutSpec = {
      ...layout,
      canvas: { w: 8, h: 8, gap: 0, bg: "#ffffff" },
      cells: [
        { id: 0, x: 0, y: 0, w: 8, h: 8, image: "w", focus: [0.5, 0.5], order: 0, pinned: false },
      ],
    };
    const outputPath = join(dir, "fit-out.png");
    await renderCollage({
      layout: single,
      sourcePaths: new Map([["w", wide]]),
      outputPath,
      format: "png",
    });
    // Both edge columns survive (cover would cut them off); the spare rows show the background.
    expect(await pixel(outputPath, 0, 4)).toEqual([255, 0, 0]);
    expect(await pixel(outputPath, 7, 4)).toEqual([0, 0, 255]);
    expect(await pixel(outputPath, 3, 0)).toEqual([255, 255, 255]);
    expect(await pixel(outputPath, 3, 7)).toEqual([255, 255, 255]);
  });

  it("rejects an invalid layout and a missing source", async () => {
    const outputPath = join(dir, "never.png");
    const overlapping: LayoutSpec = {
      ...layout,
      cells: [layout.cells[0]!, { ...layout.cells[1]!, x: 2 }],
    };
    await expect(
      renderCollage({ layout: overlapping, sourcePaths: sources, outputPath, format: "png" }),
    ).rejects.toThrow();
    await expect(
      renderCollage({ layout, sourcePaths: new Map(), outputPath, format: "png" }),
    ).rejects.toThrow();
  });

  it("leaves empty cells as background", async () => {
    const empty: LayoutSpec = {
      ...layout,
      cells: [layout.cells[0]!, { ...layout.cells[1]!, image: null }],
    };
    const outputPath = join(dir, "empty.png");
    await renderCollage({ layout: empty, sourcePaths: sources, outputPath, format: "png" });
    expect(await pixel(outputPath, 8, 2)).toEqual([255, 255, 255]);
  });
});

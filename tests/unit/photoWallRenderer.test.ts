import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planPhotoWall } from "@/lib/planner/collage/photoWall";
import { renderPhotoWall } from "@/server/renderers/photoWall";

let dir: string;
let red: string;
const plan = planPhotoWall({
  canvas: { w: 400, h: 400, gap: 12, bg: "#ffffff" },
  images: [{ assetId: "red", widthPx: 200, heightPx: 100, pixelCount: 20000 }],
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "photo-wall-test-"));
  red = join(dir, "red.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ff0000" } })
    .png()
    .toFile(red);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("photo wall renderer", () => {
  it("creates a warm wall with the photo visible in a tilted framed print", async () => {
    const outputPath = join(dir, "wall.png");
    await renderPhotoWall({
      spec: plan,
      sourcePaths: new Map([["red", red]]),
      outputPath,
      format: "png",
    });
    const { data, info } = await sharp(outputPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 400, height: 400, channels: 3 });
    expect(Array.from(data.subarray(0, 3))).not.toEqual([255, 255, 255]);
    let redPixels = 0;
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] > 220 && data[i + 1] < 30 && data[i + 2] < 30) redPixels++;
    }
    expect(redPixels).toBeGreaterThan(10000);
  });

  it("writes JPEG and reports missing image sources", async () => {
    const outputPath = join(dir, "wall.jpg");
    await renderPhotoWall({
      spec: plan,
      sourcePaths: new Map([["red", red]]),
      outputPath,
      format: "jpeg",
    });
    expect(await sharp(outputPath).metadata()).toMatchObject({
      format: "jpeg",
      width: 400,
      height: 400,
    });
    await expect(
      renderPhotoWall({ spec: plan, sourcePaths: new Map(), outputPath, format: "png" }),
    ).rejects.toThrow("Missing source image");
  });

  it("uses the planned background color rather than choosing one while rendering", async () => {
    const outputPath = join(dir, "planned-background.png");
    const spec = { ...plan, canvas: { ...plan.canvas, bg: "#d0c0b0" } };
    await renderPhotoWall({
      spec,
      sourcePaths: new Map([["red", red]]),
      outputPath,
      format: "png",
    });
    const { data } = await sharp(outputPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(data.subarray(0, 3))).toEqual([208, 192, 176]);
  });
});

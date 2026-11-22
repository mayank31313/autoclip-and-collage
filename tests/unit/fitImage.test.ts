import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderFitted } from "@/server/renderers/fitImage";

let dir: string;

/** A WxH image: left 4px red, right 4px blue, middle green (wide enough to survive downscaling). */
async function edges(name: string, width: number, height: number, orientation?: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = x < 4 ? [255, 0, 0] : x >= width - 4 ? [0, 0, 255] : [0, 255, 0];
      data.set(rgb, (y * width + x) * 3);
    }
  }
  const file = join(dir, name);
  let image = sharp(data, { raw: { width, height, channels: 3 } }).png();
  if (orientation) image = image.withMetadata({ orientation });
  await image.toFile(file);
  return file;
}

async function rgba(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) =>
    Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
  return { info, at };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "fit-image-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderFitted", () => {
  it("keeps both edges of a landscape photo in a square box and leaves the rest transparent", async () => {
    const out = await rgba(await renderFitted(await edges("wide.png", 40, 20), 20, 20));
    expect(out.info).toMatchObject({ width: 20, height: 20 });
    expect(out.at(0, 10)).toEqual([255, 0, 0, 255]);
    expect(out.at(19, 10)).toEqual([0, 0, 255, 255]);
    expect(out.at(10, 0)[3]).toBe(0);
    expect(out.at(10, 19)[3]).toBe(0);
  });

  it("keeps the top and bottom of a portrait photo in a square box", async () => {
    const out = await rgba(await renderFitted(await edges("tall.png", 20, 40), 20, 20));
    expect(out.at(10, 10)[3]).toBe(255);
    expect(out.at(0, 10)[3]).toBe(0);
    expect(out.at(19, 10)[3]).toBe(0);
    // Scaled to 10 wide, centred: the red edge column lands at x = 5.
    expect(out.at(5, 10)).toEqual([255, 0, 0, 255]);
    expect(out.at(14, 10)).toEqual([0, 0, 255, 255]);
  });

  it("fills the box exactly when the aspects match", async () => {
    const out = await rgba(await renderFitted(await edges("same.png", 40, 20), 20, 10));
    expect(out.at(0, 0)[3]).toBe(255);
    expect(out.at(19, 9)[3]).toBe(255);
  });

  it("uses the EXIF-corrected aspect", async () => {
    // Raw 40x20 tagged orientation 6 displays as 20x40, so it fills a 10x20 box.
    const out = await rgba(await renderFitted(await edges("rot.jpg", 40, 20, 6), 10, 20));
    expect(out.at(0, 0)[3]).toBe(255);
    expect(out.at(9, 19)[3]).toBe(255);
  });
});
